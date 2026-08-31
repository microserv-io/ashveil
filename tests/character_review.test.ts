import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  assertCharacterAssetSummary,
  CURRENT_PLAYER_RUNTIME_SCALE,
  GAMEPLAY_CAMERA_FOV,
  GAMEPLAY_CAMERA_OFFSET,
  NATIVE_SCALE,
  POSE_FRAMES,
  REQUIRED_SEMANTIC_MESHES,
  type CharacterAssetSummary,
} from '../spike/character/review-contract'
import { resetRootYaw, sampleTimeForFrame } from '../spike/character/view-contract'
import { assertRigReport, type RigReport } from '../spike/character/asset-inspection'

function validSummary(): CharacterAssetSummary {
  return {
    skins: 1,
    joints: 20,
    clips: [{ name: 'Ashveil_RigStress', duration: 50 / 30 }],
    semanticMeshes: Object.fromEntries(
      REQUIRED_SEMANTIC_MESHES.map((name) => [name, { skinned: true }]),
    ),
    bounds: { minimum: [-0.48, 0, -0.16], maximum: [0.48, 1.8, 0.16] },
  }
}

describe('character review contract', () => {
  it('pins gameplay camera, scale, and diagnostic pose frames', () => {
    expect(GAMEPLAY_CAMERA_FOV).toBe(38)
    expect(GAMEPLAY_CAMERA_OFFSET).toEqual([0, 19, 14.5])
    expect(NATIVE_SCALE).toBe(1)
    expect(CURRENT_PLAYER_RUNTIME_SCALE).toBeCloseTo(0.44 * 1.93)
    expect(POSE_FRAMES).toEqual({
      bind: 0,
      'overhead-reach': 10,
      'cross-body-reach': 20,
      'deep-elbow-bend': 30,
      'long-stride': 40,
      'head-turn': 50,
    })
  })

  it('accepts the complete diagnostic asset shape', () => {
    expect(() => assertCharacterAssetSummary(validSummary())).not.toThrow()
  })

  it('rejects missing rig data and unskinned semantic components', () => {
    const summary = validSummary()
    summary.skins = 0
    summary.joints = 0
    summary.semanticMeshes.Body = { skinned: false }

    expect(() => assertCharacterAssetSummary(summary)).toThrow(/skin.*joints.*Body/s)
  })

  it('rejects invalid clips and ungrounded or unexpected bounds', () => {
    const summary = validSummary()
    summary.clips = [
      { name: 'Ashveil_RigStress', duration: 0 },
      { name: 'Ashveil_RigStress', duration: 1 },
    ]
    summary.bounds = { minimum: [-1, 0.1, -1], maximum: [1, 1.2, 1] }

    expect(() => assertCharacterAssetSummary(summary)).toThrow(
      /unique.*positive duration.*native height.*grounded/s,
    )
  })

  it('samples just after float32 pose keys and clamps the final pose past duration', () => {
    const duration = 50 / 30
    expect(sampleTimeForFrame(10, 30, duration)).toBeGreaterThan(10 / 30)
    expect(sampleTimeForFrame(20, 30, duration)).toBeGreaterThan(20 / 30)
    expect(sampleTimeForFrame(50, 30, duration)).toBeGreaterThan(duration)
  })

  it('normalizes character root yaw for unambiguous camera comparisons', () => {
    const model = { rotation: { y: 1.25 } }
    const knight = { rotation: { y: -0.5 } }

    resetRootYaw(model, knight)

    expect(model.rotation.y).toBe(0)
    expect(knight.rotation.y).toBe(0)
  })

  it('accepts measured ARP diagnostics without treating them as production-ready', () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          '../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/report.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as RigReport

    expect(() => assertRigReport(report)).not.toThrow()
    expect(report.export?.runtimeRig).toMatchObject({
      fullAuthoringRigExported: true,
      runtimeReductionPending: true,
      runtimeClean: false,
      jointCount: 211,
      deformFlaggedJointCount: 29,
      deformOnlyJointCount: 27,
      controlJointCount: 65,
      referenceJointCount: 27,
      mechanismJointCount: 92,
    })
    expect(report.export?.runtimeRig.controlJoints.every((name) => name.startsWith('c_'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('authoringRigLeakage')
    expect(JSON.stringify(report)).not.toContain('rigifyControlLeakage')
    report.export!.runtimeRig.runtimeReductionPending = false
    expect(() => assertRigReport(report)).toThrow(/pending runtime reduction/)
    report.export!.runtimeRig.runtimeReductionPending = true
    report.productionAcceptance.pass = true
    expect(() => assertRigReport(report)).toThrow(/must remain diagnostic/)
  })
})
