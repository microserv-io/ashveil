import * as THREE from 'three'
import { createDrapeState, type DrapeParams, type DrapeState } from './drape'
import { createDrapeColliders, DRAPE_LIMBS, type DrapeColliders } from './drapecollide'
import { bindDrapeSurface, MAX_DRAPE_SEGMENTS, type DrapeSurface } from './drapesurface'

/**
 * Putting a drape chain onto a real skeleton.
 *
 * A draped piece is exported against the body's joint list with its own chain of
 * bones appended, so wearing one is still a rebind — of a skeleton that is the
 * body's bones plus this piece's chain. The body's own `Skeleton` is never
 * touched: two actors wearing the same cloak must swing independently, and an
 * actor wearing none must cost nothing.
 *
 * All of it is bind-time work: what comes out is a chain of handles plus the axes
 * its angles turn about, which `drapestep.ts` then drives every frame.
 */

/** One drape's shape as the fitter measured it, read off the piece manifest. */
export interface DrapeDefinition {
  readonly name: string
  readonly attachBone: string
  readonly bones: readonly string[]
  readonly segmentLength: number
  /** From the chain root toward the body's nearest skin, in the rig frame. */
  readonly toward: readonly number[]
  /** Bounded samples of the rendered triangle surface, with exact LBS terms. */
  readonly supports?: readonly DrapeSupportDefinition[]
  /** Body-specific capsules measured by the fitter from the body this piece targets. */
  readonly colliders?: readonly DrapeColliderDefinition[]
}

export interface DrapeSupportTermDefinition {
  readonly joint: string
  readonly weight: number
  readonly position: readonly number[]
}

export interface DrapeSupportDefinition {
  readonly segment: number
  readonly terms: readonly DrapeSupportTermDefinition[]
  readonly bodyTerms?: readonly DrapeSupportTermDefinition[]
  readonly normal?: readonly number[]
  readonly clearance?: number
}

export interface DrapeColliderDefinition {
  readonly from: string
  readonly to: string
  readonly radius: number
}

/** One limb capsule, as the two body bones it runs between. */
export interface DrapeLimb {
  readonly from: THREE.Bone
  readonly to: THREE.Bone
  readonly radius: number
}

export interface DrapeChain {
  readonly name: string
  readonly bones: readonly THREE.Bone[]
  readonly attach: THREE.Bone
  /** The body this chain is pushed off, refreshed into `colliders` every step. */
  readonly limbs: readonly DrapeLimb[]
  readonly colliders: DrapeColliders
  /** The frame `toward` was measured in, and the one the root motion is read against. */
  readonly rig: THREE.Object3D
  readonly params: DrapeParams
  readonly state: DrapeState
  readonly surface: DrapeSurface | null
  /** Each bone's rest rotation in its parent's frame, four floats each. */
  readonly rest: Float32Array
  /** Per bone, the axis a positive swing turns it about, in its own rest frame. */
  readonly swingAxis: Float32Array
  /** Per bone, the axis a positive side angle turns it about, in its own rest frame. */
  readonly sideAxis: Float32Array
  /** Where the chain hangs, and where a swing and a side point, in the attach bone's frame. */
  readonly restLocal: Float32Array
  readonly awayLocal: Float32Array
  readonly sideLocal: Float32Array
  /** The sim time the chain was last stepped at, or NaN before its first step. */
  time: number
}

export interface DrapeBinding {
  readonly skeleton: THREE.Skeleton
  readonly chains: readonly DrapeChain[]
}
/** The prefix every joint a piece adds beyond the body's own list must carry. */
const DRAPE_BONE = 'drape_'

/**
 * The body's joints, then this piece's chain. A piece is bound to the body's own
 * bones, so its list has to start with the body's, in the body's order; anything
 * past that has to be a bone the manifest declared, or the piece was fitted
 * against a skeleton this body does not have.
 */
export function bindDrapes(
  slot: string,
  piece: THREE.Skeleton,
  body: THREE.Skeleton,
  drapes: readonly DrapeDefinition[],
  rig: THREE.Object3D,
  clearance = 0,
): DrapeBinding {
  for (const drape of drapes) {
    if (drape.bones.length === 0 || drape.bones.length > MAX_DRAPE_SEGMENTS) {
      throw new Error(`gear: ${slot} drape "${drape.name}" has ${drape.bones.length} segments, expected 1-${MAX_DRAPE_SEGMENTS}`)
    }
  }
  const extras = matchDrapeJoints(slot, piece.bones, body.bones, drapes)
  if (extras.length === 0) {
    if (drapes.length > 0) throw new Error(`gear: ${slot} declares drapes but its piece carries no drape joints. Refit the piece.`)
    return { skeleton: body, chains: [] }
  }
  const scale = rig.getWorldScale(SCALE).x
  const built = new Map<string, THREE.Bone>()
  const known = new Map<string, THREE.Object3D>(body.bones.map((bone) => [bone.name, bone]))
  for (const source of extras) {
    const bone = new THREE.Bone()
    bone.name = source.name
    bone.position.copy(source.position)
    bone.quaternion.copy(source.quaternion)
    bone.scale.copy(source.scale)
    const above = known.get(source.parent?.name ?? '')
    if (!above) throw new Error(`gear: ${slot} drape bone "${source.name}" hangs off nothing this body has`)
    above.add(bone)
    known.set(bone.name, bone)
    built.set(bone.name, bone)
  }

  const inverses = body.boneInverses.concat(
    extras.map((source) => piece.boneInverses[piece.bones.indexOf(source)]!),
  )
  const skeleton = new THREE.Skeleton(body.bones.concat(extras.map((source) => built.get(source.name)!)), inverses)
  return {
    skeleton,
    chains: drapes.map((drape) => chainOf(slot, drape, built, known, rig, scale, piece, skeleton, clearance)),
  }
}

/** The chain's bones come off the body again; the body's own skeleton never changed. */
export function unbindDrapes(chains: readonly DrapeChain[]): void {
  for (const chain of chains) chain.bones[0]?.removeFromParent()
}

/**
 * The joints a piece adds beyond the body's own list, in the piece's skin order.
 * Exported so the clip gate matches a draped piece the same way the runtime does.
 */
export function matchDrapeJoints<T extends { readonly name: string }>(
  slot: string,
  piece: readonly T[],
  body: readonly { readonly name: string }[],
  drapes: readonly DrapeDefinition[],
): readonly T[] {
  if (piece.length < body.length) {
    throw new Error(`gear: ${slot} carries ${piece.length} bones, the body has ${body.length}. Refit the piece.`)
  }
  for (let at = 0; at < body.length; at++) {
    const mine = piece[at]!.name
    const theirs = body[at]!.name
    if (mine !== theirs) {
      throw new Error(`gear: ${slot} bone ${at} is "${mine}", the body has "${theirs}". Refit the piece.`)
    }
  }
  const declared = new Set(drapes.flatMap((drape) => drape.bones))
  return piece.slice(body.length).map((bone) => {
    if (!bone.name.startsWith(DRAPE_BONE) || !declared.has(bone.name)) {
      throw new Error(`gear: ${slot} carries an undeclared extra joint "${bone.name}". Refit the piece.`)
    }
    return bone
  })
}

function chainOf(
  slot: string,
  drape: DrapeDefinition,
  built: Map<string, THREE.Bone>,
  known: Map<string, THREE.Object3D>,
  rig: THREE.Object3D,
  scale: number,
  piece: THREE.Skeleton,
  skeleton: THREE.Skeleton,
  clearance: number,
): DrapeChain {
  const attach = known.get(drape.attachBone)
  if (!(attach instanceof THREE.Bone)) {
    throw new Error(`gear: ${slot} drape "${drape.name}" hangs from "${drape.attachBone}", which this body has not`)
  }
  const bones = drape.bones.map((name) => {
    const bone = built.get(name)
    if (!bone) throw new Error(`gear: ${slot} drape "${drape.name}" names bone "${name}", which the piece has not`)
    return bone
  })
  // A drape whose root sits dead centre has no side to be pushed into; forward is
  // the direction a body travels, and so the one a swing has to be measured on.
  const flat = Math.hypot(drape.toward[0] ?? 0, drape.toward[2] ?? 0)
  const towardX = flat < 1e-6 ? 0 : (drape.toward[0] ?? 0) / flat
  const towardZ = flat < 1e-6 ? 1 : (drape.toward[2] ?? 0) / flat
  AWAY.set(-towardX, 0, -towardZ)
  ACROSS.set(towardZ, 0, -towardX)

  const rest = new Float32Array(bones.length * 4)
  const swingAxis = new Float32Array(bones.length * 3)
  const sideAxis = new Float32Array(bones.length * 3)
  const source = drape.bones.map((name) => piece.bones.find((bone) => bone.name === name)!)
  source.forEach((bone, at) => {
    writeQuat(rest, at * 4, bone.quaternion)
    // A swing turns the bone about the axis across it, and a side angle about the
    // one it would swing along; both read in the bone's own rest frame.
    bone.getWorldQuaternion(REST).invert()
    writeVector(swingAxis, at * 3, SWING_AXIS.copy(ACROSS).applyQuaternion(REST))
    writeVector(sideAxis, at * 3, SWING_AXIS.set(towardX, 0, towardZ).applyQuaternion(REST))
  })

  const bind = piece.bones.find((bone) => bone.name === drape.attachBone)!
  bind.getWorldQuaternion(REST).invert()
  const restLocal = new Float32Array(3)
  const awayLocal = new Float32Array(3)
  const sideLocal = new Float32Array(3)
  // `toward` is horizontal and the swing axes are built square to it, so the line the
  // chain hangs along at bind is the one both are square to: straight down.
  writeVector(restLocal, 0, SWING_AXIS.set(0, -1, 0).applyQuaternion(REST))
  writeVector(awayLocal, 0, SWING_AXIS.copy(AWAY).applyQuaternion(REST))
  writeVector(sideLocal, 0, SWING_AXIS.copy(ACROSS).applyQuaternion(REST))

  const limbs = limbsOf(known, drape.colliders)
  return {
    name: drape.name,
    bones,
    attach,
    rig,
    limbs,
    colliders: createDrapeColliders(limbs.length),
    // The root motion is world metres, so the pendulum is measured in the metres the
    // body is drawn at; the capsules are rig units, so the reach into them is not.
    params: {
      segments: bones.length,
      segmentLength: drape.segmentLength * scale,
      reach: drape.segmentLength,
      clearance,
    },
    state: createDrapeState(bones.length),
    surface: bindDrapeSurface(drape.supports ?? [], skeleton, bones.length),
    rest,
    swingAxis,
    sideAxis,
    restLocal,
    awayLocal,
    sideLocal,
    time: Number.NaN,
  }
}

/**
 * A body that has not got one of a capsule's bones simply has no capsule there: a
 * family whose members differ in what they carry must not fail to be dressed.
 */
function limbsOf(
  known: Map<string, THREE.Object3D>,
  measured: readonly DrapeColliderDefinition[] | undefined,
): DrapeLimb[] {
  return (measured ?? DRAPE_LIMBS).flatMap((limb) => {
    const from = known.get(limb.from)
    const to = known.get(limb.to)
    return from instanceof THREE.Bone && to instanceof THREE.Bone ? [{ from, to, radius: limb.radius }] : []
  })
}

function writeVector(out: Float32Array, at: number, vector: THREE.Vector3): void {
  out[at] = vector.x
  out[at + 1] = vector.y
  out[at + 2] = vector.z
}

function writeQuat(out: Float32Array, at: number, quaternion: THREE.Quaternion): void {
  out[at] = quaternion.x
  out[at + 1] = quaternion.y
  out[at + 2] = quaternion.z
  out[at + 3] = quaternion.w
}

const SCALE = new THREE.Vector3()
const SWING_AXIS = new THREE.Vector3()
const AWAY = new THREE.Vector3()
const ACROSS = new THREE.Vector3()
const REST = new THREE.Quaternion()
