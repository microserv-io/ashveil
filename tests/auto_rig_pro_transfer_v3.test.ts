import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  autoRigProTransferV3ArtifactNames,
  parseAutoRigProTransferV3Args,
} from '../scripts/art/auto-rig-pro-transfer-v3'

const pipelinePath = resolve('scripts/art/auto-rig-pro-transfer-v3.py')
const generatedOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-transfer-v3',
)

describe('Auto-Rig Pro transfer v3 ground diagnostic', () => {
  it('keeps the v2 source, convention, alignment, and one-retarget contract', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('V2.import_source(')
    expect(pipeline).toContain('V2.assert_source_convention(')
    expect(pipeline).toContain('V2.remove_constant_hips_vertical_offset(')
    expect(pipeline).toContain('V2.configure_remap(')
    expect(pipeline.match(/BASE\.retarget\(/g)).toHaveLength(1)
    expect(pipeline).toContain('axis_forward="-Z"')
  })

  it('converts evaluated FK legs to explicit ARP IK controls and measured poles', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('derive_leg_plane_pole(')
    expect(pipeline).toContain('snap_fk_pose_to_ik(')
    expect(pipeline).toContain('c_foot_ik.')
    expect(pipeline).toContain('c_toes_ik.')
    expect(pipeline).toContain('c_leg_pole.')
    expect(pipeline).toContain('maximumPosePopMetres')
    expect(pipeline).toContain('auto_stretch')
  })

  it('pins fail-closed contact, penetration, anatomy, loop, and render gates', () => {
    const pipeline = readFileSync(pipelinePath, 'utf8')
    expect(pipeline).toContain('INITIAL_SOLE_DISTANCE_LIMIT = 0.020')
    expect(pipeline).toContain('PENETRATION_LIMIT = -0.002')
    expect(pipeline).toContain('virtualForwardTrajectory')
    expect(pipeline).toContain('loopValueContinuity')
    expect(pipeline).toContain('loopVelocityContinuity')
    expect(pipeline).toContain('sideCrossing')
    expect(pipeline).toContain('kneeReversal')
    expect(pipeline).toContain('sprintFlight')
    expect(pipeline).toContain('baselineSprintFlightDetected')
    expect(pipeline).toContain('postCorrectionSprintFlightDetected')
    expect(pipeline).toContain('baselineStanceSlide')
    expect(pipeline).toContain('postCorrectionStanceSlide')
    expect(pipeline).not.toContain('initial ground classification failed')
    expect(pipeline).not.toContain('source contact classification has no flight phase')
    expect(pipeline).not.toContain('virtual stance slide failed: {slide}')
    expect(pipeline.indexOf('kinematics = convert_fk_action_to_grounded_ik(')).toBeLessThan(
      pipeline.indexOf('postCorrectionStanceSlide ='),
    )
    expect(autoRigProTransferV3ArtifactNames).toHaveLength(9)
    expect(autoRigProTransferV3ArtifactNames.filter((name) => name.endsWith('.png'))).toHaveLength(6)
  })

  it('parses only source, target, and isolated output arguments', () => {
    expect(
      parseAutoRigProTransferV3Args([
        '--source',
        'source',
        '--target',
        'target.blend',
        '--output',
        'output',
      ]),
    ).toEqual({ source: 'source', target: 'target.blend', output: 'output' })
  })

  it('retains no v3 artifacts after the measured post-correction pose-pop gate fails', () => {
    expect(existsSync(generatedOutput)).toBe(false)
    const wrapper = readFileSync(resolve('scripts/art/auto-rig-pro-transfer-v3.ts'), 'utf8')
    expect(wrapper).toContain('rmSync(stagingOutput, { recursive: true, force: true })')
    expect(wrapper).toContain('Transfer v3 completed without every objective diagnostic gate passing.')
  })
})
