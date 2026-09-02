import { armPace } from './armpace'
import { writeCarriedArm } from './arms'
import { TAU } from './curves'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { plantFeet, resolveTorso, stanceOffset, writeLeg, writeTorso } from './limbs'
import { resetPose, type Pose } from './pose'
import type { ArmCarry } from '../profiles/profile'
import { seedOffset, type GaitDrive, type GaitParams, type GaitState } from './gait'

/**
 * The poses a body holds when it is not walking. They share the gait's scratch and
 * its params so a crossover between them blends joint for joint, but nothing here
 * needs the stride, so it is a sibling of `gait.ts` rather than more of it.
 */

const IDLE_BREATH_HZ = 0.23
const IDLE_SHIFT_HZ = 0.11
const IDLE_SWAY = 0.06
const IDLE_ROLL = 0.045
const IDLE_BREATH_PITCH = 0.03
const DASH_HIP = 0.84
const DASH_LEAN = 0.5
const DASH_LUNGE = 0.12
const DASH_TRAIL = 0.3
const DASH_FOOT_LIFT = 0.18
const FOOT_SWING_PITCH = 0.45
/** Hands back, and barely moving at rest: a dash throws the body past its arms. */
const DASH_ARM_TUCK = 0.9
const IDLE_ARM_DRIFT = 0.03
export function writeIdle(geometry: RigGeometry, drive: GaitDrive, state: GaitState, out: Pose, armCarry?: ArmCarry): void {
  resetPose(out)
  plant(state.params)
  const offset = seedOffset(drive.seed)
  const breath = Math.sin(TAU * (drive.time * IDLE_BREATH_HZ + offset))
  const shift = Math.sin(TAU * (drive.time * IDLE_SHIFT_HZ + offset))

  out.offset[0] = shift * IDLE_SWAY * geometry.hipWidth
  // Breath rides on the chest: a leg at full extension turns a millimetre of hip
  // drop into ten degrees of knee, and idle would flex with it.
  out.offset[1] = stanceOffset(geometry)
  out.offset[2] = 0

  // Level: with both feet planted, tilting the pelvis makes one leg longer than
  // it is, and the knee under the low hip buckles to answer.
  writeTorso(out, Joint.Pelvis, 0, 0, 0, state)
  writeTorso(out, Joint.Spine, breath * IDLE_BREATH_PITCH, 0, shift * IDLE_ROLL * 0.4, state)
  writeTorso(out, Joint.Chest, breath * IDLE_BREATH_PITCH * 1.8, 0, shift * IDLE_ROLL * 0.3, state)
  writeTorso(out, Joint.Head, -breath * IDLE_BREATH_PITCH, shift * 0.06, 0, state)
  plantFeet(geometry, state, out)
  const pace = armPace(geometry, 0)
  writeCarriedArm(geometry, state, out, LEFT, breath * IDLE_ARM_DRIFT, pace, armCarry?.left)
  writeCarriedArm(geometry, state, out, RIGHT, -breath * IDLE_ARM_DRIFT, pace, armCarry?.right)
}

/** A held pose, not a sprint: `dash` outlives the skill, so the body stays committed. */
export function writeDash(geometry: RigGeometry, _drive: GaitDrive, state: GaitState, out: Pose, armCarry?: ArmCarry): void {
  resetPose(out)
  plant(state.params)
  out.offset[0] = 0
  out.offset[1] = geometry.ankleHeight + geometry.legLength * DASH_HIP - geometry.hipHeight
  out.offset[2] = geometry.legLength * DASH_LUNGE

  writeTorso(out, Joint.Pelvis, DASH_LEAN * 0.3, 0, 0, state)
  writeTorso(out, Joint.Spine, DASH_LEAN * 0.4, 0, 0, state)
  writeTorso(out, Joint.Chest, DASH_LEAN * 0.3, 0, 0, state)
  writeTorso(out, Joint.Head, -DASH_LEAN * 0.6, 0, 0, state)
  resolveTorso(geometry, out, state)

  trailLeg(geometry, state, out, LEFT)
  trailLeg(geometry, state, out, RIGHT)
  const pace = armPace(geometry, 1)
  writeCarriedArm(geometry, state, out, LEFT, DASH_ARM_TUCK, pace, armCarry?.left)
  writeCarriedArm(geometry, state, out, RIGHT, DASH_ARM_TUCK, pace, armCarry?.right)
}


function trailLeg(geometry: RigGeometry, state: GaitState, out: Pose, side: number): void {
  const hip = (side === LEFT ? Joint.HipL : Joint.HipR) * 3
  state.target[0] = side * geometry.hipWidth
  state.target[1] = geometry.ankleHeight + geometry.legLength * DASH_FOOT_LIFT
  state.target[2] = state.positions[hip + 2]! - geometry.legLength * DASH_TRAIL
  writeLeg(geometry, state, out, side, FOOT_SWING_PITCH * 0.5)
}

function plant(params: GaitParams): void {
  params.frequency = 0
  params.duty = 1
  params.halfStep = 0
  params.runBlend = 0
  params.lift = 0
  params.hipHeight = 0
  params.bob = 0
}
