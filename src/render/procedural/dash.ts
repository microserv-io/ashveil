import type { ArmCarry } from '../profiles/profile'
import type { GaitDrive, GaitState } from './gait'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { resolveTorso, writeArm, writeLeg, writeTorso } from './limbs'
import { resetPose, type Pose } from './pose'
import { plant } from './stances'

/**
 * The dash is a shoulder charge: the body pitched over a planted leading foot,
 * turned so the right shoulder goes through first. Pitch and turn are stated per
 * torso joint because rotations are absolute — the accumulated lean of the
 * pelvis-to-chest axis is what the camera reads, not any one of them.
 */
const DASH_HIP = 0.8
const DASH_LUNGE = 0.14
const DASH_PELVIS_PITCH = 0.45
const DASH_SPINE_PITCH = 0.58
const DASH_CHEST_PITCH = 0.6
/** Positive turns the body to its left, which carries the right shoulder forward. */
const DASH_PELVIS_TURN = 0.18
const DASH_SPINE_TURN = 0.3
const DASH_CHEST_TURN = 0.4
/** Dips the leading shoulder into the charge. */
const DASH_CHEST_ROLL = 0.1
/** Absolute, so this is chin-up out of the lean rather than a nod off the chest. */
const DASH_HEAD_PITCH = -0.08
/** Feet as leg lengths from their own hip: one planted ahead, one trailing off the ground. */
const DASH_LEAD_FOOT = 0.34
const DASH_TRAIL_FOOT = 0.6
const DASH_TRAIL_LIFT = 0.1
const DASH_TRAIL_TOE = 0.22
/**
 * Hands as arm lengths from their own shoulder: the leading arm braced across in
 * front of the far pectoral, the trailing one back and out for balance. Forward of
 * the chest rather than on it, or the arm is inside the ribs.
 */
const DASH_BRACE_HAND: readonly [number, number, number] = [0.38, -0.1, 0.28]
const DASH_TRAIL_HAND: readonly [number, number, number] = [0.4, -0.28, -0.4]
/** The braced elbow leads the charge: forward, and outside the chest it crosses. */
const DASH_BRACE_ELBOW = new Float32Array([RIGHT * 0.35, -0.1, 1])

/**
 * A held pose, not a sprint: `dash` outlives the skill, so the body stays
 * committed. `armCarry` goes unused because both hands are stated targets — a
 * braced arm is the pose, and a measured weapon carry would undo it.
 */
export function writeDash(geometry: RigGeometry, _drive: GaitDrive, state: GaitState, out: Pose, _armCarry?: ArmCarry): void {
  resetPose(out)
  plant(state.params)
  out.offset[0] = 0
  out.offset[1] = geometry.ankleHeight + geometry.legLength * DASH_HIP - geometry.hipHeight
  out.offset[2] = geometry.legLength * DASH_LUNGE

  writeTorso(out, Joint.Pelvis, DASH_PELVIS_PITCH, DASH_PELVIS_TURN, 0, state)
  writeTorso(out, Joint.Spine, DASH_SPINE_PITCH, DASH_SPINE_TURN, DASH_CHEST_ROLL * 0.4, state)
  writeTorso(out, Joint.Chest, DASH_CHEST_PITCH, DASH_CHEST_TURN, DASH_CHEST_ROLL, state)
  // Absolute, so a level head already faces +Z however far the chest turned under it.
  writeTorso(out, Joint.Head, DASH_HEAD_PITCH, 0, 0, state)
  resolveTorso(geometry, out, state)

  leadLeg(geometry, state, out)
  trailLeg(geometry, state, out)
  braceArm(geometry, state, out)
}

/** The foot the charge is carried over: flat on the ground, ahead of its own hip. */
function leadLeg(geometry: RigGeometry, state: GaitState, out: Pose): void {
  state.target[0] = RIGHT * geometry.hipWidth
  state.target[1] = geometry.ankleHeight
  state.target[2] = state.positions[Joint.HipR * 3 + 2]! + geometry.legLength * DASH_LEAD_FOOT
  writeLeg(geometry, state, out, RIGHT, 0)
}

/** The leg left behind: extended back, toes down, clear of the ground. */
function trailLeg(geometry: RigGeometry, state: GaitState, out: Pose): void {
  state.target[0] = LEFT * geometry.hipWidth
  state.target[1] = geometry.ankleHeight + geometry.legLength * DASH_TRAIL_LIFT
  state.target[2] = state.positions[Joint.HipL * 3 + 2]! - geometry.legLength * DASH_TRAIL_FOOT
  writeLeg(geometry, state, out, LEFT, DASH_TRAIL_TOE)
}

function braceArm(geometry: RigGeometry, state: GaitState, out: Pose): void {
  const reach = geometry.armLength
  writeArm(
    geometry, state, out, RIGHT,
    DASH_BRACE_HAND[0] * reach, DASH_BRACE_HAND[1] * reach, DASH_BRACE_HAND[2] * reach,
    DASH_BRACE_ELBOW,
  )
  writeArm(
    geometry, state, out, LEFT,
    DASH_TRAIL_HAND[0] * reach, DASH_TRAIL_HAND[1] * reach, DASH_TRAIL_HAND[2] * reach,
  )
}
