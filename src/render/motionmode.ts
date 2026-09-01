/**
 * Which animation pipeline a body uses. Clip motion is what ships; `?motion=procedural`
 * swaps in the pose generator for the whole page, so a review is of one or the other
 * and never of a mixture.
 */
export type MotionMode = 'clip' | 'procedural'

export function readMotionMode(search: string): MotionMode {
  const raw = new URLSearchParams(search).get('motion')
  if (raw === null) return 'clip'
  // Loud on a typo: `?motion=procedual` silently rendering clips is an hour spent
  // reviewing the wrong thing.
  if (raw !== 'clip' && raw !== 'procedural') throw new Error(`motion must be clip or procedural, got "${raw}"`)
  return raw
}

/** The mode this page was loaded with. Constant for the life of the document. */
export function motionMode(): MotionMode {
  if (current === null) current = readMotionMode(globalThis.location?.search ?? '')
  return current
}

let current: MotionMode | null = null
