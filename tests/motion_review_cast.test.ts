import { describe, expect, it } from 'vitest'
import { DT } from '../src/sim/types'
import {
  advanceCast,
  CAST_LENGTH,
  castPhase,
  castTimings,
  describePhase,
  REVIEW_TIMINGS,
  WINDUP,
} from '../spike/motion/cast'

describe('the review page plays a skill once', () => {
  it('runs windup then recovery over the cast, and holds at the end', () => {
    expect(castPhase(0)).toEqual({ windup: 0 })
    expect(castPhase(WINDUP * 0.5)).toEqual({ windup: 0.5 })
    expect(castPhase(WINDUP)).toEqual({ recovery: 0 })
    expect(castPhase(CAST_LENGTH)).toEqual({ recovery: 1 })
    expect(castPhase(CAST_LENGTH * 3), 'a finished cast holds its last pose').toEqual({ recovery: 1 })
  })

  it('never runs backwards or off either end', () => {
    expect(castPhase(-1)).toEqual({ windup: 0 })
  })

  it('advances one sim tick per step', () => {
    const stepped = castPhase(DT)
    expect(stepped).toEqual({ windup: DT / WINDUP })
  })

  it('resolves skill, motion, and review-default timings', () => {
    expect(castTimings('cleave')).toEqual({ windup: 0.22, recovery: 0.14 })
    expect(castTimings('cast')).toEqual({ windup: 0.3, recovery: 0.18 })
    expect(castTimings('idle')).toEqual(REVIEW_TIMINGS)
  })

  it('holds one-shot casts, wraps loops, and never runs the clock negative', () => {
    expect(advanceCast(0.9, 0.2, REVIEW_TIMINGS, false)).toBe(CAST_LENGTH)
    expect(advanceCast(0.9, 0.2, REVIEW_TIMINGS, true)).toBeCloseTo(0.1)
    expect(advanceCast(0.1, -0.2, REVIEW_TIMINGS, false)).toBe(0)
    expect(advanceCast(0.1, -0.2, REVIEW_TIMINGS, true)).toBe(0)
  })

  it('says where in the cast it is', () => {
    expect(describePhase({ windup: 0.25 })).toBe('windup 0.25')
    expect(describePhase({ recovery: 0.5 })).toBe('recovery 0.50')
    expect(describePhase(null)).toBe('no cast')
  })
})
