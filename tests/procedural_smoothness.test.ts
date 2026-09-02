import { describe, expect, it } from 'vitest'
import { createPoseGenerator } from '../src/render/procedural/generator'
import type { RigGeometry } from '../src/render/procedural/geometry'
import { Joint, JOINT_NAMES } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { quatAngleBetween } from '../src/render/procedural/quat'
import { createRigInputOwner } from '../src/render/riginput'
import { DT } from '../src/sim/types'
import { HUMAN, MASCULINE } from './fixtures/bodies'

/**
 * A walk has to flow. Every joint is a continuous function of the gait phase, so
 * a frame that moves further than its neighbours is a corner in one of them: a
 * cycle that does not close over the wrap, a contact handover that swaps the
 * planted point, or a blend crossing a regime boundary mid-stride.
 *
 * Driven through the generator rather than the gait, so the phase integration and
 * the wrap from one stride into the next are part of what is measured.
 */

/** What a joint may turn in one frame of a walk. A stride is not a strike. */
const WALK_LIMIT = 0.22
/**
 * How much a foot may change speed from one frame to the next, as a fraction of
 * its own leg. This is the hitch: the foot the walk is built on cannot be yanked.
 * The one this was written for was the swing's reach correction letting go on the
 * frame the foot landed — the foot fell 32 mm in a frame and then stopped dead,
 * and the hip that had to follow turned twice as far as on the frames either side:
 * 42 thousandths of a leg, against the 21 a swing leg reverses itself with.
 */
const FOOT_JERK = 0.022
const STRIDES = 3

interface Hitch {
  readonly worst: number
  readonly joint: number
  readonly phase: number
  readonly jerk: number
  readonly jerkPhase: number
}

function walk(geometry: RigGeometry, speed: number): Hitch {
  const generator = createPoseGenerator(geometry)
  const { rigInput: input } = createRigInputOwner()
  const before = createPose()
  const after = createPose()
  input.state = 'moving'
  input.speed = speed
  input.seed = 0

  // Long enough to cover three strides at the slowest speed measured.
  const frames = Math.ceil((STRIDES * 2) / DT)
  // Per joint, the angle it turned on each frame, once the state has settled, and
  // where each foot was: a hitch is a corner in the path, not a fast frame.
  const moved: number[][] = Array.from({ length: Joint.Count }, () => [])
  const feet: number[][] = []
  const positions = new Float32Array(Joint.Count * 3)
  for (let frame = 0; frame <= frames; frame++) {
    input.time = frame * DT
    generator.generate(input, frame % 2 === 0 ? before : after)
    if (frame < 30) continue
    const from = frame % 2 === 0 ? after : before
    const to = frame % 2 === 0 ? before : after
    for (let index = 0; index < Joint.Count; index++) {
      moved[index]!.push(quatAngleBetween(from.rotations, index * 4, to.rotations, index * 4))
    }
    resolvePositions(geometry, to, positions)
    feet.push([
      positions[Joint.FootL * 3]!, positions[Joint.FootL * 3 + 1]!, positions[Joint.FootL * 3 + 2]!,
      positions[Joint.FootR * 3]!, positions[Joint.FootR * 3 + 1]!, positions[Joint.FootR * 3 + 2]!,
    ])
  }

  let worst = 0
  let joint = 0
  let phase = 0
  moved.forEach((deltas, index) => {
    deltas.forEach((delta, step) => {
      if (delta > worst) {
        worst = delta
        joint = index
        phase = (step + 30) * DT
      }
    })
  })

  // The change in a foot's per-frame travel: the second difference of its path,
  // in leg lengths, over both feet.
  let jerk = 0
  let jerkPhase = 0
  for (let step = 2; step < feet.length; step++) {
    for (let lane = 0; lane < 6; lane += 3) {
      let sum = 0
      for (let axis = 0; axis < 3; axis++) {
        const one = feet[step]![lane + axis]! - feet[step - 1]![lane + axis]!
        const two = feet[step - 1]![lane + axis]! - feet[step - 2]![lane + axis]!
        sum += (one - two) * (one - two)
      }
      const changed = Math.sqrt(sum) / geometry.legLength
      if (changed > jerk) {
        jerk = changed
        jerkPhase = (step + 30) * DT
      }
    }
  }
  return { worst, joint, phase, jerk, jerkPhase }
}

describe.each([['human', HUMAN], ['masculine-v1', MASCULINE]] as const)('%s walks without a hitch', (_body, geometry) => {
  for (const speed of [0.8, 1.2, 1.6]) {
    it(`flows at ${speed} m/s`, () => {
      const hitch = walk(geometry, speed)
      expect(
        hitch.worst,
        `${JOINT_NAMES[hitch.joint]} turned ${hitch.worst.toFixed(3)} rad in a frame at ${hitch.phase.toFixed(2)}s`,
      ).toBeLessThan(WALK_LIMIT)
      expect(
        hitch.jerk,
        `a foot changed speed by ${(hitch.jerk * 1000).toFixed(1)} thousandths of a leg in a frame at ${hitch.jerkPhase.toFixed(2)}s`,
      ).toBeLessThan(FOOT_JERK)
    })
  }
})
