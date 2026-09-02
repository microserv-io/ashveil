import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { POSE_CLIPS } from '../../../src/render/procedural/clips'
import { createGaitDrive, createGaitState, writeLocomotion } from '../../../src/render/procedural/gait'
import type { RigGeometry } from '../../../src/render/procedural/geometry'
import { Joint, LEFT, RIGHT } from '../../../src/render/procedural/joints'
import { createPose, resetPose, setJointAxisAngle, type Pose } from '../../../src/render/procedural/pose'
import { writeClipPose } from '../../../src/render/procedural/poses'
import { MASCULINE_PROFILE } from '../../../src/render/profiles/masculine'
import { bindSkeleton } from '../../../src/render/semanticskeleton'
import { GEAR_SLOTS, type BodyMasks, type GearSlot } from '../../../src/render/gear'
import { loadGlbSkeleton, readGlb, type GlbSkinnedMesh } from '../glb'
import { measurePenetration, skinVertices } from './penetration'

/**
 * The clipping gate: does a fitted piece stay out of the body it is worn on?
 *
 * A piece that reads perfectly at bind can still saw through a shoulder at 150
 * degrees of abduction or through a thigh at a run, and neither is visible in a
 * review sheet of three static poses. So the piece is skinned onto the body's own
 * skeleton through every motion cycle and every stress pose the rig can reach, and
 * measured against the body that is still visible under it.
 *
 * `node --import tsx scripts/art/gear/clip.ts --piece public/gear/<piece>`
 */

export class ClipError extends Error {}

const ROOT = join(import.meta.dirname, '..', '..', '..')
const BODIES = join(ROOT, 'public', 'bodies')
const CONTRACT = join(ROOT, 'scripts', 'art', 'contracts', 'humanoid.v1.json')
/** How many samples one cycle is walked at. */
const PHASES = 32

export type ClipGroup = 'motion' | 'stress'

export interface ClipLimits {
  readonly depth: number
  readonly fraction: number
}

export interface ClipWorst {
  /** The pose that measured worst, or `none` when nothing touched the body at all. */
  readonly pose: string
  readonly phase: number
  readonly maxDepth: number
  /** Vertices deeper than `clip.depth` in the worst pose. */
  readonly count: number
  readonly fraction: number
}

export interface ClipResult {
  readonly schema: 'ashveil.gear-clip.v1'
  readonly body: string
  readonly piece: string
  readonly slot: GearSlot
  readonly maskBody: boolean
  readonly maskedSlots: readonly GearSlot[]
  readonly clip: ClipLimits
  readonly vertices: number
  readonly poses: number
  readonly cycles: Readonly<Record<ClipGroup, ClipWorst>>
  readonly gates: {
    readonly clears_the_body_through_motion_cycles: boolean
    readonly clears_the_body_through_stress_poses: boolean
  }
}

export interface ClipBody {
  readonly name: string
  readonly root: THREE.Object3D
  readonly geometry: RigGeometry
  readonly meshes: readonly GlbSkinnedMesh[]
  readonly jointNames: readonly string[]
  readonly inverseBinds: Float32Array
  /** Empty when the body has no masks sidecar yet; the piece then hides nothing. */
  readonly masks: BodyMasks
  readonly hasMasks: boolean
  apply(pose: Pose): void
  /** Bone world matrices times inverse binds, flattened, valid until the next `apply`. */
  readonly skinMatrices: Float32Array
}

export interface ClipPiece {
  readonly name: string
  readonly slot: GearSlot
  /** The slot regions this piece hides: its own by default, a sleeve's more. */
  readonly covers: readonly GearSlot[]
  readonly maskBody: boolean
  readonly body: string
  readonly jointNames: readonly string[]
  readonly meshes: readonly GlbSkinnedMesh[]
}

export function loadClipBody(name: string, dir = join(BODIES, name)): ClipBody {
  const glb = readGlb(join(dir, `${name}.glb`))
  const root = loadGlbSkeleton(join(dir, `${name}.glb`))
  const skeleton = bindSkeleton(root, MASCULINE_PROFILE)
  const bones = glb.skin.jointNames.map((bone) => {
    const found = root.getObjectByName(bone)
    if (!found) throw new ClipError(`clip gate: ${name} has no bone named "${bone}"`)
    return found
  })

  const masksPath = join(dir, `${name}.masks.json`)
  const hasMasks = existsSync(masksPath)
  const masks: BodyMasks = hasMasks ? JSON.parse(readFileSync(masksPath, 'utf8')) : { slots: {} }
  const skinMatrices = new Float32Array(bones.length * 16)
  const scratch = new THREE.Matrix4()

  return {
    name,
    root,
    geometry: skeleton.geometry,
    meshes: glb.meshes,
    jointNames: glb.skin.jointNames,
    inverseBinds: glb.skin.inverseBinds,
    masks,
    hasMasks,
    skinMatrices,
    apply(pose: Pose): void {
      skeleton.apply(pose)
      root.updateMatrixWorld(true)
      bones.forEach((bone, at) => {
        scratch.fromArray(glb.skin.inverseBinds, at * 16).premultiply(bone.matrixWorld)
        scratch.toArray(skinMatrices, at * 16)
      })
    },
  }
}

export function loadClipPiece(dir: string, name = basename(dir)): ClipPiece {
  const manifestPath = join(dir, `${name}.manifest.json`)
  if (!existsSync(manifestPath)) throw new ClipError(`clip gate: ${manifestPath} does not exist`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    slot?: string
    body?: string
    covers?: string[]
    maskBody?: boolean
    piece?: string
  }
  if (!manifest.slot || !GEAR_SLOTS.includes(manifest.slot as GearSlot)) {
    throw new ClipError(`clip gate: ${manifestPath} names unknown slot "${manifest.slot}"`)
  }
  if (!manifest.body) throw new ClipError(`clip gate: ${manifestPath} has no "body"`)
  const glb = readGlb(join(dir, `${name}.glb`))
  return {
    name: manifest.piece ?? name,
    slot: manifest.slot as GearSlot,
    covers: matchCovers(manifest.covers ?? [manifest.slot], manifestPath),
    maskBody: manifest.maskBody !== false,
    body: manifest.body,
    jointNames: glb.skin.jointNames,
    meshes: glb.meshes,
  }
}

export function clipLimits(slot: GearSlot, contract = CONTRACT): ClipLimits {
  const parsed = JSON.parse(readFileSync(contract, 'utf8')) as {
    slots?: Record<string, { clip?: ClipLimits }>
  }
  const limits = parsed.slots?.[slot]?.clip
  if (!limits) throw new ClipError(`clip gate: the family contract has no clip rule for slot "${slot}"`)
  return limits
}

/** A piece is bound to the body's own skeleton, so its joint list must be the body's. */
export function matchJoints(piece: ClipPiece, body: ClipBody): void {
  if (piece.jointNames.length !== body.jointNames.length) {
    throw new ClipError(
      `clip gate: ${piece.name} carries ${piece.jointNames.length} joints, ${body.name} has ${body.jointNames.length}`,
    )
  }
  for (let at = 0; at < body.jointNames.length; at++) {
    if (piece.jointNames[at] !== body.jointNames[at]) {
      throw new ClipError(
        `clip gate: ${piece.name} joint ${at} is "${piece.jointNames[at]}", ${body.name} has "${body.jointNames[at]}"`,
      )
    }
  }
}

/** A manifest names the regions it hides, and every one of them has to be a real slot. */
export function matchCovers(covers: readonly (string | undefined)[], where: string): GearSlot[] {
  return covers.map((slot) => {
    if (!slot || !GEAR_SLOTS.includes(slot as GearSlot)) {
      throw new ClipError(`clip gate: ${where} names unknown covered slot "${slot}"`)
    }
    return slot as GearSlot
  })
}

/** Which slots the gate hides while measuring one piece: everything it covers. */
export function maskedSlots(body: ClipBody, piece: ClipPiece): GearSlot[] {
  return piece.maskBody && body.hasMasks ? [...piece.covers] : []
}

export function measureClip(body: ClipBody, piece: ClipPiece, limits: ClipLimits): ClipResult {
  matchJoints(piece, body)

  const hidden = maskedSlots(body, piece)
  const surface = bodySurface(body, new Set(hidden))
  const worn = mergeVertices(piece.meshes)
  const bodyPoints = new Float32Array(surface.positions.length)
  const piecePoints = new Float32Array(worn.positions.length)
  const vertices = worn.positions.length / 3
  const pose = createPose()
  const worst: Record<ClipGroup, ClipWorst> = {
    motion: empty('none'),
    stress: empty('none'),
  }

  let poses = 0
  forEachClipPose(body.geometry, pose, (group, name, phase) => {
    poses++
    body.apply(pose)
    skinVertices(surface, body.skinMatrices, bodyPoints)
    skinVertices(worn, body.skinMatrices, piecePoints)
    const found = measurePenetration(bodyPoints, surface.indices, surface.visible, piecePoints, limits.depth)
    if (found.over < worst[group].count) return
    if (found.over === worst[group].count && found.maxDepth <= worst[group].maxDepth) return
    worst[group] = {
      pose: name,
      phase,
      maxDepth: found.maxDepth,
      count: found.over,
      fraction: vertices === 0 ? 0 : found.over / vertices,
    }
  })

  return {
    schema: 'ashveil.gear-clip.v1',
    body: body.name,
    piece: piece.name,
    slot: piece.slot,
    maskBody: piece.maskBody,
    maskedSlots: hidden,
    clip: limits,
    vertices,
    poses,
    cycles: worst,
    gates: {
      clears_the_body_through_motion_cycles: worst.motion.fraction <= limits.fraction,
      clears_the_body_through_stress_poses: worst.stress.fraction <= limits.fraction,
    },
  }
}

export interface MergedMesh {
  readonly positions: Float32Array
  readonly joints: Uint16Array
  readonly weights: Float32Array
  readonly indices: Uint32Array
}

export interface BodySurface extends MergedMesh {
  /** One flag per triangle, 0 where a worn slot hides it. */
  readonly visible: Uint8Array
}

/**
 * Every body mesh in one array, with the triangles the worn slots hide flagged
 * rather than dropped. The hidden ones still answer which way is out for a piece
 * resting on them; `penetration.ts` is what refuses to count them.
 */
export function bodySurface(body: ClipBody, worn: ReadonlySet<GearSlot>): BodySurface {
  const merged = mergeVertices(body.meshes)
  const visible = new Uint8Array(merged.indices.length / 3).fill(1)
  let triangle = 0
  for (const mesh of body.meshes) {
    const hidden = new Set<number>()
    for (const slot of worn) for (const vertex of body.masks.slots[slot]?.[mesh.name] ?? []) hidden.add(vertex)
    for (let at = 0; at < mesh.indices.length; at += 3, triangle++) {
      const a = mesh.indices[at]!
      const b = mesh.indices[at + 1]!
      const c = mesh.indices[at + 2]!
      if (hidden.has(a) && hidden.has(b) && hidden.has(c)) visible[triangle] = 0
    }
  }
  return { ...merged, visible }
}

function mergeVertices(meshes: readonly GlbSkinnedMesh[]): MergedMesh {
  const vertices = meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0)
  const positions = new Float32Array(vertices * 3)
  const joints = new Uint16Array(vertices * 4)
  const weights = new Float32Array(vertices * 4)
  const indices: number[] = []
  let offset = 0
  for (const mesh of meshes) {
    positions.set(mesh.positions, offset * 3)
    joints.set(mesh.joints, offset * 4)
    weights.set(mesh.weights, offset * 4)
    for (const index of mesh.indices) indices.push(offset + index)
    offset += mesh.positions.length / 3
  }
  return { positions, joints, weights, indices: new Uint32Array(indices) }
}

function empty(pose: string): ClipWorst {
  return { pose, phase: 0, maxDepth: 0, count: 0, fraction: 0 }
}

/** The clips the piece has to survive: two gaits, three skills, and death. */
const MOTION_CLIPS = ['cleave', 'firebolt', 'frost_nova', 'dead'] as const

/**
 * Every pose the gate walks, written into one reused `Pose`.
 *
 * The stress poses are the far ends of the rig rather than anything an animation
 * plays: a piece that clears 150 degrees of abduction clears every swing that will
 * ever be authored, which is the only way this gate can outlive the current clips.
 */
export function forEachClipPose(
  geometry: RigGeometry,
  pose: Pose,
  visit: (group: ClipGroup, name: string, phase: number) => void,
): void {
  const state = createGaitState()
  const drive = createGaitDrive()

  for (const [name, speed] of [['walk', 1.6], ['run', 5.0]] as const) {
    for (let sample = 0; sample < PHASES; sample++) {
      const phase = sample / PHASES
      drive.speed = speed
      drive.phase = phase
      drive.time = phase / speed
      writeLocomotion(geometry, drive, state, pose)
      visit('motion', name, phase)
    }
  }

  for (const clip of MOTION_CLIPS) {
    for (let sample = 0; sample < PHASES; sample++) {
      const phase = sample / PHASES
      writeClipPose(geometry, POSE_CLIPS[clip], phase, state, pose)
      visit('motion', clip, phase)
    }
  }

  resetPose(pose)
  visit('stress', 'bind', 0)

  // Overhead is deliberately absent: linear skinning folds this body's own shoulder
  // through itself at 180, so the pose measures the body, not the piece, and no
  // gameplay motion raises an arm that far.
  for (const degrees of [90, 150]) {
    resetPose(pose)
    // Positive about +Z raises the left arm outward; the right side mirrors it.
    setJointAxisAngle(pose, Joint.ShoulderL, 0, 0, 1, (LEFT * degrees * Math.PI) / 180)
    setJointAxisAngle(pose, Joint.ShoulderR, 0, 0, 1, (RIGHT * degrees * Math.PI) / 180)
    visit('stress', `abduct${degrees}`, 0)
  }

  for (const degrees of [60, 90]) {
    resetPose(pose)
    // Flexion is a negative turn about +X: an arm hangs down, so the turn that tips
    // a chest forward swings a hand back.
    setJointAxisAngle(pose, Joint.ShoulderL, 1, 0, 0, (-degrees * Math.PI) / 180)
    setJointAxisAngle(pose, Joint.ShoulderR, 1, 0, 0, (-degrees * Math.PI) / 180)
    visit('stress', `armflex${degrees}`, 0)
  }

  for (const degrees of [45, -45]) {
    resetPose(pose)
    setJointAxisAngle(pose, Joint.Spine, 0, 1, 0, (degrees * Math.PI) / 180)
    visit('stress', `twist${degrees}`, 0)
  }

  resetPose(pose)
  setJointAxisAngle(pose, Joint.Spine, 1, 0, 0, Math.PI / 4)
  visit('stress', 'torsoflex45', 0)

  resetPose(pose)
  // Pose rotations are absolute in the body frame, so a knee flexed 90 degrees on a
  // thigh already 90 degrees forward leaves the shin hanging in its rest orientation.
  // Turning the knee 90 on top of the hip folds the calf through the thigh.
  const hipFlexion = -Math.PI / 2
  setJointAxisAngle(pose, Joint.HipL, 1, 0, 0, hipFlexion)
  setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, hipFlexion + Math.PI / 2)
  visit('stress', 'hipflex90', 0)
}

export function runClipGate(dir: string): ClipResult {
  const piece = loadClipPiece(dir)
  const body = loadClipBody(piece.body)
  const result = measureClip(body, piece, clipLimits(piece.slot))
  writeFileSync(join(dir, `${piece.name}.clip.json`), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

function main(argv: readonly string[]): number {
  let dir: string | null = null
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === '--piece') dir = argv[++at] ?? null
    else throw new ClipError(`argument gate: unknown argument "${argv[at]}"`)
  }
  if (!dir) throw new ClipError('argument gate: --piece <dir> is required')

  const result = runClipGate(dir)
  process.stdout.write(`${JSON.stringify(result.gates)}\n`)
  return Object.values(result.gates).every(Boolean) ? 0 : 1
}

// `tsx` runs this file as the entry point; imported from a test it must stay quiet.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
