import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertTransferV2Source,
  autoRigProTransferV2ArtifactNames,
  momaskAutoRigProTransferV2MapSha256,
  parseAutoRigProTransferV2Args,
} from '../scripts/art/auto-rig-pro-transfer-v2'

const temporaryDirectories: string[] = []
const contractPath = resolve('scripts/art/contracts/momask-to-auto-rig-pro.transfer-v2.bmap')
const generatedOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-transfer-v2',
)

function passingReport() {
  return {
    schemaVersion: 'ashveil.momask-source.v1',
    retargetReady: true,
    fps: 20,
    terminalPalmRollObservable: false,
    clips: ['idle', 'walk', 'sprint'].map((id, index) => ({
      id,
      sourceMotion: {
        pass: true,
        path: `${id}/game_loop_basic_ik.bvh`,
        sha256: '0'.repeat(64),
        frames: [81, 41, 41][index],
        fps: 20,
        sampleSpanSeconds: [4, 2, 2][index],
      },
    })),
  }
}

function materializeSource() {
  const directory = mkdtempSync(resolve(tmpdir(), 'ashveil-transfer-v2-source-'))
  temporaryDirectories.push(directory)
  const report = passingReport()
  for (const clip of report.clips) {
    const path = resolve(directory, clip.sourceMotion.path)
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, `${clip.id}-game-loop`)
    clip.sourceMotion.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report))
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Auto-Rig Pro transfer v2 diagnostic', () => {
  it('accepts only hash-pinned walk and sprint source loops', () => {
    const source = materializeSource()
    const accepted = assertTransferV2Source(source)
    expect(accepted.clips.map(({ id }) => id)).toEqual(['walk', 'sprint'])
    expect(accepted.clips.map(({ frames }) => frames)).toEqual([41, 41])

    const reportPath = resolve(source, 'report.json')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    report.clips[1].sourceMotion.pass = false
    writeFileSync(reportPath, JSON.stringify(report))
    expect(() => assertTransferV2Source(source)).toThrow(/walk.*sourceMotion\.pass=true/)
  })

  it('uses a frozen FK-leg map with unmapped terminal hands and no IK poles', () => {
    const contents = readFileSync(contractPath, 'utf8')
    expect(createHash('sha256').update(contents).digest('hex')).toBe(
      momaskAutoRigProTransferV2MapSha256,
    )
    expect(contents).toContain('c_foot_fk.l%False%ABSOLUTE%')
    expect(contents).toContain('c_toes_fk.r%False%ABSOLUTE%')
    expect(contents).not.toContain('c_foot_ik')
    expect(contents).not.toContain('c_leg_pole')
    expect(contents.match(/^None%/gm)).toHaveLength(3)
  })

  it('pins the corrected import, height normalization, and full-frame rest alignment', () => {
    const pipeline = readFileSync(resolve('scripts/art/auto-rig-pro-transfer-v2.py'), 'utf8')
    expect(pipeline).toContain('axis_forward="-Z"')
    expect(pipeline).toContain('assert_source_convention(')
    expect(pipeline).toContain('remove_constant_hips_vertical_offset(')
    expect(pipeline).toContain('align_source_full_frames(')
    expect(pipeline).toContain('minimumDirectionDot >= 0.999')
    expect(pipeline).toContain('maximumResidualRollDegrees <= 2.0')
    expect(pipeline).not.toContain('copy_bone_rest')
    expect(pipeline).not.toContain('c_leg_pole')
    expect(pipeline).not.toContain('c_foot_ik.l%')
  })

  it('uses one retarget, FK switches, exact retiming, and isolated artifacts', () => {
    const pipeline = readFileSync(resolve('scripts/art/auto-rig-pro-transfer-v2.py'), 'utf8')
    expect(pipeline.match(/BASE\.retarget\(/g)).toHaveLength(1)
    expect(pipeline).toContain('set_limb_mode(target, legs_fk=True, arms_fk=True)')
    expect(pipeline).toContain('BASE.retime_action(target_action, 1, frames)')
    expect(readFileSync(resolve('scripts/art/auto-rig-pro-retarget.py'), 'utf8')).toContain(
      'scale = OUTPUT_FPS / SOURCE_FPS',
    )
    expect(pipeline).not.toContain('arp_retarget_in_place = True')
    expect(autoRigProTransferV2ArtifactNames).toEqual([
      'masculine-auto-rig-pro-transfer-v2.blend',
      'masculine-auto-rig-pro-transfer-v2-diagnostic.glb',
      'report.json',
    ])
  })

  it('parses exactly one source, target, and isolated output', () => {
    expect(
      parseAutoRigProTransferV2Args([
        '--source',
        'source',
        '--target',
        'target.blend',
        '--output',
        'output',
      ]),
    ).toEqual({ source: 'source', target: 'target.blend', output: 'output' })
  })

  it('records only objectively accepted walk and sprint diagnostics', () => {
    const report = JSON.parse(readFileSync(resolve(generatedOutput, 'report.json'), 'utf8'))
    expect(report.schemaVersion).toBe('ashveil.auto-rig-pro-transfer-v2')
    expect(report.objectiveAcceptance.pass).toBe(true)
    expect(report.sourceMotion.clips.map(({ id }: { id: string }) => id)).toEqual(['walk', 'sprint'])
    expect(report.sourceMotion.rejectedClips).toEqual([
      {
        id: 'idle',
        outputProduced: false,
        reason: 'Current MoMask idle is excluded from transfer v2.',
      },
    ])
    expect(report.sourceConvention.pass).toBe(true)
    expect(report.sourceVerticalNormalization.pass).toBe(true)
    expect(report.restFrameAlignment.pass).toBe(true)
    for (const clip of report.restFrameAlignment.clips) {
      expect(clip.minimumDirectionDot).toBeGreaterThanOrEqual(0.999)
      expect(clip.maximumResidualRollDegrees).toBeLessThanOrEqual(2)
    }
    expect(report.mapping.legs).toBe('FK')
    expect(report.mapping.polesMapped).toBe(false)
    expect(report.target.unchanged).toBe(true)
    expect(report.retargetSkeletal.pass).toBe(true)
    expect(report.retargetSkeletal.rotationAuthoring).toBe('auto_rig_pro_retarget_operator')
    expect(report.retargetSkeletal.directTargetBoneRotationsAuthoredByAshveil).toBe(false)
    expect(
      report.retargetSkeletal.clips.map((clip: Record<string, unknown>) => ({
        name: clip.outputName,
        frames: clip.outputFrames,
        duration: clip.durationSeconds,
        bakes: clip.retargetBakeCount,
        rootNet: clip.targetRootNetHorizontalDistanceMetres,
        selfContained: (clip.actionSelfContainment as { pass: boolean }).pass,
      })),
    ).toEqual([
      { name: 'Ashveil_Walk_InPlace', frames: 61, duration: 2, bakes: 1, rootNet: 0, selfContained: true },
      { name: 'Ashveil_Sprint_InPlace', frames: 61, duration: 2, bakes: 1, rootNet: 0, selfContained: true },
    ])
    expect(report.exportParity.clipTimingPass).toBe(true)
    expect(report.meshDeformation.pass).toBe(false)
    expect(report.exportParity.pass).toBe(false)
    expect(report.humanReview.pass).toBe(false)
    expect(report.productionPass).toBe(false)
    expect(report.canonicalViewerPromoted).toBe(false)

    for (const artifact of report.artifacts as Array<{ path: string; sha256: string }>) {
      const contents = readFileSync(resolve(generatedOutput, artifact.path))
      expect(createHash('sha256').update(contents).digest('hex')).toBe(artifact.sha256)
    }
  })
})
