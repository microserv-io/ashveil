import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const artifactDirectory = resolve('docs/art-pipeline/ai-motion/momask')
const report = JSON.parse(readFileSync(resolve(artifactDirectory, 'report.json'), 'utf8'))

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readBvhContract(path: string): { frames: number; frameTime: number } {
  const contents = readFileSync(path, 'utf8')
  const frames = contents.match(/^Frames:\s+(\d+)$/m)
  const frameTime = contents.match(/^Frame Time:\s+([\d.]+)$/m)
  if (!frames?.[1] || !frameTime?.[1]) throw new Error(`Missing BVH motion header in ${path}`)
  return { frames: Number(frames[1]), frameTime: Number(frameTime[1]) }
}

describe('MoMask source-motion diagnostic', () => {
  it('stays diagnostic, noncommercial and position-derived', () => {
    expect(report.status).toBe('diagnostic_noncommercial')
    expect(report.productionAcceptance).toBe(false)
    expect(report.retargetReady).toBe(true)
    expect(report.representation).toBe('untouched_22_joint_positions_then_basic_inverse_kinematics')
    expect(report.terminalPalmRollObservable).toBe(false)
    expect(report.footlockDisposition).toBe('rejected_for_all_clips')
  })

  it('pins exactly three odd-length clips at 20 fps with exact requested sample spans', () => {
    expect(report.clips.map(({ id }: { id: string }) => id)).toEqual(['idle', 'walk', 'sprint'])
    expect(report.clips.map(({ selectedFrames }: { selectedFrames: number }) => selectedFrames)).toEqual([81, 41, 41])
    expect(report.clips.map(({ sampleSpanSeconds }: { sampleSpanSeconds: number }) => sampleSpanSeconds)).toEqual([
      4,
      2,
      2,
    ])

    for (const clip of report.clips as Array<{ id: string; selectedFrames: number; sampleSpanSeconds: number }>) {
      expect(clip.selectedFrames % 2).toBe(1)
      expect((clip.selectedFrames - 1) * 1.5).toBe(Math.trunc((clip.selectedFrames - 1) * 1.5))
      for (const variant of ['basic_ik.bvh', 'footlocked_basic_ik.bvh']) {
        const contract = readBvhContract(resolve(artifactDirectory, clip.id, variant))
        expect(contract.frames).toBe(clip.selectedFrames)
        expect(contract.frameTime).toBe(0.05)
        expect((contract.frames - 1) * contract.frameTime).toBeCloseTo(clip.sampleSpanSeconds, 8)
      }
    }
  })

  it('pins untouched candidate positions and converted BVH hashes', () => {
    for (const clip of report.clips as Array<{
      id: string
      hashes: {
        fullSourcePositions: string
        selectedSourcePositions: string
        basicIkBvh: string
        footlockedBasicIkBvh: string
      }
    }>) {
      const fullCandidate = resolve(
        artifactDirectory,
        'candidates',
        `${clip.id}-seed-${report.clips.find(({ id }: { id: string }) => id === clip.id).seed}-full-source-positions.npy`,
      )
      expect(sha256(fullCandidate)).toBe(clip.hashes.fullSourcePositions)
      expect(sha256(resolve(artifactDirectory, clip.id, 'source_positions.npy'))).toBe(
        clip.hashes.selectedSourcePositions,
      )
      expect(sha256(resolve(artifactDirectory, clip.id, 'basic_ik.bvh'))).toBe(clip.hashes.basicIkBvh)
      expect(sha256(resolve(artifactDirectory, clip.id, 'footlocked_basic_ik.bvh'))).toBe(
        clip.hashes.footlockedBasicIkBvh,
      )
    }
  })

  it('keeps intent evidence separate from source acceptance', () => {
    const idle = report.clips.find(({ id }: { id: string }) => id === 'idle')
    const walk = report.clips.find(({ id }: { id: string }) => id === 'walk')
    const sprint = report.clips.find(({ id }: { id: string }) => id === 'sprint')
    expect(idle.intentPass).toBe(true)
    expect(idle.rootHorizontalDistanceMeters).toBeLessThan(0.05)
    expect(walk.intentPass).toBe(true)
    expect(walk.reciprocalArmCorrelation).toBeLessThan(-0.7)
    expect(sprint.intentPass).toBe(true)
    expect(sprint.reciprocalArmCorrelation).toBeLessThan(-0.8)
    expect(report.clips.every(({ contactPass }: { contactPass: boolean }) => contactPass === false)).toBe(true)
  })

  it('accepts only measured cleaned source loops for retarget evaluation', () => {
    const gates = report.sourceAcceptanceGates
    for (const clip of report.clips as Array<{
      id: string
      sourceMotion: {
        pass: boolean
        path: string
        sha256: string
        sourcePositionsPath: string
        sourcePositionsSha256: string
        frames: number
        fps: number
        sampleSpanSeconds: number
        metrics: Record<string, number>
      }
    }>) {
      const source = clip.sourceMotion
      expect(source.pass).toBe(true)
      expect(source.path).toBe(`${clip.id}/game_loop_basic_ik.bvh`)
      expect(source.frames % 2).toBe(1)
      expect(source.fps).toBe(20)
      expect((source.frames - 1) / source.fps).toBe(source.sampleSpanSeconds)
      expect(sha256(resolve(artifactDirectory, source.path))).toBe(source.sha256)
      expect(sha256(resolve(artifactDirectory, source.sourcePositionsPath))).toBe(source.sourcePositionsSha256)

      const metrics = source.metrics
      expect(metrics.inPlaceRootRangeMeters).toBeLessThanOrEqual(gates.maximumInPlaceRootRangeMeters)
      expect(metrics.loopValueMaxMeters).toBeLessThanOrEqual(gates.maximumLoopValueErrorMeters)
      expect(metrics.loopVelocityMaxMetersPerFrame).toBeLessThanOrEqual(
        gates.maximumLoopVelocityErrorMetersPerFrame,
      )
      expect(metrics.leftKneePlaneSignFlipFraction).toBe(gates.maximumKneePlaneSignFlipFraction)
      expect(metrics.rightKneePlaneSignFlipFraction).toBe(gates.maximumKneePlaneSignFlipFraction)
      expect(metrics.leftContactSamples).toBeGreaterThanOrEqual(gates.minimumContactSamplesPerSide)
      expect(metrics.rightContactSamples).toBeGreaterThanOrEqual(gates.minimumContactSamplesPerSide)
      expect(metrics.leftContactSpeedP95MetersPerSecond).toBeLessThanOrEqual(
        gates.maximumContactSpeedP95MetersPerSecond,
      )
      expect(metrics.rightContactSpeedP95MetersPerSecond).toBeLessThanOrEqual(
        gates.maximumContactSpeedP95MetersPerSecond,
      )
      expect(metrics.minimumFootOrToeHeightMeters).toBeGreaterThanOrEqual(gates.minimumFootOrToeHeightMeters)
      expect(metrics.sourceFitP95Meters).toBeLessThanOrEqual(gates.maximumSourceFitP95Meters)
      expect(metrics.sourceFitMaxMeters).toBeLessThanOrEqual(gates.maximumSourceFitMeters)
      expect(metrics.cleanupCorrectionP95Meters).toBeLessThanOrEqual(gates.maximumCleanupCorrectionP95Meters)
      expect(metrics.cleanupCorrectionMaxMeters).toBeLessThanOrEqual(gates.maximumCleanupCorrectionMeters)
      if (clip.id !== 'idle') {
        expect(metrics.reciprocalArmCorrelation).toBeLessThanOrEqual(gates.maximumLocomotionArmCorrelation)
      }
    }
  })
})
