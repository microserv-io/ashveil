import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const artifactDirectory = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro',
)

type GlbDocument = {
  accessors: Array<{
    bufferView: number
    byteOffset?: number
    componentType: number
    count: number
    min?: number[]
    max?: number[]
  }>
  bufferViews: Array<{ byteOffset?: number }>
  animations: Array<{
    name: string
    samplers: Array<{ input: number }>
  }>
}

function readGlb() {
  const glb = readFileSync(resolve(artifactDirectory, 'masculine-auto-rig-pro-diagnostic.glb'))
  expect(glb.toString('ascii', 0, 4)).toBe('glTF')
  const jsonLength = glb.readUInt32LE(12)
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a)
  const document = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength)) as GlbDocument
  const binaryHeader = 20 + jsonLength
  expect(glb.readUInt32LE(binaryHeader + 4)).toBe(0x004e4942)
  return { document, binary: glb.subarray(binaryHeader + 8) }
}

function animationTiming(document: GlbDocument, name: string) {
  const animation = document.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Missing animation: ${name}`)
  const inputs = animation.samplers.map((sampler) => {
    const accessor = document.accessors[sampler.input]
    if (!accessor) throw new Error(`Missing animation input accessor: ${sampler.input}`)
    return accessor
  })
  return {
    start: Math.min(...inputs.map((accessor) => accessor.min?.[0] ?? 0)),
    end: Math.max(...inputs.map((accessor) => accessor.max?.[0] ?? 0)),
    samples: Math.max(...inputs.map((accessor) => accessor.count)),
  }
}

function animationTimes(document: GlbDocument, binary: Buffer, name: string): number[] {
  const animation = document.animations.find((item) => item.name === name)
  if (!animation) throw new Error(`Missing animation: ${name}`)
  const accessor = animation.samplers
    .map((sampler) => {
      const input = document.accessors[sampler.input]
      if (!input) throw new Error(`Missing animation input accessor: ${sampler.input}`)
      return input
    })
    .sort((left, right) => right.count - left.count)[0]
  if (!accessor) throw new Error(`Animation has no input accessors: ${name}`)
  expect(accessor.componentType).toBe(5126)
  const bufferView = document.bufferViews[accessor.bufferView]
  if (!bufferView) throw new Error(`Missing animation buffer view: ${accessor.bufferView}`)
  const offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return Array.from({ length: accessor.count }, (_, index) => binary.readFloatLE(offset + index * 4))
}

describe('Auto-Rig Pro animation evidence', () => {
  const report = JSON.parse(readFileSync(resolve(artifactDirectory, 'report.json'), 'utf8'))

  it('uses one 30 fps clock and preserves exact stress-pose identity', () => {
    expect(report.animation.framesPerSecond).toBe(30)
    expect(report.animation.frameStart).toBe(0)
    expect(report.animation.frameEnd).toBe(50)
    expect(report.animation.sourceInterpolation).toBe('CONSTANT')
    expect(report.animation.namedPoseIdentity.frameIdentityExact).toBe(true)
    expect(report.animation.namedPoseIdentity.poses.map((pose: { namedFrame: number }) => pose.namedFrame)).toEqual([
      0, 10, 20, 30, 40, 50,
    ])
    expect(report.animation.namedPoseIdentity.pass).toBe(true)
  })

  it('exports the diagnostic, walk, and sprint clips with exact timing', () => {
    const { document, binary } = readGlb()
    expect(document.animations.map((animation) => animation.name).sort()).toEqual([
      'Ashveil_ARP_Benchmark',
      'Ashveil_Sprint_InPlace',
      'Ashveil_Walk_InPlace',
    ])
    expect(animationTiming(document, 'Ashveil_ARP_Benchmark')).toEqual({
      start: 0,
      end: 50 / 30,
      samples: 51,
    })
    expect(animationTiming(document, 'Ashveil_Walk_InPlace')).toEqual({ start: 0, end: 1, samples: 31 })
    expect(animationTiming(document, 'Ashveil_Sprint_InPlace')).toEqual({ start: 0, end: 0.6, samples: 19 })
    const stressTimes = animationTimes(document, binary, 'Ashveil_ARP_Benchmark')
    for (const namedFrame of [0, 10, 20, 30, 40, 50]) {
      expect(stressTimes[namedFrame]).toBeCloseTo(namedFrame / 30, 6)
    }
  })

  it('keeps locomotion in place with duplicate loop endpoints', () => {
    expect(report.locomotion.clips).toHaveLength(2)
    expect(
      report.locomotion.clips.map(
        (clip: { name: string; frameStart: number; frameEnd: number; durationSeconds: number }) => ({
          name: clip.name,
          frameStart: clip.frameStart,
          frameEnd: clip.frameEnd,
          durationSeconds: clip.durationSeconds,
        }),
      ),
    ).toEqual([
      { name: 'Ashveil_Walk_InPlace', frameStart: 0, frameEnd: 30, durationSeconds: 1 },
      { name: 'Ashveil_Sprint_InPlace', frameStart: 0, frameEnd: 18, durationSeconds: 0.6 },
    ])
    for (const clip of report.locomotion.clips) {
      expect(clip.explicitLoopDuplicateEndpoint).toBe(true)
      expect(clip.maximumLoopEndpointTranslationErrorMetres).toBeLessThanOrEqual(0.0001)
      expect(clip.maximumLoopEndpointRotationErrorDegrees).toBeLessThanOrEqual(0.1)
      expect(clip.trajectoryNetTranslationMetres).toBeLessThanOrEqual(0.0001)
      expect(clip.trajectoryNetRotationDegrees).toBeLessThanOrEqual(0.1)
      expect(Math.min(...Object.values<number>(clip.evaluatedDeformFootTravelMetres))).toBeGreaterThanOrEqual(
        0.05,
      )
      expect(clip.controlAuthoringPass).toBe(true)
      expect(clip.productionLocomotionPass).toBe(false)
    }
    expect(report.locomotion.controlAuthoringPass).toBe(true)
    expect(report.locomotion.productionLocomotionPass).toBe(false)
    expect(report.locomotion.unmeasuredProductionGates).toHaveLength(5)
  })

  it('uses runtime-compatible skinning without weakening deformation gates', () => {
    expect(report.weights.maximumInfluences).toBeLessThanOrEqual(4)
    expect(report.weights.maximumNormalizationError).toBeLessThanOrEqual(0.0001)
    expect(report.weights.preserveVolume).toBe(false)
    expect(report.productionDeformation.minimumCovarianceVolumeRatio).toBe(0.7)
    expect(report.productionDeformation.minimumTriangleAreaRatioP05).toBe(0.6)
    expect(report.productionDeformation.minimumTriangleAreaRatio).toBe(0.2)
    expect(report.productionDeformation.maximumSignedNormalInversions).toBe(0)
  })
})
