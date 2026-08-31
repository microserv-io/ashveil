import { describe, expect, it } from 'vitest'
import {
  blenderCandidates,
  characterSpikeArtifactNames,
  isPathInside,
  parseCharacterSpikeArgs,
} from '../scripts/art/character-spike'

describe('character asset spike command', () => {
  it('requires an explicit input, output, and target height', () => {
    expect(() => parseCharacterSpikeArgs([])).toThrow('Usage:')
    expect(() => parseCharacterSpikeArgs(['--input', 'model.fbx'])).toThrow('Usage:')
  })

  it('parses the reproducible spike inputs', () => {
    expect(
      parseCharacterSpikeArgs([
        '--input',
        'model.fbx',
        '--output',
        'prepared',
        '--target-height',
        '1.8',
      ]),
    ).toEqual({ input: 'model.fbx', output: 'prepared', targetHeight: 1.8 })
  })

  it('rejects a non-positive target height', () => {
    expect(() =>
      parseCharacterSpikeArgs([
        '--input',
        'model.fbx',
        '--output',
        'prepared',
        '--target-height',
        '0',
      ]),
    ).toThrow('target height')
  })

  it('prefers an explicit Blender binary and the user application on macOS', () => {
    expect(
      blenderCandidates({
        configuredBinary: '/custom/blender',
        homeDirectory: '/Users/test',
        platform: 'darwin',
      }),
    ).toEqual([
      '/custom/blender',
      '/Users/test/Applications/Blender.app/Contents/MacOS/Blender',
      '/Applications/Blender.app/Contents/MacOS/Blender',
      'blender',
    ])
  })

  it('defines the complete male-spike artifact contract', () => {
    expect(characterSpikeArtifactNames).toEqual([
      'masculine-character-spike.blend',
      'masculine-bald-base.glb',
      'masculine-armor-fit-proxy.glb',
      'validation-front.png',
      'validation-back.png',
      'validation-right.png',
      'validation-fit-proxy-front.png',
      'report.json',
    ])
  })

  it('detects an input nested in the replaceable output directory', () => {
    expect(isPathInside('/assets/prepared', '/assets/prepared/raw/model.fbx')).toBe(true)
    expect(isPathInside('/assets/prepared', '/assets/source/model.fbx')).toBe(false)
  })
})
