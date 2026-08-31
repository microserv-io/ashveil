import { describe, expect, it } from 'vitest'
import {
  autoRigProArtifactNames,
  parseAutoRigProSpikeArgs,
} from '../scripts/art/auto-rig-pro-spike'

describe('Auto-Rig Pro diagnostic benchmark', () => {
  it('requires an explicit two-phase command contract', () => {
    expect(() => parseAutoRigProSpikeArgs([])).toThrow('Usage:')
    expect(
      parseAutoRigProSpikeArgs([
        'prepare-live',
        '--input',
        'prepared',
        '--session',
        'marker-session.blend',
      ]),
    ).toEqual({
      phase: 'prepare-live',
      input: 'prepared',
      session: 'marker-session.blend',
    })
    expect(
      parseAutoRigProSpikeArgs([
        'build',
        '--input',
        'prepared',
        '--session',
        'marker-session.blend',
        '--output',
        'rigged-auto-rig-pro',
      ]),
    ).toEqual({
      phase: 'build',
      input: 'prepared',
      session: 'marker-session.blend',
      output: 'rigged-auto-rig-pro',
    })
  })

  it('keeps benchmark artifacts distinct from the canonical rig spike', () => {
    expect(autoRigProArtifactNames).toHaveLength(23)
    expect(autoRigProArtifactNames).toContain('masculine-auto-rig-pro-spike.blend')
    expect(autoRigProArtifactNames).toContain('masculine-auto-rig-pro-diagnostic.glb')
    expect(autoRigProArtifactNames).toContain('validation-overhead-reach-back.png')
    expect(autoRigProArtifactNames.at(-1)).toBe('report.json')
  })
})
