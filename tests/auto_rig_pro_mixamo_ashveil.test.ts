import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertAshveilMixamoSource,
  assertApprovedMixamoAshveilOutput,
  assertGeneratedMixamoAshveilReport,
  assertPinnedFileIdentity,
  ashveilMixamoSourceContract,
  ashveilMixamoSourceSha256,
  approvedMixamoAshveilOutput,
  conditionSparseLoopKeyValues,
  expectedMixamoAshveilFailedGates,
  parseAutoRigProMixamoAshveilArgs,
  retainGeneratedMixamoAshveilOutput,
  retainedMixamoAshveilArtifactNames,
  stripGlbExtras,
  symmetricLoopNeighborValues,
} from '../scripts/art/auto-rig-pro-mixamo-ashveil'

const reportPath =
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-mixamo-ashveil-wip/report.json'
const glbName = 'masculine-auto-rig-pro-mixamo-ashveil-wip.glb'
const blendName = 'masculine-auto-rig-pro-mixamo-ashveil-wip.blend'
const passingGate = { pass: true }

function sha256(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

function validGeneratedReport() {
  const report: Record<string, unknown> = {
    schemaVersion: 'ashveil.auto-rig-pro-mixamo-ashveil.v1',
    status: 'diagnostic_rejected',
    objectiveAcceptance: { pass: false, failedGates: [...expectedMixamoAshveilFailedGates] },
    source: {
      file: ashveilMixamoSourceContract.fileName,
      sha256: ashveilMixamoSourceSha256,
      meshes: 0,
      pass: true,
    },
    postureCalibration: { enabled: false, targetControlsChanged: false, pass: true },
    preGroundContact: { measured: true, sole: { pass: false }, heelForefoot: { pass: false } },
    groundPlacement: {
      pass: true,
      targetRootVerticalCurveAuthored: true,
      sourceActionCurvesChanged: false,
      maximumAbsoluteOffsetMetres: 0.0292,
      maximumAbsoluteOffsetLimitMetres: 0.035,
      maximumFrameVelocityMetres: 0.0161,
      maximumFrameVelocityLimitMetres: 0.02,
      endpointOffsetDifferenceMetres: 0,
      velocityOffsetDifferenceMetresPerFrame: 0,
    },
    bindPoseParity: { pass: true, before: { rest: 'same' }, after: { rest: 'same' } },
    sagittalPosture: { pass: false },
    headBodySeam: { pass: false },
    meshDeformation: { pass: false },
    runtimeRenderEvidence: { pass: true, artifacts: [] },
    export: {
      sourceMeshesExported: false,
      actions: [{
        name: 'Ashveil_Mixamo_Walk_InPlace_60fps',
        frames: 62,
        fps: 60,
        durationSeconds: 61 / 60,
      }],
    },
    humanReview: { pass: false },
    productionPass: false,
    canonicalViewerPromoted: false,
    artifacts: [],
  }
  for (const field of [
    'sourceRootMotion',
    'sourceLoopSeam',
    'mapping',
    'actionOwnership',
    'rootMotionExtraction',
    'footRotationCalibration',
    'targetRootNet',
    'bindRelativeAxialTwist',
    'kneeHingeDirection',
    'footContact',
    'heelForefootContact',
    'toeAlignment',
    'loopSeam',
    'shoulderWristContinuity',
    'runtimeInventory',
    'authorRuntimeJointParity',
    'skinnedVertexParity',
  ]) report[field] = passingGate
  return report
}

function glbFixture(): Buffer {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [], extras: { arp_remap: 'licensed-fixture' } }],
  }))
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20)
  json.copy(paddedJson)
  const glb = Buffer.alloc(20 + paddedJson.length)
  glb.write('glTF', 0, 'ascii')
  glb.writeUInt32LE(2, 4)
  glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(paddedJson.length, 12)
  glb.writeUInt32LE(0x4e4f534a, 16)
  paddedJson.copy(glb, 20)
  return glb
}

function writeGeneratedArtifact(directory: string, relativePath: string, contents: string | Buffer) {
  const path = resolve(directory, relativePath.endsWith('.png') ? `renders/${relativePath}` : relativePath)
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, contents)
  return { path: relativePath, sha256: sha256(contents), bytes: statSync(path).size }
}

function generatedStaging(reportMutation?: (report: Record<string, any>) => void): string {
  const directory = mkdtempSync(resolve(dirname(approvedMixamoAshveilOutput), '.auto-rig-pro-mixamo-ashveil-'))
  const report = validGeneratedReport() as Record<string, any>
  const artifacts = [
    writeGeneratedArtifact(directory, blendName, 'licensed-addon-blend-fixture'),
    writeGeneratedArtifact(directory, glbName, glbFixture()),
  ]
  for (let index = 0; index < 15; index += 1) {
    artifacts.push(writeGeneratedArtifact(directory, `render-${index}.png`, `render-${index}`))
  }
  report.runtimeRenderEvidence.artifacts = artifacts.slice(2)
  report.artifacts = artifacts
  reportMutation?.(report)
  writeFileSync(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return directory
}

describe('Ashveil Mixamo walk packaging contract', () => {
  it('validates pinned file identity using a portable temporary fixture', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'ashveil-mixamo-source-fixture-'))
    const path = resolve(directory, ashveilMixamoSourceContract.fileName)
    const contents = 'motion-only-fbx-test-fixture'
    writeFileSync(path, contents)

    expect(assertPinnedFileIdentity(path, ashveilMixamoSourceContract.fileName, sha256(contents))).toMatchObject({
      sha256: sha256(contents),
      bytes: contents.length,
    })
    expect(() => assertAshveilMixamoSource(path)).toThrow(/checksum changed/)
  })

  it('parses exactly one source, target, and isolated output argument', () => {
    expect(parseAutoRigProMixamoAshveilArgs([
      '--source', '1-Walking.fbx', '--target', 'accepted.blend', '--output', 'mixamo-ashveil-wip',
    ])).toEqual({ source: '1-Walking.fbx', target: 'accepted.blend', output: 'mixamo-ashveil-wip' })
    expect(() => parseAutoRigProMixamoAshveilArgs(['--source', '1-Walking.fbx'])).toThrow(/Usage:/)
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(packageJson.scripts['art:auto-rig-pro-mixamo-ashveil']).toBe(
      'tsx scripts/art/auto-rig-pro-mixamo-ashveil.ts',
    )
    expect(packageJson.scripts['art:auto-rig-pro-mixamo']).toBeUndefined()
  })

  it('accepts only the single approved diagnostic output leaf', () => {
    const relativeApproved =
      'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-mixamo-ashveil-wip'
    expect(assertApprovedMixamoAshveilOutput(relativeApproved)).toBe(approvedMixamoAshveilOutput)
    expect(assertApprovedMixamoAshveilOutput(approvedMixamoAshveilOutput)).toBe(approvedMixamoAshveilOutput)
    for (const rejected of [
      '.',
      'docs/art-pipeline/tripo-style-test/output/base-models',
      'docs/art-pipeline/tripo-style-test/output/base-models/masculine',
      'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro',
      dirname(approvedMixamoAshveilOutput),
      dirname('/tmp/codex-remote-attachments/source/1-Walking.fbx'),
      tmpdir(),
      resolve(approvedMixamoAshveilOutput, 'nested'),
    ]) {
      expect(() => assertApprovedMixamoAshveilOutput(rejected)).toThrow(/must be exactly/)
    }
  })

  it('validates the exact expected rejection and bounded grounding report', () => {
    expect(() => assertGeneratedMixamoAshveilReport(validGeneratedReport())).not.toThrow()
    const report = validGeneratedReport() as Record<string, any>
    report.objectiveAcceptance.failedGates = ['meshDeformation']
    expect(() => assertGeneratedMixamoAshveilReport(report)).toThrow(/fail exactly/)
  })

  it('rejects arbitrary output before recursively deleting generated staging', () => {
    const staging = generatedStaging()
    const arbitraryOutput = resolve(tmpdir(), 'ashveil-arbitrary-output')

    expect(() => retainGeneratedMixamoAshveilOutput(staging, arbitraryOutput)).toThrow(/must be exactly/)
    expect(existsSync(staging)).toBe(true)
    rmSync(staging, { recursive: true })
  })

  it('deletes invalid staging without replacing the prior output', () => {
    const before = readdirSync(approvedMixamoAshveilOutput).sort().map((name) => [
      name,
      sha256(readFileSync(resolve(approvedMixamoAshveilOutput, name))),
    ])
    const staging = generatedStaging((report) => {
      report.objectiveAcceptance.failedGates = ['meshDeformation']
    })

    expect(() => retainGeneratedMixamoAshveilOutput(staging, approvedMixamoAshveilOutput)).toThrow(/fail exactly/)
    const after = readdirSync(approvedMixamoAshveilOutput).sort().map((name) => [
      name,
      sha256(readFileSync(resolve(approvedMixamoAshveilOutput, name))),
    ])
    expect(after).toEqual(before)
    expect(existsSync(staging)).toBe(false)
  })

  it('rejects bad clip timing without replacing the prior output', () => {
    const before = readdirSync(approvedMixamoAshveilOutput).sort().map((name) => [
      name,
      sha256(readFileSync(resolve(approvedMixamoAshveilOutput, name))),
    ])
    const staging = generatedStaging((report) => {
      report.export.actions[0].fps = 30
    })

    expect(() => retainGeneratedMixamoAshveilOutput(staging, approvedMixamoAshveilOutput)).toThrow(/source\/export contract/)
    const after = readdirSync(approvedMixamoAshveilOutput).sort().map((name) => [
      name,
      sha256(readFileSync(resolve(approvedMixamoAshveilOutput, name))),
    ])
    expect(after).toEqual(before)
    expect(existsSync(staging)).toBe(false)
  })

  it('uses ARP-native motion transfer without target spine edits', () => {
    const pipeline = readFileSync('scripts/art/auto-rig-pro-mixamo-ashveil.py', 'utf8')
    expect(pipeline).toContain('bpy.ops.arp.copy_bone_rest("EXEC_DEFAULT")')
    expect(pipeline).toContain('bpy.context.scene.arp_twist_fac = 1.0')
    expect(pipeline).toContain('def calibrate_fk_feet(')
    expect(pipeline).toContain('targetRootVerticalCurveAuthored')
    expect(pipeline).toContain('sourceActionCurvesChanged')
    expect(pipeline).not.toContain('def calibrate_spine_posture(')
    expect(pipeline).not.toContain('sourceVerticalMotionChanged')
  })

  it('strips exported addon/source extras from a retained GLB', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'ashveil-mixamo-glb-extras-'))
    const path = resolve(directory, 'fixture.glb')
    writeFileSync(path, glbFixture())
    expect(readFileSync(path).toString()).toContain('licensed-fixture')

    stripGlbExtras(path)

    expect(readFileSync(path).toString()).not.toContain('licensed-fixture')
  })

  it('keeps the retained own-model report rejected and canonical-safe', () => {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    const artifactDirectory = resolve(reportPath, '..')
    expect(() => assertGeneratedMixamoAshveilReport(report)).not.toThrow()
    expect(report.status).toBe('diagnostic_rejected')
    expect(report.objectiveAcceptance.failedGates.sort()).toEqual([
      'headBodySeam', 'meshDeformation', 'sagittalPosture',
    ])
    expect(report.postureCalibration).toMatchObject({ enabled: false, targetControlsChanged: false })
    expect(report.preGroundContact.measured).toBe(true)
    expect(report.groundPlacement).toMatchObject({
      pass: true,
      targetRootVerticalCurveAuthored: true,
      sourceActionCurvesChanged: false,
    })
    expect(report.runtimeRenderEvidence.artifactRetention).toBe('measured_metadata_only')
    expect(report.runtimeRenderEvidence.artifacts).toBeUndefined()
    expect(report.artifacts).toHaveLength(1)
    const retained = report.artifacts[0]
    const retainedPath = resolve(artifactDirectory, retained.path)
    expect(readdirSync(artifactDirectory).sort()).toEqual([...retainedMixamoAshveilArtifactNames].sort())
    expect(sha256(readFileSync(retainedPath))).toBe(retained.sha256)
    expect(statSync(retainedPath).size).toBe(retained.bytes)
    expect(report.productionPass).toBe(false)
    expect(report.canonicalViewerPromoted).toBe(false)
  })

  it('conditions sparse loop curves without changing static channels', () => {
    const [start, second, penultimate, end] = symmetricLoopNeighborValues(1, 1.3, 0.9, 1)
    expect([start, end]).toEqual([1, 1])
    expect(second - start).toBeCloseTo(end - penultimate, 12)
    expect(conditionSparseLoopKeyValues({ 1: 1, 62: 1 }, [1, 1, 1, 1])).toEqual({ 1: 1, 62: 1 })
  })
})
