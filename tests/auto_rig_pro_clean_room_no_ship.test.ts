import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const artifactDirectory = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-clean-room-no-ship',
)
const report = JSON.parse(readFileSync(resolve(artifactDirectory, 'report.json'), 'utf8'))

describe('Auto-Rig Pro clean-room NO-SHIP evidence', () => {
  it('records rejection without weakening canonical production acceptance', () => {
    expect(report.disposition).toBe('no_ship')
    expect(report.productionAcceptance).toBe(false)
    expect(report.runtimeUsable).toBe(false)
    expect(report.parityMeasurementValid).toBe(false)
    expect(report.retentionPolicy.glbRetained).toBe(false)
    expect(report.retentionPolicy.blendRetained).toBe(false)
    expect(report.retentionPolicy.canonicalArtifactsReplaced).toBe(false)
  })

  it('pins the measured failures against unchanged thresholds', () => {
    expect(report.measuredFailures.crossBodyPalmFrameErrorDegrees).toBeGreaterThan(30)
    expect(report.measuredFailures.deformationThresholds).toEqual({
      minimumCovarianceVolumeRatio: 0.7,
      minimumTriangleAreaRatioP05: 0.6,
      minimumTriangleAreaRatio: 0.2,
      maximumSignedNormalInversions: 0,
    })

    const overheadLeft = report.measuredFailures.deformation.overheadShoulderLeft
    const overheadRight = report.measuredFailures.deformation.overheadShoulderRight
    const deepElbow = report.measuredFailures.deformation.deepElbowLeft
    expect(overheadLeft.covarianceVolumeRatio).toBeLessThan(0.7)
    expect(overheadRight.minimumTriangleAreaRatio).toBeLessThan(0.2)
    expect(deepElbow.triangleAreaRatioP05).toBeLessThan(0.6)
    expect(overheadLeft.signedNormalInversions).toBeGreaterThan(0)
    expect(deepElbow.signedNormalInversions).toBeGreaterThan(0)
    expect(report.measuredFailures.experimentalGlbParity.pass).toBe(false)
    expect(report.measuredFailures.experimentalGlbParity.boneEndpointMaximumMetres).toBeGreaterThan(1)
  })

  it('retains exactly the genuine Blender-authoring stress renders', () => {
    expect(report.retentionPolicy.measurementSpace).toBe('Blender authoring viewport only')
    expect(report.retentionPolicy.renderCount).toBe(15)
    expect(report.artifacts).toHaveLength(15)
    expect(report.artifacts.every(({ name }: { name: string }) => name.startsWith('blender-authoring-only-'))).toBe(
      true,
    )
    expect(report.artifacts.some(({ name }: { name: string }) => name.includes('bind'))).toBe(false)
    expect(report.artifacts.some(({ name }: { name: string }) => name.includes('skeleton'))).toBe(false)

    for (const artifact of report.artifacts as Array<{ name: string; sha256: string }>) {
      const contents = readFileSync(resolve(artifactDirectory, artifact.name))
      expect(createHash('sha256').update(contents).digest('hex')).toBe(artifact.sha256)
    }
  })

  it('records measured improvements without converting them into acceptance', () => {
    expect(report.measuredImprovements.maximumAbsoluteUpperArmAxialTwistDegrees).toBeCloseTo(7.5463, 4)
    expect(report.measuredImprovements.maximumOffHingeRotationDegrees).toBeCloseTo(0.7756, 4)
    expect(report.measuredImprovements.locomotion.walk.evaluatedArmSwingCorrelation).toBeLessThan(-0.99)
    expect(report.measuredImprovements.locomotion.sprint.evaluatedArmSwingCorrelation).toBeLessThan(-0.99)
    expect(report.measuredImprovements.locomotion.walk.evaluatedMinimumKneeFlexionDegrees.left).toBeGreaterThan(30)
    expect(report.measuredImprovements.locomotion.sprint.evaluatedMinimumKneeFlexionDegrees.left).toBeGreaterThan(36)
    expect(report.productionAcceptance).toBe(false)
  })
})
