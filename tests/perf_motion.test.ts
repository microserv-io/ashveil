import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comparePerfReports, parsePerfOptions } from '../scripts/perf.mjs'

describe('performance motion fingerprint', () => {
  it('pins clip motion in the recorded baseline', () => {
    const baseline = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'perf', 'baseline.json'), 'utf8')) as {
      motion?: string
      workload: { motion?: string }
    }

    expect(baseline.motion).toBe('clip')
    expect(baseline.workload.motion).toBe('clip')
  })

  it('pins procedural motion in its own baseline', () => {
    const baseline = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'perf', 'baseline.procedural.json'), 'utf8'),
    ) as { motion?: string; workload: { motion?: string } }

    expect(baseline.motion).toBe('procedural')
    expect(baseline.workload.motion).toBe('procedural')
  })

  it('defaults to clip and accepts both explicit modes', () => {
    expect(parsePerfOptions([]).motion).toBe('clip')
    expect(parsePerfOptions(['--motion', 'clip']).motion).toBe('clip')
    expect(parsePerfOptions(['--motion', 'procedural']).motion).toBe('procedural')
  })

  it('rejects an unknown motion mode', () => {
    expect(() => parsePerfOptions(['--motion', 'mixed'])).toThrow(/clip or procedural/)
  })

  it('fails comparison when the run has no baseline for its motion mode', () => {
    const report = perfReport('procedural')
    const baseline = perfReport('clip')

    expect(comparePerfReports(report, baseline)).toEqual({
      failures: ['no baseline for motion=procedural, run with --record'],
      notes: [],
    })
  })
})

function perfReport(motion: 'clip' | 'procedural') {
  return {
    renderer: 'test',
    softwareRasterised: false,
    frameMs: { p50: 1, p95: 1, p99: 1, max: 1 },
    overBudget: { count: 0, share: 0 },
    viewport: { width: 1600, height: 900, pixelRatio: 1 },
    workload: { motion, ticks: 2400, depth: 1, monstersKilled: 10 },
    scene: { drawCalls: 100, triangles: 1000 },
  }
}
