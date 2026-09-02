import { describe, expect, it } from 'vitest'
import { comparePerfReports, parsePerfOptions } from '../scripts/perf.mjs'

describe('performance harness options', () => {
  it('parses the options that affect the single procedural run', () => {
    expect(parsePerfOptions([])).toEqual({ record: false, keepOpen: false, seed: 7, frames: 2400 })
    expect(parsePerfOptions(['--record', '--headed', '--seed', '12', '--frames', '90'])).toEqual({
      record: true,
      keepOpen: true,
      seed: 12,
      frames: 90,
    })
  })

  it('compares runs without a motion discriminator', () => {
    expect(comparePerfReports(perfReport(), perfReport())).toEqual({ failures: [], notes: [] })
  })
})

function perfReport() {
  return {
    renderer: 'test',
    softwareRasterised: false,
    frameMs: { p50: 1, p95: 1, p99: 1, max: 1 },
    overBudget: { count: 0, share: 0 },
    viewport: { width: 1600, height: 900, pixelRatio: 1 },
    workload: { ticks: 2400, depth: 1, monstersKilled: 10 },
    scene: { drawCalls: 100, triangles: 1000 },
  }
}
