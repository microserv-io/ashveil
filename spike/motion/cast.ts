import { MOTION_TIMINGS, type MotionTimings } from '../../src/render/procedural/clips'
import type { RigState } from '../../src/render/rig'
import type { RigPhase } from '../../src/render/riginput'
import { SKILLS } from '../../src/sim/skills'
import type { SkillId } from '../../src/sim/types'

/**
 * The cast clock the review page drives a skill with.
 *
 * A skill is one wind-up and one recovery, played once and then held, so a pose
 * can be looked at instead of watched going past. The Cycle button starts it
 * again, which is the whole interaction on a phone: one tap, one swing.
 */

/** A representative cast: long enough to read, close to the sim's own timings. */
export const WINDUP = 0.4
export const RECOVERY = 0.6
export const CAST_LENGTH = WINDUP + RECOVERY
export const REVIEW_TIMINGS: MotionTimings = { windup: WINDUP, recovery: RECOVERY }

/** A state is reviewed at the rate it really plays at, not one stand-in cast. */
export function castTimings(state: RigState): MotionTimings {
  if (state in SKILLS) {
    const skill = SKILLS[state as SkillId]
    return { windup: skill.windup, recovery: skill.recovery }
  }
  if (state in MOTION_TIMINGS) return MOTION_TIMINGS[state as keyof typeof MOTION_TIMINGS]
  return REVIEW_TIMINGS
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

/** Where the clock is after `delta`: a looping clip wraps, every other one holds at the end. */
export function advanceCast(seconds: number, delta: number, timings: MotionTimings, loop: boolean): number {
  const next = Math.max(0, seconds + delta)
  const length = castLength(timings)
  return loop ? next % length : Math.min(length, next)
}

export function describePhase(phase: RigPhase): string {
  if (phase === null) return 'no cast'
  return 'windup' in phase ? `windup ${phase.windup.toFixed(2)}` : `recovery ${phase.recovery.toFixed(2)}`
}
