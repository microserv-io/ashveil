import type { RigPhase } from '../../src/render/riginput'

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

/** Where in its wind-up or recovery a cast is, `seconds` into it. */
export function castPhase(seconds: number): RigPhase {
  const at = Math.min(CAST_LENGTH, Math.max(0, seconds))
  return at < WINDUP ? { windup: at / WINDUP } : { recovery: (at - WINDUP) / RECOVERY }
}

/** How much of the cast is left, which is what the sim would report. */
export function castLeft(seconds: number): number {
  return Math.max(0, CAST_LENGTH - Math.max(0, seconds))
}

export function recovering(seconds: number): boolean {
  return seconds >= WINDUP
}

export function describePhase(phase: RigPhase): string {
  if (phase === null) return 'no cast'
  return 'windup' in phase ? `windup ${phase.windup.toFixed(2)}` : `recovery ${phase.recovery.toFixed(2)}`
}
