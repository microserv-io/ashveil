import { describe, expect, it } from 'vitest'
import { DT } from '../src/sim/types'
import { CAST_LENGTH, castPhase, describePhase, WINDUP } from '../spike/motion/cast'

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

  it('says where in the cast it is', () => {
    expect(describePhase({ windup: 0.25 })).toBe('windup 0.25')
    expect(describePhase({ recovery: 0.5 })).toBe('recovery 0.50')
    expect(describePhase(null)).toBe('no cast')
  })
})
