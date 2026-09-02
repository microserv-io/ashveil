import { lerp, TAU } from './curves'
import type { RigGeometry } from './geometry'
import { Joint } from './joints'

/**
 * The stance leg's geometry: how high the hip may ride, how far a foot may travel
 * under it, and how far the hip has to drop to keep that foot on the ground.
 *
 * All of it falls out of one number. A planted foot and a hip are the two ends of
 * a two-bone chain, so choosing how bent the knee is allowed to look fixes the
 * span the leg may use, and the span fixes everything else: the hip height at
 * mid-stance, the longest step, and the bob. Nothing here is tuned by eye.
 */

/**
 * How bent the stance knee is allowed to look. This is the gait's one real dial:
 * straighter buys a taller, stiffer walk and a deeper bob, deeper buys a squat
 * and a flat one. A person walks at about 20 degrees.
 */
const STANCE_KNEE = 17 * Math.PI / 180
/** Hip height while running, as a fraction of the leg. A run is a crouch. */
const RUN_HIP_HEIGHT = 0.8
/** How far the stance leg swings from vertical at either end of stance. */
const MAX_STANCE_SWING = 30 * Math.PI / 180
/**
 * How much of the leg the stance may span. The headroom left to full extension
 * covers what the step budget does not model — the pelvis roll, yaw and sway
 * written on top of it — and keeps the chain off its own singularity, where knee
 * angle is most sensitive to the foot moving and the knee flicks.
 */
const REACH_MARGIN = 0.995
const SWING_REACH = 0.9
/**
 * Vertical travel of the hip in a run, as a fraction of the nominal leg. The run
 * hip is already low enough to reach its own step, so unlike the walk nothing
 * geometric forces a bob here and this is the one number that is chosen.
 */
const RUN_BOB = 0.05

/**
 * The longest span the stance leg may use, and so the one place the whole
 * no-slide construction can fail: past it the IK clamps, the ankle lands short of
 * its target and the foot skates. It is a worst case over the whole cycle,
 * because a step that shrank mid-stride would not be a straight line either.
 */
export function stanceReach(geometry: RigGeometry): number {
  return geometry.legLength * REACH_MARGIN
}

/**
 * The span a swinging leg may use. Well short of the stance's, because a swinging
 * foot travels several centimetres a frame and a chain near full extension turns
 * that into a knee that snaps straight. A real leg swings folded anyway.
 */
export function swingReach(geometry: RigGeometry): number {
  return geometry.legLength * SWING_REACH
}

/** Hip height at mid-stance, where the foot is directly underneath it. */
export function stanceHipHeight(geometry: RigGeometry, runBlend: number): number {
  return lerp(kneeSpan(geometry, STANCE_KNEE), geometry.legLength * RUN_HIP_HEIGHT, runBlend)
}

/** The longest half-step the leg can swing to, whatever the cadence model wants. */
export function reachableHalfStep(geometry: RigGeometry): number {
  return stanceReach(geometry) * Math.sin(MAX_STANCE_SWING)
}

/**
 * How far the hip has dropped below mid-stance at this phase. With a foot out in
 * front the hip is further from it than the leg is long, so it has to come down:
 * the walk's bob is a consequence of the step rather than a decoration on it, and
 * this is the envelope of both feet rather than a shape fitted to it.
 *
 * A run's hip is already crouched below what its step needs, so nothing geometric
 * forces a bob there and the chosen run amplitude takes over.
 */
export function hipBob(
  geometry: RigGeometry,
  hipHeight: number,
  halfStep: number,
  duty: number,
  runBlend: number,
  phase: number,
): number {
  const reach = stanceReach(geometry)
  const forward = halfStep * footEnvelope(phase, duty)
  const clear = Math.sqrt(Math.max(0, reach * reach - forward * forward))
  const wave = Math.sin(TAU * (phase - duty * 0.5))
  const chosen = RUN_BOB * geometry.nominalLegLength * runBlend * wave * wave
  return Math.max(hipHeight - clear, chosen, 0)
}

/** The deepest that bob ever gets, which is what the head has to be shielded from. */
export function hipBobAmplitude(
  geometry: RigGeometry,
  hipHeight: number,
  halfStep: number,
  runBlend: number,
): number {
  const reach = stanceReach(geometry)
  const clear = Math.sqrt(Math.max(0, reach * reach - halfStep * halfStep))
  return Math.max(hipHeight - clear, RUN_BOB * geometry.nominalLegLength * runBlend, 0)
}

/**
 * How far the furthest planted foot is from under the hip, as a fraction of the
 * half-step, over the half-cycle between one mid-stance and the next. Taking each
 * foot's own excursion and maximising them steps the hip up by a centimetre the
 * instant a foot leaves the ground; this reaches full extent early enough to
 * cover both legs and then holds, which is the same envelope without the corner.
 */
function footEnvelope(phase: number, duty: number): number {
  const sinceMidStance = phase - duty * 0.5
  const half = sinceMidStance - Math.floor(sinceMidStance * 2 + 0.5) * 0.5
  const rise = Math.max(1e-6, Math.min(duty, 1 - duty) * 0.5)
  return Math.min(1, Math.abs(half) / rise)
}

function kneeSpan(geometry: RigGeometry, bend: number): number {
  const { thigh, shin } = geometry
  return Math.sqrt(thigh * thigh + shin * shin + 2 * thigh * shin * Math.cos(bend))
}

/**
 * The forward pitch that lowers the head by `drop` while the hips ride high, so
 * the head travels less than they do. Pitch is a poor lever on height — the drop
 * goes as one minus its cosine — so the caller caps this well before it buys
 * back a whole bob, and a nodding torso reads worse than a bobbing head.
 */
export function torsoBobPitch(geometry: RigGeometry, drop: number): number {
  const span = geometry.rest[Joint.Head * 3 + 1]! - geometry.rest[Joint.Spine * 3 + 1]!
  if (span <= 0 || drop <= 0) return 0
  return Math.acos(Math.max(-1, 1 - drop / span))
}
