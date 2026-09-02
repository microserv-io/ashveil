import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readMotionMode } from '../src/render/motionmode'
import { baselinePath } from '../scripts/perf.mjs'

/**
 * Clip motion is what ships, so it is what an unqualified URL gets. A misspelled
 * mode is loud rather than silent: `?motion=procedual` quietly rendering clips is
 * an hour spent reviewing the wrong thing.
 */
describe('motion mode selection', () => {
  it('defaults to clip', () => {
    expect(readMotionMode('')).toBe('clip')
    expect(readMotionMode('?seed=7')).toBe('clip')
    expect(readMotionMode('?seed=7&ui=1.4')).toBe('clip')
  })

  it('reads both modes from the query string', () => {
    expect(readMotionMode('?motion=clip')).toBe('clip')
    expect(readMotionMode('?motion=procedural')).toBe('procedural')
    expect(readMotionMode('?seed=7&motion=procedural')).toBe('procedural')
  })

  it('rejects a mode nobody implements', () => {
    expect(() => readMotionMode('?motion=procedual')).toThrow(/clip or procedural/)
    expect(() => readMotionMode('?motion=')).toThrow(/clip or procedural/)
  })

  /** Each mode paces the frame differently, so each carries its own baseline. */
  it('keeps one perf baseline per motion mode', () => {
    expect(basename(baselinePath('clip'))).toBe('baseline.json')
    expect(basename(baselinePath('procedural'))).toBe('baseline.procedural.json')
  })
})
