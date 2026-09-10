import { MOTION_TIMINGS, type MotionTimings } from '../../src/render/procedural/clips'
import type { RigState } from '../../src/render/rig'
import type { RigPhase } from '../../src/render/riginput'
import { SKILLS } from '../../src/sim/skills'
import type { SkillId } from '../../src/sim/types'

/**
 * The cast clock the review page drives a skill with.
 *
 * A cast plays once and holds by default, so a pose can be inspected. Loop
 * repeats it with a rest, while Cycle restarts it — the whole interaction on a
 * phone is one tap, one swing.
 */

/** A representative cast: long enough to read, close to the sim's own timings. */
export const WINDUP = 0.4
export const RECOVERY = 0.6
export const CAST_LENGTH = WINDUP + RECOVERY
/** The generator's state blend needs an idle beat between repeats; wrapping a cast straight to its first key pops. */
export const LOOP_REST = 0.5
export const REVIEW_TIMINGS: MotionTimings = { windup: WINDUP, recovery: RECOVERY }
export type CastMode = 'hold' | 'wrap' | 'repeat'

/** A state is reviewed at the rate it really plays at, not one stand-in cast. */
export function castTimings(state: RigState): MotionTimings {
  if (state in SKILLS) {
    const skill = SKILLS[state as SkillId]
    return { windup: skill.windup, recovery: skill.recovery }
  }
  if (state in MOTION_TIMINGS) return MOTION_TIMINGS[state as keyof typeof MOTION_TIMINGS]
  return REVIEW_TIMINGS
}

/** A cast is reviewed at the sim's timing unless the reviewer wants to watch a long gather. */
export function withWindup(timings: MotionTimings, windup: number): MotionTimings {
  return windup <= 0 ? timings : { windup, recovery: timings.recovery }
}

/** Where in its wind-up or recovery a cast is, `seconds` into it. */
export function castPhase(seconds: number, timings: MotionTimings = REVIEW_TIMINGS): RigPhase {
  const at = Math.min(castLength(timings), Math.max(0, seconds))
  return at < timings.windup
    ? { windup: at / timings.windup }
    : { recovery: (at - timings.windup) / timings.recovery }
}

/** How much of the cast is left, which is what the sim would report. */
export function castLeft(seconds: number, timings: MotionTimings = REVIEW_TIMINGS): number {
  return Math.max(0, castLength(timings) - Math.max(0, seconds))
}

export function recovering(seconds: number, timings: MotionTimings = REVIEW_TIMINGS): boolean {
  return seconds >= timings.windup
}

export function castLength(timings: MotionTimings = REVIEW_TIMINGS): number {
  return timings.windup + timings.recovery
}

export function resting(seconds: number, timings: MotionTimings = REVIEW_TIMINGS): boolean {
  return seconds > castLength(timings)
}

/** Where the clock is after `delta`, preserving overshoot when a mode repeats. */
export function advanceCast(seconds: number, delta: number, timings: MotionTimings, mode: CastMode): number {
  const next = Math.max(0, seconds + delta)
  const length = castLength(timings)
  if (mode === 'hold') return Math.min(length, next)
  return next % (mode === 'wrap' ? length : length + LOOP_REST)
}

export function describePhase(phase: RigPhase): string {
  if (phase === null) return 'no cast'
  return 'windup' in phase ? `windup ${phase.windup.toFixed(2)}` : `recovery ${phase.recovery.toFixed(2)}`
}
