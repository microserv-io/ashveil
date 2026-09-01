import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  autoRigProRetargetArtifactNames,
  assertGeneratedRetargetReport,
  assertRetargetSource,
  momaskAutoRigProMapSha256,
  parseAutoRigProRetargetArgs,
  retainGeneratedRetargetOutput,
} from '../scripts/art/auto-rig-pro-retarget'

const temporaryDirectories: string[] = []
const contractPath = resolve('scripts/art/contracts/momask-to-auto-rig-pro.v1.bmap')
const generatedOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-retarget',
)

function temporarySource(report: unknown): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'ashveil-retarget-source-'))
  temporaryDirectories.push(directory)
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report))
  return directory
}

function passingReport() {
  return {
    schemaVersion: 'ashveil.momask-source.v1',
    retargetReady: true,
    fps: 20,
    terminalPalmRollObservable: false,
    clips: ['idle', 'walk', 'sprint'].map((id, index) => ({
      id,
      selectedFrames: [81, 41, 41][index],
      sampleSpanSeconds: [4, 2, 2][index],
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

function materializePassingSource() {
  const report = passingReport()
  const source = temporarySource(report)
  for (const clip of report.clips) {
    const path = resolve(source, clip.sourceMotion.path)
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, `${clip.id}-game-loop`)
    clip.sourceMotion.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  writeFileSync(resolve(source, 'report.json'), JSON.stringify(report))
  return source
}

function passingGeneratedReport() {
  return {
    schemaVersion: 'ashveil.auto-rig-pro-retarget.v1',
    sourceMotion: { pass: true },
    mapping: { pass: true },
    target: { unchanged: true },
    retargetSkeletal: { pass: true },
    meshDeformation: { pass: false },
    exportParity: { pass: false, clipTimingPass: true },
    humanReview: { pass: false },
    productionPass: false,
    canonicalViewerPromoted: false,
  }
}

function stagedGeneratedOutput(report: unknown) {
  const parent = mkdtempSync(resolve(tmpdir(), 'ashveil-retarget-output-'))
  temporaryDirectories.push(parent)
  const staging = resolve(parent, 'staging')
  const output = resolve(parent, 'retained')
  mkdirSync(staging)
  for (const name of autoRigProRetargetArtifactNames) {
    writeFileSync(resolve(staging, name), name === 'report.json' ? JSON.stringify(report) : name)
  }
  return { staging, output }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Auto-Rig Pro MoMask retarget pipeline', () => {
  it('pins the frozen control-only map', () => {
    const digest = createHash('sha256').update(readFileSync(contractPath)).digest('hex')
    expect(digest).toBe(momaskAutoRigProMapSha256)
    const rows = readFileSync(contractPath, 'utf8').split('\n').slice(0, -1)
    expect(rows).toHaveLength(22 * 5)
    const targets = Array.from({ length: 22 }, (_, index) => rows[index * 5]!.split('%')[0]!)
      .filter((target) => target !== 'None')
    expect(new Set(targets).size).toBe(targets.length)
    expect(rows.filter((row) => row === 'True')).toHaveLength(3)
    expect(rows).toContain('c_foot_ik.l%False%RELATIVE_CHAIN%0.0,0.0,0.0%0.0,0.0,0.0%1.0%False%False%Y%')
    expect(rows).toContain('c_foot_ik.r%False%RELATIVE_CHAIN%0.0,0.0,0.0%0.0,0.0,0.0%1.0%False%False%Y%')
  })

  it('parses one explicit source, target, and output', () => {
    expect(
      parseAutoRigProRetargetArgs([
        '--source',
        'source',
        '--target',
        'target.blend',
        '--output',
        'output',
      ]),
    ).toEqual({ source: 'source', target: 'target.blend', output: 'output' })
    expect(() => parseAutoRigProRetargetArgs(['--source', 'source'])).toThrow(/Usage:/)
  })

  it('fails closed unless the report and every selected clip explicitly pass source motion', () => {
    const report = passingReport()
    const source = temporarySource(report)
    expect(() => assertRetargetSource(source)).toThrow(/missing source BVH/)

    report.clips[0]!.sourceMotion.pass = false
    writeFileSync(resolve(source, 'report.json'), JSON.stringify(report))
    expect(() => assertRetargetSource(source)).toThrow(/idle.*sourceMotion\.pass=true/)

    report.clips[0]!.sourceMotion.pass = true
    report.retargetReady = false
    writeFileSync(resolve(source, 'report.json'), JSON.stringify(report))
    expect(() => assertRetargetSource(source)).toThrow(/retargetReady=true/)
  })

  it('requires the exact three odd-length 20 fps game-loop clips', () => {
    const report = passingReport()
    report.clips[0]!.sourceMotion.frames = 40
    const source = temporarySource(report)
    expect(() => assertRetargetSource(source)).toThrow(/odd frame count/)

    report.clips[0]!.sourceMotion.frames = 81
    report.fps = 30
    writeFileSync(resolve(source, 'report.json'), JSON.stringify(report))
    expect(() => assertRetargetSource(source)).toThrow(/20 fps/)
  })

  it('accepts only a complete hash-pinned passing source set', () => {
    const source = materializePassingSource()
    const accepted = assertRetargetSource(source)
    expect(accepted.clips.map(({ id }) => id)).toEqual(['idle', 'walk', 'sprint'])
    expect(accepted.clips.map(({ frames }) => frames)).toEqual([81, 41, 41])
  })

  it('uses isolated retarget artifacts and never names the canonical viewer GLB', () => {
    expect(autoRigProRetargetArtifactNames).toEqual([
      'masculine-auto-rig-pro-retarget.blend',
      'masculine-auto-rig-pro-retarget-diagnostic.glb',
      'report.json',
    ])
    expect(autoRigProRetargetArtifactNames).not.toContain('masculine-auto-rig-pro-diagnostic.glb')
  })

  it('validates every generated diagnostic acceptance field before retention', () => {
    expect(() => assertGeneratedRetargetReport(passingGeneratedReport())).not.toThrow()
    for (const mutate of [
      (report: ReturnType<typeof passingGeneratedReport>) => { report.sourceMotion.pass = false },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.mapping.pass = false },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.target.unchanged = false },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.retargetSkeletal.pass = false },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.meshDeformation.pass = true },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.exportParity.pass = true },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.humanReview.pass = true },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.productionPass = true },
      (report: ReturnType<typeof passingGeneratedReport>) => { report.canonicalViewerPromoted = true },
    ]) {
      const report = passingGeneratedReport()
      mutate(report)
      expect(() => assertGeneratedRetargetReport(report)).toThrow(/Generated retarget report/)
    }
  })

  it('deletes staging and retains nothing when generated timing or schema is invalid', () => {
    const badTiming = passingGeneratedReport()
    badTiming.exportParity.clipTimingPass = false
    const timingOutput = stagedGeneratedOutput(badTiming)
    expect(() => retainGeneratedRetargetOutput(timingOutput.staging, timingOutput.output)).toThrow(
      /clipTimingPass=true/,
    )
    expect(existsSync(timingOutput.staging)).toBe(false)
    expect(existsSync(timingOutput.output)).toBe(false)

    const badSchema = { ...passingGeneratedReport(), schemaVersion: 'wrong' }
    const schemaOutput = stagedGeneratedOutput(badSchema)
    expect(() => retainGeneratedRetargetOutput(schemaOutput.staging, schemaOutput.output)).toThrow(
      /schema is invalid/,
    )
    expect(existsSync(schemaOutput.staging)).toBe(false)
    expect(existsSync(schemaOutput.output)).toBe(false)
  })

  it('atomically retains only a passing generated diagnostic report', () => {
    const { staging, output } = stagedGeneratedOutput(passingGeneratedReport())
    retainGeneratedRetargetOutput(staging, output)
    expect(existsSync(staging)).toBe(false)
    expect(existsSync(resolve(output, 'report.json'))).toBe(true)
  })

  it('pins the native BVH import, ARP retarget, retime, and exporter path', () => {
    const pipeline = readFileSync(resolve('scripts/art/auto-rig-pro-retarget.py'), 'utf8')
    expect(pipeline).toContain('axis_forward="Z"')
    expect(pipeline).toContain('axis_up="Y"')
    expect(pipeline).toContain('rotate_mode="QUATERNION"')
    expect(pipeline).toContain('scale = OUTPUT_FPS / SOURCE_FPS')
    expect(pipeline).toContain('bpy.ops.arp.retarget(')
    expect(pipeline).toContain('bpy.ops.arp.arp_export_gltf_panel(')
    expect(pipeline).toContain('set_limb_mode(target, feet_ik=True, hands_fk=True)')
    expect(pipeline).toContain('validate_action_self_containment(')
    expect(pipeline).not.toContain('create_in_place_source')
    expect(pipeline).not.toContain('arp_retarget_in_place = True')
    expect(pipeline).not.toContain('orient_control_y_z')
    expect(pipeline).not.toContain('set_pose_matrix')
    expect(pipeline).not.toContain('rotation_euler =')
    expect(pipeline).not.toContain('rotation_quaternion =')
  })

  it('records the generated single-bake diagnostic without claiming production acceptance', () => {
    const report = JSON.parse(readFileSync(resolve(generatedOutput, 'report.json'), 'utf8'))
    expect(report.schemaVersion).toBe('ashveil.auto-rig-pro-retarget.v1')
    expect(report.sourceMotion.pass).toBe(true)
    expect(report.target.unchanged).toBe(true)
    expect(report.retargetSkeletal.pass).toBe(true)
    expect(
      report.retargetSkeletal.clips.map((clip: Record<string, unknown>) => ({
        name: clip.outputName,
        frames: clip.outputFrames,
        duration: clip.durationSeconds,
        bakes: clip.retargetBakeCount,
        rootNet: clip.targetRootNetHorizontalDistanceMetres,
        selfContained: (clip.actionSelfContainment as { pass: boolean }).pass,
        targetMeshContactMeasured: clip.targetMeshContactMeasured,
      })),
    ).toEqual([
      { name: 'Ashveil_Idle_InPlace', frames: 121, duration: 4, bakes: 1, rootNet: 0, selfContained: true, targetMeshContactMeasured: false },
      { name: 'Ashveil_Walk_InPlace', frames: 61, duration: 2, bakes: 1, rootNet: 0, selfContained: true, targetMeshContactMeasured: false },
      { name: 'Ashveil_Sprint_InPlace', frames: 61, duration: 2, bakes: 1, rootNet: 0, selfContained: true, targetMeshContactMeasured: false },
    ])
    expect(report.exportParity.clipTimingPass).toBe(true)
    expect(report.exportParity.runtimeInventoryPass).toBe(false)
    expect(report.exportParity.gltfStructure.controlJoints).toEqual(['c_traj'])
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
