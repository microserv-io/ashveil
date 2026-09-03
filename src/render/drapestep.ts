import * as THREE from 'three'
import { createDrapeRoot, DRAPE, resetDrapeState, stepDrape } from './drape'
import { CAPSULE, EMPTY_DRAPE_COLLIDERS } from './drapecollide'
import type { DrapeChain } from './drapebones'
import { solveDrapeSurface } from './drapesurface'
import type { RigInput } from './riginput'

/**
 * The frame path of a drape: where its root has moved to, and what that does to
 * the bones.
 *
 * The swing is written in each bone's own rest frame — `rest * swing * side` — so a
 * chain with nothing pulling it sits exactly where the fitter left it. What the rig
 * frame is for is the pull: gravity and the root's motion are rig-frame vectors, and
 * the axes they act along follow the bone the chain hangs from.
 */

/**
 * Steps every chain and writes the bones. The render delta is deliberately unused:
 * the chain integrates against `RigInput.time`, which is sim time, so two clients
 * fed the same inputs swing the same cloth whatever their frame rates are.
 */
export function updateWornPieces(
  worn: readonly { readonly drapes: readonly DrapeChain[] }[],
  input: RigInput,
  _delta: number,
): void {
  for (const piece of worn) {
    for (const chain of piece.drapes) {
      const since = input.time - chain.time
      chain.time = input.time
      stepDrapeChain(chain, Number.isFinite(since) && since > 0 ? Math.min(since, MAX_FRAME) : 0)
    }
  }
}

export function resetWornPieces(worn: readonly { readonly drapes: readonly DrapeChain[] }[]): void {
  for (const piece of worn) resetDrapeChains(piece.drapes)
}

/** Back to hanging where it was fitted, with no memory of where the body has been. */
export function resetDrapeChains(chains: readonly DrapeChain[]): void {
  for (const chain of chains) {
    resetDrapeState(chain.state)
    chain.time = Number.NaN
    writeDrapeBones(chain)
  }
}

/**
 * Lets a chain fall into the pose the body is already holding, nothing else moving.
 * Until gravity has had a couple of seconds, a body dropped into a pose wears cloth
 * still hanging where its bind pose left it, which is not what cloth does.
 */
export function settleDrapeChains(chains: readonly DrapeChain[], seconds = SETTLE_SECONDS): void {
  const steps = Math.round(seconds / SETTLE_STEP)
  for (const chain of chains) {
    for (let taken = 0; taken < steps; taken++) stepDrapeChain(chain, SETTLE_STEP, 0, false)
    solveDrapeSurface(chain)
  }
}

/** One chain, driven by where its attach bone has moved to since the last step. */
export function stepDrapeChain(chain: DrapeChain, dt: number, forward = 0, solveSurface = true): void {
  chain.attach.getWorldPosition(POSITION)
  chain.rig.getWorldQuaternion(RIG)
  ROOT.x = POSITION.x
  ROOT.y = POSITION.y
  ROOT.z = POSITION.z
  // The capsules are in the rig frame, and what hangs in them starts at the chain's
  // own first bone rather than at the bone it is pinned to: a cape hangs off the
  // back, and measuring it from the middle of the chest buries it in the torso.
  chain.bones[0]!.getWorldPosition(POSITION)
  chain.rig.worldToLocal(POSITION)
  ROOT.localX = POSITION.x
  ROOT.localY = POSITION.y
  ROOT.localZ = POSITION.z
  ROOT.vz = forward
  // The rig frame only ever yaws: the model turns to face, and nothing tips it.
  ROOT.yaw = 2 * Math.atan2(RIG.y, RIG.w)
  // The rest line and the swing axes are the attach bone's, so a shoulder that turns
  // turns them with it, and gravity is then measured against where the chain now hangs.
  chain.attach.getWorldQuaternion(PARENT).premultiply(RIG.invert())
  turnAxis(chain.restLocal, PARENT, ROOT.rest)
  turnAxis(chain.awayLocal, PARENT, ROOT.away)
  turnAxis(chain.sideLocal, PARENT, ROOT.side)
  writeColliders(chain)
  stepDrape(chain.state, chain.params, ROOT, dt, chain.surface === null ? chain.colliders : EMPTY_DRAPE_COLLIDERS)
  writeDrapeBones(chain)
  if (solveSurface) solveDrapeSurface(chain)
}

/** Where the body's limbs are this step, in the frame the chain is solved in. */
function writeColliders(chain: DrapeChain): void {
  const capsules = chain.colliders.capsules
  chain.colliders.count = chain.limbs.length
  for (let at = 0; at < chain.limbs.length; at++) {
    const limb = chain.limbs[at]!
    end(chain, limb.from, capsules, at * CAPSULE)
    end(chain, limb.to, capsules, at * CAPSULE + 3)
    capsules[at * CAPSULE + 6] = limb.radius
  }
}

function end(chain: DrapeChain, bone: THREE.Bone, out: Float32Array, at: number): void {
  bone.getWorldPosition(POSITION)
  chain.rig.worldToLocal(POSITION)
  out[at] = POSITION.x
  out[at + 1] = POSITION.y
  out[at + 2] = POSITION.z
}

/**
 * `rest * swing * side` per bone, on the angle this segment adds to the ones above
 * it: the stored angles accumulate down the chain, and a bone's local rotation is
 * only ever its own share of them.
 */
export function writeDrapeBones(chain: DrapeChain): void {
  let parentSwing = 0
  let parentSide = 0
  for (let at = 0; at < chain.bones.length; at++) {
    const swing = chain.state.swing[at]!
    const side = chain.state.side[at]!
    SWING.setFromAxisAngle(readAxis(chain.swingAxis, at), swing - parentSwing)
    SIDE.setFromAxisAngle(readAxis(chain.sideAxis, at), side - parentSide)
    chain.bones[at]!.quaternion
      .set(chain.rest[at * 4]!, chain.rest[at * 4 + 1]!, chain.rest[at * 4 + 2]!, chain.rest[at * 4 + 3]!)
      .multiply(SWING)
      .multiply(SIDE)
    parentSwing = swing
    parentSide = side
  }
}

function readAxis(axes: Float32Array, at: number): THREE.Vector3 {
  return AXIS.set(axes[at * 3]!, axes[at * 3 + 1]!, axes[at * 3 + 2]!)
}

function turnAxis(local: Float32Array, turn: THREE.Quaternion, out: Float32Array): void {
  AXIS.set(local[0]!, local[1]!, local[2]!).applyQuaternion(turn)
  out[0] = AXIS.x
  out[1] = AXIS.y
  out[2] = AXIS.z
}

/** Longer than this and the page was in the background, not the body in the air. */
const MAX_FRAME = DRAPE.smoothing * 2
/** Long enough for a chain to stop swinging at the damping the table sets. */
const SETTLE_SECONDS = 2
const SETTLE_STEP = 1 / 60
/** Module-level because every one of these runs once per chain per frame. */
const POSITION = new THREE.Vector3()
const AXIS = new THREE.Vector3()
const RIG = new THREE.Quaternion()
const PARENT = new THREE.Quaternion()
const SWING = new THREE.Quaternion()
const SIDE = new THREE.Quaternion()
const ROOT = createDrapeRoot()
