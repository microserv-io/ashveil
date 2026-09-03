import { armPace } from './armpace'
import { writeCarriedArm } from './arms'
import { TAU } from './curves'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { plantFeet, stanceOffset, writeTorso } from './limbs'
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
  writeCarriedArm(geometry, state, out, LEFT, -breath * IDLE_ARM_DRIFT, pace, armCarry?.left)
  writeCarriedArm(geometry, state, out, RIGHT, breath * IDLE_ARM_DRIFT, pace, armCarry?.right)
}

/** Idle and dash both hold the gait still while their stance is posed. */
export function plant(params: GaitParams): void {
  params.frequency = 0
  params.duty = 1
  params.halfStep = 0
  params.runBlend = 0
  params.lift = 0
  params.hipHeight = 0
  params.bob = 0
}
