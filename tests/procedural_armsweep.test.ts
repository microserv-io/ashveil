import { describe, expect, it } from 'vitest'
import { restDirection } from '../src/render/procedural/geometry'
import { createPoseGenerator } from '../src/render/procedural/generator'
import { Joint, JOINT_NAMES } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { quatAngleBetween, quatRotate } from '../src/render/procedural/quat'
import { createRigInputOwner } from '../src/render/riginput'
import { DT } from '../src/sim/types'
import { MASCULINE } from './fixtures/bodies'

/**
 * The arms across the whole speed range, not at two speeds.
 *
 * A walk and a run were authored as two arm styles and crossed over between them,
 * so through the band where the blend does its work the hands swung outward and
 * the path they took changed shape from stride to stride. Everything an arm does
 * is one parameterisation now, and this walks the range to say so.
 */

const DEGREES = 180 / Math.PI
/** How far outboard of its own shoulder a hand may get. */
const LATERAL = 0.25
/** How far the upper arm may come away from the body's side. */
const ABDUCTION = 25
/** What an arm joint may turn in one frame at any speed in the range. */
const FRAME = 0.25
/**
 * How much further out the hands may sit while walking than they do standing
 * still. A swinging arm sweeps a little wider than a hanging one; what it may not
 * do is get wider as the body speeds up, which is asserted on top of this.
 */
const FLY = 0.035

interface Sample {
  readonly speed: number
  readonly lateral: number
  readonly outboard: number
  readonly abduction: number
  readonly frame: number
  readonly joint: number
  readonly swing: number
}

const rest = new Float32Array(3)
const direction = new Float32Array(3)
const positions = new Float32Array(Joint.Count * 3)

function sweep(): Sample[] {
  const samples: Sample[] = []
  for (let speed = 1; speed <= 5.51; speed += 0.2) {
    const generator = createPoseGenerator(MASCULINE)
    const { rigInput: input } = createRigInputOwner()
    input.state = 'moving'
    input.speed = speed
    input.seed = 0
    const before = createPose()
    const after = createPose()
    let lateral = 0
    let outboard = 0
    let abduction = 0
    let frame = 0
    let joint = 0
    let low = Infinity
    let high = -Infinity
    for (let step = 0; step <= 240; step++) {
      input.time = step * DT
      generator.generate(input, step % 2 === 0 ? before : after)
      if (step < 40) continue
      const from = step % 2 === 0 ? after : before
      const to = step % 2 === 0 ? before : after
      for (const index of [Joint.ShoulderL, Joint.ElbowL, Joint.HandL, Joint.ShoulderR, Joint.ElbowR, Joint.HandR]) {
        const moved = quatAngleBetween(from.rotations, index * 4, to.rotations, index * 4)
        if (moved > frame) {
          frame = moved
          joint = index
        }
      }
      resolvePositions(MASCULINE, to, positions)
      for (const [hand, shoulder] of [[Joint.HandL, Joint.ShoulderL], [Joint.HandR, Joint.ShoulderR]] as const) {
        lateral = Math.max(lateral, Math.abs(positions[hand * 3]!))
        outboard = Math.max(outboard, Math.abs(positions[hand * 3]!) - Math.abs(positions[shoulder * 3]!))
        restDirection(MASCULINE, shoulder, rest)
        quatRotate(to.rotations, shoulder * 4, rest[0]!, rest[1]!, rest[2]!, direction)
        abduction = Math.max(abduction, Math.asin(Math.min(1, Math.abs(direction[0]!))) * DEGREES)
        if (shoulder === Joint.ShoulderR) {
          const pitch = Math.atan2(direction[2]!, -direction[1]!)
          low = Math.min(low, pitch)
          high = Math.max(high, pitch)
        }
      }
    }
    samples.push({ speed, lateral, outboard, abduction, frame, joint, swing: (high - low) * 0.5 * DEGREES })
  }
  return samples
}

/** Where a hand hangs when the body is standing still, which is what "outward" is measured against. */
function standing(): number {
  const generator = createPoseGenerator(MASCULINE)
  const { rigInput: input } = createRigInputOwner()
  const pose = createPose()
  input.state = 'idle'
  for (let step = 0; step <= 60; step++) {
    input.time = step * DT
    generator.generate(input, pose)
  }
  resolvePositions(MASCULINE, pose, positions)
  return Math.max(Math.abs(positions[Joint.HandL * 3]!), Math.abs(positions[Joint.HandR * 3]!))
}

describe('the arms hold one shape across the speed range', () => {
  const samples = sweep()
  const hanging = standing()

  it('never flies a hand outward as speed rises', () => {
    for (const sample of samples) {
      expect(
        sample.lateral,
        `at ${sample.speed.toFixed(1)} m/s a hand sat ${((sample.lateral - hanging) * 1000).toFixed(0)} mm further out than standing`,
      ).toBeLessThanOrEqual(hanging + FLY)
      expect(sample.outboard, `at ${sample.speed.toFixed(1)} m/s a hand swung wide of its shoulder`).toBeLessThanOrEqual(LATERAL)
    }
    const slowest = samples[0]!
    const fastest = samples.at(-1)!
    expect(
      fastest.lateral,
      `the hands ended ${((fastest.lateral - slowest.lateral) * 1000).toFixed(0)} mm wider at ` +
        `${fastest.speed.toFixed(1)} m/s than at ${slowest.speed.toFixed(1)}`,
    ).toBeLessThanOrEqual(slowest.lateral)
  })

  it('keeps the upper arm against the body', () => {
    for (const sample of samples) {
      expect(sample.abduction, `at ${sample.speed.toFixed(1)} m/s`).toBeLessThanOrEqual(ABDUCTION)
    }
  })

  it('turns no arm joint too far in a frame at any speed', () => {
    for (const sample of samples) {
      expect(
        sample.frame,
        `at ${sample.speed.toFixed(1)} m/s ${JOINT_NAMES[sample.joint]} turned ${sample.frame.toFixed(3)} rad in a frame`,
      ).toBeLessThan(FRAME)
    }
  })

  it('swings further the faster it goes, all the way up', () => {
    samples.forEach((sample, index) => {
      if (index === 0) return
      const previous = samples[index - 1]!
      expect(
        sample.swing,
        `the swing fell from ${previous.swing.toFixed(1)} to ${sample.swing.toFixed(1)} degrees between ` +
          `${previous.speed.toFixed(1)} and ${sample.speed.toFixed(1)} m/s`,
      ).toBeGreaterThanOrEqual(previous.swing - 0.01)
    })
    expect(samples.at(-1)!.swing, 'a run swings no further than a walk').toBeGreaterThan(samples[0]!.swing + 10)
  })
})
