import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAY_DURATION_SECONDS,
  DEFAULT_START_HOUR,
  MAX_DAY_DURATION_SECONDS,
  WorldClock,
} from '../src/world/world-clock'

describe('world clock', () => {
  it('starts at 08:00 and wraps one default day in exactly 600 seconds', () => {
    const clock = new WorldClock({ nowMilliseconds: 1_000 })
    expect(clock.read(1_000).hour).toBe(DEFAULT_START_HOUR)
    expect(clock.read(151_000).hour).toBe(14)
    expect(clock.read(601_000).hour).toBe(DEFAULT_START_HOUR)
    expect(clock.read(601_000).durationSeconds).toBe(DEFAULT_DAY_DURATION_SECONDS)
  })

  it('supports alternate durations and large elapsed gaps without a frame clamp', () => {
    const clock = new WorldClock({ nowMilliseconds: 500, startHour: 23, durationSeconds: 80 })
    expect(clock.read(20_500).hour).toBe(5)
    expect(clock.read(800_500).hour).toBeCloseTo(23, 10)
  })

  it('remains continuous around midnight', () => {
    const clock = new WorldClock({ nowMilliseconds: 0, startHour: 23.9, durationSeconds: 240 })
    expect(clock.read(999).hour).toBeGreaterThan(23.9)
    expect(clock.read(1_001).hour).toBeLessThan(0.01)
  })

  it('wraps finite hour inputs and rejects invalid clock inputs', () => {
    const clock = new WorldClock({ nowMilliseconds: 0, startHour: -1 })
    expect(clock.read(0).hour).toBe(23)
    clock.setHour(49, 0)
    expect(clock.read(0).hour).toBe(1)
    expect(() => clock.setHour(Number.NaN, 0)).toThrow(/hour/)
    expect(() => new WorldClock({ nowMilliseconds: Number.POSITIVE_INFINITY })).toThrow(/monotonic/)
    expect(() => clock.read(Number.NaN)).toThrow(/monotonic/)
  })

  it('leaves its state unchanged when a configuration input is rejected', () => {
    const clock = new WorldClock({ nowMilliseconds: 0 })
    const before = clock.read(50_000)
    expect(() => clock.setHour(Number.NaN, 50_000)).toThrow(/hour/)
    expect(clock.read(50_000)).toEqual(before)
    expect(() => clock.setDuration(Number.MIN_VALUE, 50_000)).toThrow(/duration/)
    expect(clock.read(50_000)).toEqual(before)
  })

  it.each([0, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY, MAX_DAY_DURATION_SECONDS + 1])(
    'rejects invalid duration %s',
    (durationSeconds) => {
      expect(() => new WorldClock({ nowMilliseconds: 0, durationSeconds })).toThrow(/duration/)
      const clock = new WorldClock({ nowMilliseconds: 0 })
      expect(() => clock.setDuration(durationSeconds, 0)).toThrow(/duration/)
    },
  )

  it('preserves phase while pausing, resuming and changing duration', () => {
    const clock = new WorldClock({ nowMilliseconds: 1_000 })
    const beforePause = clock.read(26_000).hour
    clock.setPaused(true, 26_000)
    expect(clock.read(526_000)).toMatchObject({ hour: beforePause, paused: true })
    clock.setDuration(1_200, 526_000)
    expect(clock.read(526_000)).toMatchObject({ hour: beforePause, durationSeconds: 1_200 })
    clock.setPaused(false, 526_000)
    expect(clock.read(826_000)).toMatchObject({ hour: beforePause + 6, paused: false })
  })
})
