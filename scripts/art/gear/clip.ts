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
import { bindDrapes, type DrapeChain, type DrapeDefinition } from '../../../src/render/drapebones'
import { resetDrapeChains, settleDrapeChains, stepDrapeChain } from '../../../src/render/drapestep'
import { DRAPE_MARGIN, GEAR_SLOTS, SLOT_CLEARANCES, type GearSlot } from '../../../src/render/gear'
import { loadGlbSkeleton, readGlb, type GlbSkinnedMesh } from '../glb'
import { measurePenetration, skinVertices } from './penetration'

/**
 * The clipping gate: does a fitted piece stay out of the body it is worn on?
 *
 * A piece that reads perfectly at bind can still saw through a shoulder at 150
 * degrees of abduction or through a thigh at a run, and neither is visible in a
 * review sheet of three static poses. So the piece is skinned onto the body's own
 * skeleton through every motion cycle and every stress pose the rig can reach, and
 * measured against the body that is still visible under it. Poses past what gameplay
 * asks for are measured and reported under `advisory`, and gate nothing.
 *
 * `node --import tsx scripts/art/gear/clip.ts --piece public/gear/<piece>`
 */

export class ClipError extends Error {}

const ROOT = join(import.meta.dirname, '..', '..', '..')
const BODIES = join(ROOT, 'public', 'bodies')
const CONTRACT = join(ROOT, 'scripts', 'art', 'contracts', 'humanoid.v1.json')
/** How many samples one cycle is walked at. */
const PHASES = 32
/**
 * A pose clip is authored over a normalised phase, so the gate gives it a plausible
 * length. Nothing but a drape reads it, and a drape only needs the rate to be real.
 */
const CLIP_SECONDS = 0.8

export type ClipGroup = 'motion' | 'stress' | 'advisory'

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
  readonly owned?: number
  readonly fixed?: number
}

export interface ClipResult {
  readonly schema: 'ashveil.gear-clip.v1'
  readonly body: string
  readonly piece: string
  readonly slot: GearSlot
  /** How many body vertices the piece hides, per mesh: the mask it was measured with. */
  readonly hides: Readonly<Record<string, number>>
  readonly clip: ClipLimits
  readonly vertices: number
  /**
   * Piece vertices the `dead` cycle does not count: the ones a drape bone owns.
   * A corpse lands on its back on its own cloak, no pendulum models cloth crushed
   * under a body, and the death fade has hidden both inside 1.6 s either way.
   */
  readonly exempt: number
  readonly poses: number
  readonly cycles: Readonly<Record<ClipGroup, ClipWorst>>
  /** Exact regressions retained even when another pose is the group worst. */
  readonly samples: Readonly<Record<string, ClipWorst>>
  readonly gates: {
    readonly clears_the_body_through_motion_cycles: boolean
    readonly clears_the_body_through_stress_poses: boolean
  }
}

/** What one sample of a walked cycle costs in sim time, for anything that integrates. */
export interface ClipMotion {
  /** Seconds this sample advances the body by, or zero for a pose held still. */
  step: number
  /** How fast the body travels forward while it does, along +Z in the body frame. */
  speed: number
  /** True while a cycle is being walked only to settle what integrates through it. */
  settling: boolean
}

export interface ClipBody {
  readonly name: string
  readonly root: THREE.Object3D
  /** The skin's joints as objects, in the skin's own order. */
  readonly bones: readonly THREE.Bone[]
  readonly geometry: RigGeometry
  readonly meshes: readonly GlbSkinnedMesh[]
  readonly jointNames: readonly string[]
  readonly inverseBinds: Float32Array
  apply(pose: Pose): void
  /** Bone world matrices times inverse binds, flattened, valid until the next `apply`. */
  readonly skinMatrices: Float32Array
}

export interface ClipPiece {
  readonly name: string
  readonly slot: GearSlot
  /** The slot regions this piece spans, for reference: masking is `hides`. */
  readonly covers: readonly GearSlot[]
  /** The body vertices this piece covers, per mesh, measured off the fitted piece. */
  readonly hides: Readonly<Record<string, readonly number[]>>
  readonly body: string
  readonly jointNames: readonly string[]
  readonly meshes: readonly GlbSkinnedMesh[]
  /** The hanging cloth this piece carries: one chain of extra joints per entry. */
  readonly drapes?: readonly DrapeDefinition[]
  /** The piece's own node tree and inverse binds, needed only to hang a drape. */
  readonly root?: THREE.Object3D
  readonly inverseBinds?: Float32Array
}

export function loadClipBody(name: string, dir = join(BODIES, name)): ClipBody {
  const glb = readGlb(join(dir, `${name}.glb`))
  const root = loadGlbSkeleton(join(dir, `${name}.glb`))
  const skeleton = bindSkeleton(root, MASCULINE_PROFILE)
  const bones = glb.skin.jointNames.map((bone) => {
    const found = root.getObjectByName(bone)
    if (!(found instanceof THREE.Bone)) throw new ClipError(`clip gate: ${name} has no bone named "${bone}"`)
    return found
  })

  const skinMatrices = new Float32Array(bones.length * 16)
  const scratch = new THREE.Matrix4()

  return {
    name,
    root,
    bones,
    geometry: skeleton.geometry,
    meshes: glb.meshes,
    jointNames: glb.skin.jointNames,
    inverseBinds: glb.skin.inverseBinds,
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
    hides?: Record<string, number[]>
    piece?: string
    drapes?: DrapeDefinition[]
  }
  if (!manifest.slot || !GEAR_SLOTS.includes(manifest.slot as GearSlot)) {
    throw new ClipError(`clip gate: ${manifestPath} names unknown slot "${manifest.slot}"`)
  }
  if (!manifest.body) throw new ClipError(`clip gate: ${manifestPath} has no "body"`)
  const path = join(dir, `${name}.glb`)
  const glb = readGlb(path)
  const drapes = manifest.drapes ?? []
  return {
    name: manifest.piece ?? name,
    slot: manifest.slot as GearSlot,
    covers: matchCovers(manifest.covers ?? [manifest.slot], manifestPath),
    hides: matchHides(manifest.hides, manifestPath),
    body: manifest.body,
    jointNames: glb.skin.jointNames,
    meshes: glb.meshes,
    drapes,
    root: drapes.length === 0 ? undefined : loadGlbSkeleton(path),
    inverseBinds: glb.skin.inverseBinds,
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

/**
 * A piece is bound to the body's own skeleton, so its joint list has to start with
 * the body's, in the body's order. Past that a piece may carry the drape bones its
 * manifest declares, and nothing else.
 */
export function matchJoints(piece: ClipPiece, body: ClipBody): void {
  const declared = new Set((piece.drapes ?? []).flatMap((drape) => drape.bones))
  if (piece.jointNames.length !== body.jointNames.length + declared.size) {
    throw new ClipError(
      `clip gate: ${piece.name} carries ${piece.jointNames.length} joints, ${body.name} has ` +
        `${body.jointNames.length} and the manifest declares ${declared.size} drape bones`,
    )
  }
  for (let at = 0; at < body.jointNames.length; at++) {
    if (piece.jointNames[at] !== body.jointNames[at]) {
      throw new ClipError(
        `clip gate: ${piece.name} joint ${at} is "${piece.jointNames[at]}", ${body.name} has "${body.jointNames[at]}"`,
      )
    }
  }
  for (const joint of piece.jointNames.slice(body.jointNames.length)) {
    if (!declared.has(joint)) {
      throw new ClipError(`clip gate: ${piece.name} carries an extra joint "${joint}" no drape declares`)
    }
  }
}

/**
 * The drape chains of one piece, hung off the body the gate is measuring against.
 *
 * The chain is the runtime's own, stepped by the runtime's own maths: a gate that
 * simulated the cloth its own way would pass a piece the game then saws through.
 * What comes back is one skin-matrix array covering the body's joints and this
 * piece's, which is what the piece's weights index into.
 */
export interface ClipDrape {
  /** Bone world matrices times inverse binds for every joint the piece skins to. */
  readonly matrices: Float32Array
  /** Piece vertices a drape bone owns, one flag each, in the merged piece's order. */
  readonly owned: Uint8Array
  /** Piece vertices with any chain influence, including the fitted fade seam. */
  readonly affected: Uint8Array
  /** Advances the chains onto the pose the body was just put in. */
  step(name: string, motion: ClipMotion): void
}

export function clipDrape(body: ClipBody, piece: ClipPiece, worn?: MergedMesh): ClipDrape | null {
  if (!piece.drapes || piece.drapes.length === 0) return null
  const tree = piece.root
  const binds = piece.inverseBinds
  if (!tree || !binds) throw new ClipError(`clip gate: ${piece.name} declares drapes but carries no skeleton`)
  const pieceBones = piece.jointNames.map((joint) => {
    const found = tree.getObjectByName(joint)
    if (!(found instanceof THREE.Bone)) throw new ClipError(`clip gate: ${piece.name} has no bone named "${joint}"`)
    return found
  })
  const bound = bindDrapes(
    piece.slot,
    new THREE.Skeleton(pieceBones, inverseBinds(binds, pieceBones.length)),
    new THREE.Skeleton([...body.bones], inverseBinds(body.inverseBinds, body.bones.length)),
    piece.drapes,
    body.root,
    SLOT_CLEARANCES[piece.slot] + DRAPE_MARGIN,
  )
  const chains: readonly DrapeChain[] = bound.chains
  // The constructor allocates it; the type is nullable only for a skeleton built empty.
  const skinMatrices = bound.skeleton.boneMatrices
  if (!skinMatrices) throw new ClipError(`clip gate: ${piece.name} bound to a skeleton with no bones`)
  let last = ''
  return {
    matrices: skinMatrices,
    owned: drapeOwned(worn ?? mergeVertices(piece.meshes), body.jointNames.length),
    affected: drapeAffected(worn ?? mergeVertices(piece.meshes), body.jointNames.length),
    step(name: string, motion: ClipMotion): void {
      // A pose change teleports the attach bone, and a teleport is not a swing. The
      // chain then falls into the pose it has been put in before anything is read
      // off it: a held pose measures cloth that has hung there, not cloth mid-drop.
      if (name !== last) {
        resetDrapeChains(chains)
        settleDrapeChains(chains)
      }
      last = name
      for (const chain of chains) {
        stepDrapeChain(chain, motion.step, motion.speed)
        chain.bones[0]!.updateMatrixWorld(true)
      }
      bound.skeleton.update()
    },
  }
}

function inverseBinds(flat: Float32Array, count: number): THREE.Matrix4[] {
  return Array.from({ length: count }, (_, at) => new THREE.Matrix4().fromArray(flat, at * 16))
}

/** A vertex belongs to the cloth when its heaviest influence is one of the chain's. */
function drapeOwned(mesh: MergedMesh, bodyJoints: number): Uint8Array {
  const owned = new Uint8Array(mesh.positions.length / 3)
  for (let vertex = 0; vertex < owned.length; vertex++) {
    let heaviest = -1
    let weight = 0
    for (let lane = 0; lane < 4; lane++) {
      if (mesh.weights[vertex * 4 + lane]! <= weight) continue
      weight = mesh.weights[vertex * 4 + lane]!
      heaviest = mesh.joints[vertex * 4 + lane]!
    }
    if (heaviest >= bodyJoints) owned[vertex] = 1
  }
  return owned
}

function drapeAffected(mesh: MergedMesh, bodyJoints: number): Uint8Array {
  const affected = new Uint8Array(mesh.positions.length / 3)
  for (let vertex = 0; vertex < affected.length; vertex++) {
    for (let lane = 0; lane < 4; lane++) {
      if (mesh.weights[vertex * 4 + lane]! > 0 && mesh.joints[vertex * 4 + lane]! >= bodyJoints) {
        affected[vertex] = 1
        break
      }
    }
  }
  return affected
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

/** The mask is per mesh vertex lists, and a manifest without one hides nothing. */
export function matchHides(
  hides: Record<string, number[]> | undefined,
  where: string,
): Record<string, number[]> {
  if (hides === undefined) return {}
  if (hides === null || typeof hides !== 'object' || Array.isArray(hides)) {
    throw new ClipError(`clip gate: ${where} has a "hides" that is not an object`)
  }
  for (const [mesh, indices] of Object.entries(hides)) {
    if (!Array.isArray(indices)) throw new ClipError(`clip gate: ${where} hides "${mesh}" is not an array`)
  }
  return hides
}

export function measureClip(body: ClipBody, piece: ClipPiece, limits: ClipLimits): ClipResult {
  matchJoints(piece, body)

  const surface = bodySurface(body, piece.hides)
  const worn = mergeVertices(piece.meshes)
  const drape = clipDrape(body, piece, worn)
  const bodyPoints = new Float32Array(surface.positions.length)
  const piecePoints = new Float32Array(worn.positions.length)
  const vertices = worn.positions.length / 3
  const pose = createPose()
  const worst: Record<ClipGroup, ClipWorst> = {
    motion: empty('none'),
    stress: empty('none'),
    advisory: empty('none'),
  }
  const samples: Record<string, ClipWorst> = {}

  let poses = 0
  // A chain starts hanging still, so a draped piece walks every cycle twice and is
  // measured on the second: what the gate reads is cloth already swinging.
  forEachClipPose(body.geometry, pose, (group, name, phase, motion) => {
    body.apply(pose)
    drape?.step(name, motion)
    if (motion.settling) return
    poses++
    skinVertices(surface, body.skinMatrices, bodyPoints)
    skinVertices(worn, drape ? drape.matrices : body.skinMatrices, piecePoints)
    const exempt = drape && name === 'dead' ? drape.owned : null
    const found = measurePenetration(
      bodyPoints, surface.indices, surface.visible, piecePoints, limits.depth, exempt, drape?.affected ?? null,
    )
    const measured = {
      pose: name,
      phase,
      maxDepth: found.maxDepth,
      count: found.over,
      fraction: vertices === 0 ? 0 : found.over / vertices,
      ...(drape === null ? {} : { owned: found.ownedOver, fixed: found.fixedOver }),
    }
    if (knownSample(name, phase)) samples[`${name}@${phase}`] = measured
    if (found.over < worst[group].count) return
    if (found.over === worst[group].count && found.maxDepth <= worst[group].maxDepth) return
    worst[group] = measured
  }, drape === null ? 1 : 2)

  return {
    schema: 'ashveil.gear-clip.v1',
    body: body.name,
    piece: piece.name,
    slot: piece.slot,
    hides: Object.fromEntries(Object.entries(piece.hides).map(([mesh, list]) => [mesh, list.length])),
    clip: limits,
    vertices,
    exempt: drape === null ? 0 : drape.owned.reduce((total, flag) => total + flag, 0),
    poses,
    cycles: worst,
    samples,
    gates: {
      clears_the_body_through_motion_cycles: worst.motion.fraction <= limits.fraction,
      clears_the_body_through_stress_poses: worst.stress.fraction <= limits.fraction,
    },
  }
}

function knownSample(name: string, phase: number): boolean {
  return (name === 'cleave' && phase === 0.34375)
    || (name === 'frost_nova' && phase === 0.375)
    || (name === 'abduct90' && phase === 0)
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
 * Every body mesh in one array, with the triangles the piece covers flagged rather
 * than dropped. The hidden ones still answer which way is out for a piece resting
 * on them; `penetration.ts` is what refuses to count them.
 *
 * The rim rule: the game drops a triangle only when all three vertices are hidden,
 * but one hidden corner is enough to stop it counting here. A rim triangle is half
 * under the garment, and skin the garment already ate cannot be clipped through.
 */
export function bodySurface(body: ClipBody, hides: Readonly<Record<string, readonly number[]>>): BodySurface {
  const merged = mergeVertices(body.meshes)
  const visible = new Uint8Array(merged.indices.length / 3).fill(1)
  let triangle = 0
  for (const mesh of body.meshes) {
    const hidden = new Set<number>(hides[mesh.name] ?? [])
    for (let at = 0; at < mesh.indices.length; at += 3, triangle++) {
      const a = mesh.indices[at]!
      const b = mesh.indices[at + 1]!
      const c = mesh.indices[at + 2]!
      if (hidden.has(a) || hidden.has(b) || hidden.has(c)) visible[triangle] = 0
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
  visit: (group: ClipGroup, name: string, phase: number, motion: ClipMotion) => void,
  passes = 1,
): void {
  const state = createGaitState()
  const drive = createGaitDrive()
  const motion: ClipMotion = { step: 0, speed: 0, settling: false }

  for (const [name, speed] of [['walk', 1.6], ['run', 5.0]] as const) {
    // The walk below advances `drive.time` by the phase over the speed, so one loop
    // of it is a second divided by the speed. Anything integrating has to agree.
    const cycle = 1 / speed
    for (let pass = 0; pass < passes; pass++) {
      for (let sample = 0; sample < PHASES; sample++) {
        const phase = sample / PHASES
        drive.speed = speed
        drive.phase = phase
        drive.time = phase / speed
        writeLocomotion(geometry, drive, state, pose)
        cycling(motion, cycle / PHASES, speed, pass < passes - 1)
        visit('motion', name, phase, motion)
      }
    }
  }

  for (const clip of MOTION_CLIPS) {
    for (let pass = 0; pass < passes; pass++) {
      for (let sample = 0; sample < PHASES; sample++) {
        const phase = sample / PHASES
        writeClipPose(geometry, POSE_CLIPS[clip], phase, state, pose)
        cycling(motion, CLIP_SECONDS / PHASES, 0, pass < passes - 1)
        visit('motion', clip, phase, motion)
      }
    }
  }

  const held = (group: ClipGroup, name: string): void => {
    cycling(motion, 0, 0, false)
    visit(group, name, 0, motion)
  }

  resetPose(pose)
  held('stress', 'bind')

  // Overhead is deliberately absent: linear skinning folds this body's own shoulder
  // through itself at 180, so the pose measures the body, not the piece, and no
  // gameplay motion raises an arm that far.
  // 150 is advisory for the same reason 180 is absent: no gameplay motion abducts an
  // arm past 90, and this body's own shoulder skin folds through itself up there, so
  // what the measurement reads is the body rather than the piece.
  for (const degrees of [90, 150]) {
    resetPose(pose)
    // Positive about +Z raises the left arm outward; the right side mirrors it.
    setJointAxisAngle(pose, Joint.ShoulderL, 0, 0, 1, (LEFT * degrees * Math.PI) / 180)
    setJointAxisAngle(pose, Joint.ShoulderR, 0, 0, 1, (RIGHT * degrees * Math.PI) / 180)
    held(degrees > 90 ? 'advisory' : 'stress', `abduct${degrees}`)
  }

  for (const degrees of [60, 90]) {
    resetPose(pose)
    // Flexion is a negative turn about +X: an arm hangs down, so the turn that tips
    // a chest forward swings a hand back.
    setJointAxisAngle(pose, Joint.ShoulderL, 1, 0, 0, (-degrees * Math.PI) / 180)
    setJointAxisAngle(pose, Joint.ShoulderR, 1, 0, 0, (-degrees * Math.PI) / 180)
    held('stress', `armflex${degrees}`)
  }

  for (const degrees of [45, -45]) {
    resetPose(pose)
    setJointAxisAngle(pose, Joint.Spine, 0, 1, 0, (degrees * Math.PI) / 180)
    held('stress', `twist${degrees}`)
  }

  resetPose(pose)
  setJointAxisAngle(pose, Joint.Spine, 1, 0, 0, Math.PI / 4)
  held('stress', 'torsoflex45')

  resetPose(pose)
  // Pose rotations are absolute in the body frame, so a knee flexed 90 degrees on a
  // thigh already 90 degrees forward leaves the shin hanging in its rest orientation.
  // Turning the knee 90 on top of the hip folds the calf through the thigh.
  const hipFlexion = -Math.PI / 2
  setJointAxisAngle(pose, Joint.HipL, 1, 0, 0, hipFlexion)
  setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, hipFlexion + Math.PI / 2)
  held('stress', 'hipflex90')
}

function cycling(motion: ClipMotion, step: number, speed: number, settling: boolean): void {
  motion.step = step
  motion.speed = speed
  motion.settling = settling
}

/** Deeper than this two pieces are overlapping rather than resting on each other. */
export const SET_DEPTH = 0.003

export interface SetPair {
  readonly outer: string
  readonly inner: string
  readonly count: number
  readonly maxDepth: number
}

export interface SetOverlap {
  readonly schema: 'ashveil.gear-set.v1'
  readonly body: string
  readonly depth: number
  /** Every piece in the set with the layer its slot wears at. */
  readonly layers: Readonly<Record<string, number>>
  /** The worst overlap each ordered pair reached, per motion. */
  readonly worst: Readonly<Record<string, readonly SetPair[]>>
}

export function slotLayers(contract = CONTRACT): Record<string, number> {
  const parsed = JSON.parse(readFileSync(contract, 'utf8')) as {
    slots?: Record<string, { layer?: number }>
  }
  const layers: Record<string, number> = {}
  for (const [slot, rule] of Object.entries(parsed.slots ?? {})) {
    if (typeof rule.layer !== 'number') throw new ClipError(`set gate: slot "${slot}" has no layer`)
    layers[slot] = rule.layer
  }
  return layers
}

/**
 * Advisory only: how far the pieces of a worn set reach into each other.
 *
 * Per-piece gates cannot see intersections between equipped pieces. This advisory
 * measures those overlaps; layer controls fixed masking independently of fit
 * clearance and body collision. It gates nothing: contact can be intentional.
 */
export function measureSet(body: ClipBody, pieces: readonly ClipPiece[]): SetOverlap {
  const layers = slotLayers()
  for (const piece of pieces) matchJoints(piece, body)
  const worn = pieces.map((piece) => {
    const merged = mergeVertices(piece.meshes)
    return {
      piece,
      layer: layers[piece.slot]!,
      merged,
      visible: new Uint8Array(merged.indices.length / 3).fill(1),
      points: new Float32Array(merged.positions.length),
      drape: clipDrape(body, piece),
    }
  })
  const pose = createPose()
  const state = createGaitState()
  const drive = createGaitDrive()
  const worst: Record<string, SetPair[]> = {}

  const step: ClipMotion = { step: 0, speed: 0, settling: false }
  const visit = (motion: string): void => {
    body.apply(pose)
    for (const wear of worn) {
      wear.drape?.step(motion, step)
      skinVertices(wear.merged, wear.drape ? wear.drape.matrices : body.skinMatrices, wear.points)
    }
    const found = worst[motion] ?? (worst[motion] = [])
    for (const outer of worn) {
      for (const inner of worn) {
        if (outer.layer <= inner.layer) continue
        const measured = measurePenetration(
          inner.points, inner.merged.indices, inner.visible, outer.points, SET_DEPTH,
        )
        const at = found.findIndex((pair) => pair.outer === outer.piece.name && pair.inner === inner.piece.name)
        const pair = { outer: outer.piece.name, inner: inner.piece.name, ...measured }
        const entry = { outer: pair.outer, inner: pair.inner, count: pair.over, maxDepth: pair.maxDepth }
        if (at < 0) found.push(entry)
        else if (entry.count > found[at]!.count) found[at] = entry
      }
    }
  }

  resetPose(pose)
  visit('bind')
  for (const [motion, speed] of [['walk', 1.6], ['run', 5.0]] as const) {
    step.step = 1 / speed / PHASES
    step.speed = speed
    for (let sample = 0; sample < PHASES; sample++) {
      const phase = sample / PHASES
      drive.speed = speed
      drive.phase = phase
      drive.time = phase / speed
      writeLocomotion(body.geometry, drive, state, pose)
      visit(motion)
    }
  }
  return {
    schema: 'ashveil.gear-set.v1',
    body: body.name,
    depth: SET_DEPTH,
    layers: Object.fromEntries(worn.map((wear) => [wear.piece.name, wear.layer])),
    worst,
  }
}

export function runClipGate(dir: string): ClipResult {
  const piece = loadClipPiece(dir)
  const body = loadClipBody(piece.body)
  const result = measureClip(body, piece, clipLimits(piece.slot))
  writeFileSync(join(dir, `${piece.name}.clip.json`), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

/** The set the review page can wear: every fitted piece under `public/gear`. */
export function runSetAdvisory(dirs: readonly string[]): SetOverlap {
  const pieces = dirs.map((dir) => loadClipPiece(dir))
  if (pieces.length === 0) throw new ClipError('set gate: no fitted piece to measure')
  const bodies = [...new Set(pieces.map((piece) => piece.body))]
  if (bodies.length !== 1) throw new ClipError(`set gate: the set is fitted to ${bodies.join(', ')}`)
  return measureSet(loadClipBody(bodies[0]!), pieces)
}

function main(argv: readonly string[]): number {
  let dir: string | null = null
  const set: string[] = []
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === '--piece') dir = argv[++at] ?? null
    else if (argv[at] === '--set') set.push(argv[++at] ?? '')
    else throw new ClipError(`argument gate: unknown argument "${argv[at]}"`)
  }
  if (set.length > 0) {
    process.stdout.write(`${JSON.stringify(runSetAdvisory(set), null, 2)}\n`)
    return 0
  }
  if (!dir) throw new ClipError('argument gate: --piece <dir> or --set <dir> is required')

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
