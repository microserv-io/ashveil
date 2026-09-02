import type { ArmCarry } from '../profiles/profile'
import { armSwingAmplitude, writeCarriedArm } from './arms'
import { clamp, lerp, smoothstep, softMin, TAU } from './curves'
import type { RigGeometry } from './geometry'
import { Joint, LEFT, RIGHT } from './joints'
import { createLimbScratch, resolveTorso, writeTorso, type LimbScratch } from './limbs'
import { resetPose, type Pose } from './pose'
import { writeStrideLeg } from './stride'
import { hipBob, hipBobAmplitude, pelvisTurn, reachableHalfStep, stanceHipHeight, torsoBobPitch } from './proportions'

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
  /** Height of the hip above the planted ankle, at mid-stance, before the bob. */
  hipHeight: number
  /** How far the hip drops from `hipHeight` between mid-stances. */
  bob: number
}

export function createGaitDrive(): GaitDrive {
  return { speed: 0, phase: 0, time: 0, seed: 0, facingDelta: 0, acceleration: 0 }
}

export function createGaitParams(): GaitParams {
  return { frequency: 0, duty: 1, halfStep: 0, runBlend: 0, lift: 0, hipHeight: 0, bob: 0 }
}

/** Per-body scratch: the shared limb solvers plus the gait's own derived numbers. */
export interface GaitState extends LimbScratch {
  readonly params: GaitParams
}

export function createGaitState(): GaitState {
  return { ...createLimbScratch(), params: createGaitParams() }
}

/**
 * Stride length in nominal leg lengths per cycle, against speed in nominal leg
 * lengths per second. The two lines are fitted to human cadence, which is why the
 * gait reads right on anything shaped like a person regardless of how big it is.
 */
const WALK_STRIDE = [0.83, 0.48] as const
const RUN_STRIDE = [1.05, 0.45] as const
const WALK_DUTY = 0.53
const RUN_DUTY = 0.22
/**
 * The longest a leg spends in the air, for a leg as long as the nominal one. A
 * real swing is close to speed-invariant, so this stops a body whose step has hit
 * its reach limit answering more speed with more flight: it puts the foot down
 * and takes another step instead.
 */
const MAX_SWING_TIME = 0.5
/**
 * Where a walk becomes a run, in leg lengths per second. People break into a run
 * around 2.3, and reading it in leg lengths rather than metres is what lets a
 * short-legged body run at a speed a long-legged one still walks.
 */
const RUN_BLEND_LOW = 2.3
const RUN_BLEND_HIGH = 3.2
const WALK_LIFT = 0.09
const RUN_LIFT = 0.2
const PELVIS_ROLL = 0.04
/** The chest turns back against the pelvis, about half as far. */
const CHEST_COUNTER = 0.5
/** How much the torso may pitch over a cycle: a nodding chest reads long before a bobbing head. */
const TORSO_PITCH = 4 * Math.PI / 180
/** How far a body at full speed leans into it. A run is a fall the legs keep up with. */
const LEAN_RUN = 0.28
const LEAN_ACCEL = 0.05
/** How much of the chest's pitch the head takes, and the most it takes. */
const HEAD_FOLLOW = 0.25
const HEAD_PITCH = 2 * Math.PI / 180
const LEAN_LIMIT = 0.45
const TURN_LEAN = 6
const BANK_LIMIT = 0.25
/** How far the hips shift over the leg that is carrying, as a fraction of hip width. */
const SWAY = 0.22
const GOLDEN = 0.6180339887498949
/**
 * Frequency is derived from the step, never chosen: a planted foot must travel
 * backward at exactly the actor's speed, so `2 * halfStep = speed * stanceTime`
 * and the rest of the cycle is the swing. That is what makes no-slide a property
 * of the construction rather than something to tune towards.
 *
 * The cadence model asks for a stride and a duty; the leg answers with what it
 * can reach and how fast it can swing. When speed outruns the step the cycle
 * shortens and the legs whirr, which is the honest thing for a body with legs
 * that short to do. The cost is that a planted foot then moves `speed * DT` every
 * frame however the body is posed, so above a walk the leg joints necessarily
 * turn faster than the 0.2 rad a frame the torso keeps to.
 */
export function gaitParams(geometry: RigGeometry, speed: number, out: GaitParams): void {
  const nominalLegLength = geometry.nominalLegLength
  const normalised = nominalLegLength > 0 ? speed / nominalLegLength : 0
  const runBlend = smoothstep(RUN_BLEND_LOW, RUN_BLEND_HIGH, normalised)
  const stride = lerp(
    WALK_STRIDE[0] + WALK_STRIDE[1] * normalised,
    RUN_STRIDE[0] + RUN_STRIDE[1] * normalised,
    runBlend,
  )
  const wantedDuty = lerp(WALK_DUTY, RUN_DUTY, runBlend)
  const cycle = speed > 1e-6 ? (stride * nominalLegLength) / speed : 0
  const halfStep = Math.min((stride * nominalLegLength * wantedDuty) / 2, reachableHalfStep(geometry))
  const stance = speed > 1e-6 ? (2 * halfStep) / speed : 0
  const swing = Math.min(cycle * (1 - wantedDuty), MAX_SWING_TIME * legProportion(geometry))
  const period = stance + swing

  out.frequency = period > 1e-9 ? 1 / period : 0
  out.duty = period > 1e-9 ? stance / period : 1
  out.halfStep = halfStep
  out.runBlend = runBlend
  out.lift = geometry.legLength * lerp(WALK_LIFT, RUN_LIFT, runBlend)
  out.hipHeight = stanceHipHeight(geometry, runBlend)
  out.bob = hipBobAmplitude(geometry, out.hipHeight, halfStep, runBlend)
}

/** How long this body's legs are against the human the gait scales are fitted to. */
function legProportion(geometry: RigGeometry): number {
  return geometry.nominalLegLength > 0 ? Math.min(1, geometry.legLength / geometry.nominalLegLength) : 1
}

export function strideFrequency(geometry: RigGeometry, speed: number): number {
  gaitParams(geometry, speed, FREQUENCY_PROBE)
  return FREQUENCY_PROBE.frequency
}

export function seedOffset(seed: number): number {
  const offset = seed * GOLDEN
  return offset - Math.floor(offset)
}

export function writeLocomotion(
  geometry: RigGeometry,
  drive: GaitDrive,
  state: GaitState,
  out: Pose,
  armCarry?: ArmCarry,
): void {
  resetPose(out)
  gaitParams(geometry, drive.speed, state.params)
  const params = state.params
  const phase = wrap(drive.phase)
  // Down-only, so the peak hip height stays the one the reach budget assumed.
  const bob = -hipBob(geometry, params.hipHeight, params.halfStep, params.duty, params.runBlend, phase)
  // Pitching forward while the hips ride high takes some of the bob off the head,
  // but only some: buying height costs the square of the angle.
  const bobPitch = softMin(torsoBobPitch(geometry, (bob + params.bob) * 0.5), TORSO_PITCH, TORSO_PITCH * 0.5)
  const lean = clamp(LEAN_RUN * params.runBlend + drive.acceleration * LEAN_ACCEL, -LEAN_LIMIT, LEAN_LIMIT)
  const bank = clamp(-drive.facingDelta * TURN_LEAN, -BANK_LIMIT, BANK_LIMIT)
  // A chibi's hips are a large fraction of its legs, so the same tilt swings its
  // feet much further sideways than a person's would.
  const proportion = legProportion(geometry)
  const roll = PELVIS_ROLL * proportion * proportion * Math.sin(TAU * phase)
  // Leading, not trailing: the hip over the foot that is reaching forward turns
  // forward with it, which is where the extra step length comes from. A sine here
  // put the turn a quarter cycle out of step with the legs.
  const yaw = -pelvisTurn(geometry) * Math.cos(TAU * phase)

  out.offset[0] = SWAY * geometry.hipWidth * Math.sin(TAU * phase)
  out.offset[1] = geometry.ankleHeight + params.hipHeight - geometry.hipHeight + bob
  out.offset[2] = 0

  // Lean and bank stay above the pelvis: tilting it would swing the hips out of
  // the reach budget the step length was clamped against, and the feet would slide.
  writeTorso(out, Joint.Pelvis, 0, yaw, roll, state)
  writeTorso(out, Joint.Spine, lean * 0.45 + bobPitch, -yaw * 0.3, bank * 0.45, state)
  writeTorso(out, Joint.Chest, lean * 0.55 + bobPitch, -yaw * CHEST_COUNTER, bank * 0.35, state)
  // Rotations are absolute, so a level head is no pitch at all — but held exactly
  // level over a leaning body it reads as a doll's. It follows a little way.
  const nod = clamp((lean * 0.55 + bobPitch) * HEAD_FOLLOW, -HEAD_PITCH, HEAD_PITCH)
  writeTorso(out, Joint.Head, nod, yaw * 0.4, -bank * 0.4, state)
  resolveTorso(geometry, out, state)

  const left = writeStrideLeg(geometry, params, state, out, LEFT, phase)
  const right = writeStrideLeg(geometry, params, state, out, RIGHT, phase + 0.5)
  // Each arm swings against the foot on its own side, driven by where that foot
  // actually is rather than by a wave fitted alongside it: a sine of the cycle is
  // a quarter-turn out of step with a stride whose stance is not half of it.
  // Clamped to the step: a swing foot reaches past its own footfall and comes
  // back, and the arm answers the stride rather than the overshoot.
  const swing = armSwingAmplitude(geometry, params.runBlend)
  const step = Math.max(1e-6, params.halfStep)
  writeCarriedArm(geometry, state, out, LEFT, clamp(left / step, -1, 1) * swing, params.runBlend, armCarry?.left)
  writeCarriedArm(geometry, state, out, RIGHT, clamp(right / step, -1, 1) * swing, params.runBlend, armCarry?.right)
}

const FREQUENCY_PROBE = createGaitParams()

function wrap(phase: number): number {
  return phase - Math.floor(phase)
}
