import { describe, expect, it } from 'vitest'
import { DT } from '../src/sim/types'
import {
  advanceCast,
  CAST_LENGTH,
  castPhase,
  castTimings,
  describePhase,
  LOOP_REST,
  REVIEW_TIMINGS,
  resting,
  WINDUP,
  withWindup,
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
    expect(castTimings('cast')).toEqual({ windup: 1, recovery: 0.2 })
    expect(castTimings('idle')).toEqual(REVIEW_TIMINGS)
  })

  it('overrides only positive wind-ups', () => {
    const timings = { windup: 0.3, recovery: 0.18 }

    expect(withWindup(timings, 0)).toBe(timings)
    expect(withWindup(timings, -1)).toBe(timings)
    expect(withWindup(timings, 5)).toEqual({ windup: 5, recovery: timings.recovery })
  })

  it('holds one-shot casts, wraps loops, and never runs the clock negative', () => {
    expect(advanceCast(0.9, 0.2, REVIEW_TIMINGS, 'hold')).toBe(CAST_LENGTH)
    expect(advanceCast(0.9, 0.2, REVIEW_TIMINGS, 'wrap')).toBeCloseTo(0.1)
    expect(advanceCast(0.1, -0.2, REVIEW_TIMINGS, 'hold')).toBe(0)
    expect(advanceCast(0.1, -0.2, REVIEW_TIMINGS, 'wrap')).toBe(0)
  })

  it('rests between repeated casts and carries the remainder when restarting', () => {
    expect(advanceCast(0.9, 0.2, REVIEW_TIMINGS, 'repeat')).toBeCloseTo(CAST_LENGTH + 0.1)
    expect(advanceCast(CAST_LENGTH + LOOP_REST - 0.1, 0.05, REVIEW_TIMINGS, 'repeat')).toBeCloseTo(
      CAST_LENGTH + LOOP_REST - 0.05,
    )
    expect(advanceCast(CAST_LENGTH + LOOP_REST - 0.1, 0.2, REVIEW_TIMINGS, 'repeat')).toBeCloseTo(0.1)
  })

  it('rests only after the last cast pose and until the repeat wraps', () => {
    expect(resting(0)).toBe(false)
    expect(resting(CAST_LENGTH)).toBe(false)
    expect(resting(CAST_LENGTH + Number.EPSILON)).toBe(true)

    const wrapped = advanceCast(CAST_LENGTH + LOOP_REST - 0.1, 0.2, REVIEW_TIMINGS, 'repeat')
    expect(resting(wrapped)).toBe(false)
  })

  it('says where in the cast it is', () => {
    expect(describePhase({ windup: 0.25 })).toBe('windup 0.25')
    expect(describePhase({ recovery: 0.5 })).toBe('recovery 0.50')
    expect(describePhase(null)).toBe('no cast')
  })
})
