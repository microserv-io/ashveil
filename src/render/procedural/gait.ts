import { clamp, lerp, smoothstep, TAU } from './curves'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { createLimbScratch, plantFeet, resolveTorso, stanceOffset, writeArm, writeLeg, writeTorso, type LimbScratch } from './limbs'
import { resetPose, type Pose } from './pose'

/** What locomotion needs from the sim, already reduced to numbers. */
export interface GaitDrive {
  speed: number
  /** Gait cycle position, integrated by the generator so a speed change cannot jump it. */
  phase: number
  /** Sim seconds, for cycles that do not follow the stride: breathing, weight shift. */
  time: number
  /** Per-body gait offset, so a pack does not march in lockstep. */
  seed: number
  /** Shortest arc turned since the last frame, positive toward the actor's left. */
  facingDelta: number
  /** Change in speed per second, for the lean into acceleration. */
  acceleration: number
}

export interface GaitParams {
  /** Gait cycles per second, per leg. */
  frequency: number
  /** Fraction of the cycle a foot spends on the ground. */
  duty: number
  /** Half the distance a planted foot travels backward through stance. */
  halfStep: number
  /** 0 while walking, 1 while running. */
  runBlend: number
  /** Peak height of the swinging ankle above its planted height. */
  lift: number
  /** Height of the hip above the planted ankle, before the bob takes it down. */
  hipHeight: number
}

export function createGaitDrive(): GaitDrive {
  return { speed: 0, phase: 0, time: 0, seed: 0, facingDelta: 0, acceleration: 0 }
}

export function createGaitParams(): GaitParams {
  return { frequency: 0, duty: 1, halfStep: 0, runBlend: 0, lift: 0, hipHeight: 0 }
}

/** Per-body scratch: the shared limb solvers plus the gait's own derived numbers. */
export interface GaitState extends LimbScratch {
  readonly params: GaitParams
}

export function createGaitState(): GaitState {
  return { ...createLimbScratch(), params: createGaitParams() }
}

/**
 * Stride length in leg lengths per cycle, against speed in leg lengths per second.
 * The two lines are fitted to human cadence, which is why the gait reads right on
 * anything shaped like a person regardless of how big it is.
 */
const WALK_STRIDE = [0.83, 0.48] as const
const RUN_STRIDE = [1.05, 0.45] as const
const WALK_DUTY = 0.58
const RUN_DUTY = 0.22
const RUN_BLEND_LOW = 1.8
const RUN_BLEND_HIGH = 5
/**
 * Peak hip height as a fraction of leg length, walking then running. Never 1: a
 * locked knee has no horizontal reach left for a step, and the bob only ever goes
 * down from here so this stays the worst case the reach budget has to cover.
 */
const WALK_HIP = 0.88
const RUN_HIP = 0.8
const HIP_BOB = 0.025
const REACH_SAFETY = 0.99
const WALK_LIFT = 0.09
const RUN_LIFT = 0.2
const STANCE_NARROW = 0.15
const FOOT_SWING_PITCH = 0.45
const PELVIS_ROLL = 0.04
const PELVIS_YAW = 0.06
const CHEST_COUNTER = 0.8
const LEAN_RUN = 0.22
const LEAN_ACCEL = 0.05
const LEAN_LIMIT = 0.45
const TURN_LEAN = 6
const BANK_LIMIT = 0.25
const SWAY = 0.35
const ARM_SWING_WALK = 0.22
const ARM_SWING_RUN = 0.4
const ARM_HANG = 0.84
const ARM_OUT = 0.22
const ARM_TUCK = 0.12
const IDLE_BREATH_HZ = 0.23
const IDLE_SHIFT_HZ = 0.11
const IDLE_BOB = 0.006
const IDLE_SWAY = 0.06
const IDLE_ROLL = 0.045
const IDLE_BREATH_PITCH = 0.03
const DASH_HIP = 0.84
const DASH_LEAN = 0.5
const DASH_LUNGE = 0.12
const DASH_TRAIL = 0.3
const DASH_FOOT_LIFT = 0.18
const GOLDEN = 0.6180339887498949

/**
 * Frequency is derived from the step, never chosen: a planted foot must travel
 * backward at exactly the actor's speed, so `2 * halfStep = speed * duty /
 * frequency` and the frequency falls out. That is what makes no-slide a property
 * of the construction rather than something to tune towards.
 *
 * When speed outruns the leg, the step clamps to what the leg can reach and the
 * frequency rises to compensate. The feet still do not slide; the legs just whirr.
 */
export function gaitParams(geometry: RigGeometry, speed: number, out: GaitParams): void {
  const legLength = geometry.legLength
  const normalised = legLength > 0 ? speed / legLength : 0
  const runBlend = smoothstep(RUN_BLEND_LOW, RUN_BLEND_HIGH, normalised)
  const stride = lerp(
    WALK_STRIDE[0] + WALK_STRIDE[1] * normalised,
    RUN_STRIDE[0] + RUN_STRIDE[1] * normalised,
    runBlend,
  )
  const duty = lerp(WALK_DUTY, RUN_DUTY, runBlend)
  const hipHeight = legLength * lerp(WALK_HIP, RUN_HIP, runBlend)
  const halfStep = Math.min((stride * legLength * duty) / 2, reachableHalfStep(geometry, hipHeight, runBlend))
  out.frequency = halfStep > 1e-9 ? (speed * duty) / (2 * halfStep) : 0
  out.duty = duty
  out.halfStep = halfStep
  out.runBlend = runBlend
  out.lift = legLength * lerp(WALK_LIFT, RUN_LIFT, runBlend)
  out.hipHeight = hipHeight
}

/**
 * The longest step the leg can take without the IK clamping, and so the one place
 * the whole no-slide construction can fail: a clamped chain puts the ankle short of
 * its target and the foot skates. It is a worst case over the whole cycle, because
 * a step that shrank mid-stride would not be a straight line and so would slide
 * too. Every term is a way the hip moves away from the planted foot.
 */
function reachableHalfStep(geometry: RigGeometry, hipHeight: number, runBlend: number): number {
  const width = geometry.hipWidth
  const reach = geometry.legLength * REACH_SAFETY
  const rise = hipHeight + width * Math.sin(PELVIS_ROLL)
  const sideways = width * (STANCE_NARROW * runBlend + SWAY * PELVIS_ROLL + 1 - Math.cos(PELVIS_ROLL))
  const forward = width * Math.sin(PELVIS_YAW)
  return Math.max(0, Math.sqrt(Math.max(0, reach * reach - rise * rise - sideways * sideways)) - forward)
}

export function strideFrequency(geometry: RigGeometry, speed: number): number {
  gaitParams(geometry, speed, FREQUENCY_PROBE)
  return FREQUENCY_PROBE.frequency
}

export function seedOffset(seed: number): number {
  const offset = seed * GOLDEN
  return offset - Math.floor(offset)
}

export function writeLocomotion(geometry: RigGeometry, drive: GaitDrive, state: GaitState, out: Pose): void {
  resetPose(out)
  gaitParams(geometry, drive.speed, state.params)
  const params = state.params
  const phase = wrap(drive.phase)
  // Down-only, so the peak hip height stays the one the reach budget assumed.
  const bob = -(1 - Math.cos(2 * TAU * phase)) * 0.5 * HIP_BOB * geometry.legLength
  const lean = clamp(LEAN_RUN * params.runBlend + drive.acceleration * LEAN_ACCEL, -LEAN_LIMIT, LEAN_LIMIT)
  const bank = clamp(-drive.facingDelta * TURN_LEAN, -BANK_LIMIT, BANK_LIMIT)
  const roll = PELVIS_ROLL * Math.sin(TAU * phase)
  const yaw = PELVIS_YAW * Math.sin(TAU * phase)

  out.offset[0] = SWAY * roll * geometry.hipWidth
  out.offset[1] = geometry.ankleHeight + params.hipHeight - geometry.hipHeight + bob
  out.offset[2] = 0

  // Lean and bank stay above the pelvis: tilting it would swing the hips out of
  // the reach budget the step length was clamped against, and the feet would slide.
  writeTorso(out, Joint.Pelvis, 0, yaw, roll, state)
  writeTorso(out, Joint.Spine, lean * 0.45, -yaw * 0.3, bank * 0.45, state)
  writeTorso(out, Joint.Chest, lean * 0.55, -yaw * CHEST_COUNTER, bank * 0.35, state)
  writeTorso(out, Joint.Head, -lean * 0.6, yaw * 0.4, -bank * 0.4, state)
  resolveTorso(geometry, out, state)

  writeGaitLeg(geometry, state, out, LEFT, phase)
  writeGaitLeg(geometry, state, out, RIGHT, phase + 0.5)
  const swing = lerp(ARM_SWING_WALK, ARM_SWING_RUN, params.runBlend) * geometry.armLength
  hangArm(geometry, state, out, LEFT, Math.sin(TAU * wrap(phase + 0.5)) * swing, params.runBlend)
  hangArm(geometry, state, out, RIGHT, Math.sin(TAU * phase) * swing, params.runBlend)
}

export function writeIdle(geometry: RigGeometry, drive: GaitDrive, state: GaitState, out: Pose): void {
  resetPose(out)
  plant(state.params)
  const offset = seedOffset(drive.seed)
  const breath = Math.sin(TAU * (drive.time * IDLE_BREATH_HZ + offset))
  const shift = Math.sin(TAU * (drive.time * IDLE_SHIFT_HZ + offset))

  out.offset[0] = shift * IDLE_SWAY * geometry.hipWidth
  out.offset[1] = stanceOffset(geometry) + breath * IDLE_BOB * geometry.legLength
  out.offset[2] = 0

  writeTorso(out, Joint.Pelvis, 0, 0, -shift * IDLE_ROLL, state)
  writeTorso(out, Joint.Spine, breath * IDLE_BREATH_PITCH, 0, shift * IDLE_ROLL * 0.4, state)
  writeTorso(out, Joint.Chest, breath * IDLE_BREATH_PITCH * 1.4, 0, shift * IDLE_ROLL * 0.3, state)
  writeTorso(out, Joint.Head, -breath * IDLE_BREATH_PITCH, shift * 0.06, 0, state)
  plantFeet(geometry, state, out)

  hangArm(geometry, state, out, LEFT, breath * 0.01 * geometry.armLength, 0)
  hangArm(geometry, state, out, RIGHT, -breath * 0.01 * geometry.armLength, 0)
}

/**
 * A held pose, not a sprint: `dash` outlives the skill that started it, so the body
 * stays committed forward with its legs trailing until the flag clears.
 */
export function writeDash(geometry: RigGeometry, _drive: GaitDrive, state: GaitState, out: Pose): void {
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

  for (const side of SIDES) {
    const hip = side === LEFT ? Joint.HipL : Joint.HipR
    state.target[0] = side * geometry.hipWidth
    state.target[1] = geometry.ankleHeight + geometry.legLength * DASH_FOOT_LIFT
    state.target[2] = state.positions[hip * 3 + 2]! - geometry.legLength * DASH_TRAIL
    writeLeg(geometry, state, out, side, FOOT_SWING_PITCH * 0.5)
  }
  hangArm(geometry, state, out, LEFT, -geometry.armLength * 0.3, 1)
  hangArm(geometry, state, out, RIGHT, -geometry.armLength * 0.3, 1)
}

const SIDES = [LEFT, RIGHT] as const
const FREQUENCY_PROBE = createGaitParams()

function wrap(phase: number): number {
  return phase - Math.floor(phase)
}

/** A pose that is not walking: one long stance, no step, no swing. */
function plant(params: GaitParams): void {
  params.frequency = 0
  params.duty = 1
  params.halfStep = 0
  params.runBlend = 0
  params.lift = 0
  params.hipHeight = 0
}

function writeGaitLeg(geometry: RigGeometry, state: GaitState, out: Pose, side: number, legPhase: number): void {
  const { duty, halfStep, runBlend, lift } = state.params
  const phase = wrap(legPhase)
  let swing = 0
  if (phase < duty) {
    // Stance: straight back at the actor's own speed, which is the no-slide rule.
    state.target[1] = geometry.ankleHeight
    state.target[2] = halfStep - 2 * halfStep * (phase / duty)
  } else {
    const s = (phase - duty) / (1 - duty)
    swing = Math.sin(Math.PI * s)
    state.target[1] = geometry.ankleHeight + lift * swing
    state.target[2] = -halfStep + 2 * halfStep * smoothstep(0, 1, s)
  }
  state.target[0] = side * geometry.hipWidth * (1 - STANCE_NARROW * runBlend)
  writeLeg(geometry, state, out, side, -FOOT_SWING_PITCH * swing)
}

function hangArm(geometry: RigGeometry, state: GaitState, out: Pose, side: number, swing: number, runBlend: number): void {
  const hang = geometry.armLength * (ARM_HANG - ARM_TUCK * runBlend)
  writeArm(geometry, state, out, side, side * hang * ARM_OUT, -hang, swing)
}
