import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { buildRigGeometry, KAYKIT_KNIGHT_JOINTS, resolvePositions } from '../src/render/procedural/geometry'
import { createPoseGenerator } from '../src/render/procedural/generator'
import { Joint, JOINT_NAMES } from '../src/render/procedural/joints'
import { createPose } from '../src/render/procedural/pose'
import { DEATH_SETTLE } from '../src/render/procedural/clips'
import { quatAngleBetween, quatLength } from '../src/render/procedural/quat'
import { RIG_CLIPS, type RigState } from '../src/render/rig'
import type { RigInput } from '../src/render/riginput'
import { DT } from '../src/sim/types'

const geometry = buildRigGeometry(KAYKIT_KNIGHT_JOINTS, 1.2)
const STATES = Object.keys(RIG_CLIPS) as RigState[]

function input(overrides: Partial<RigInput> = {}): RigInput {
  return {
    state: 'idle',
    speed: 0,
    dashing: false,
    facingDelta: 0,
    phase: null,
    hitAge: null,
    ailments: [],
    time: 0,
    seed: 7,
    castLeft: 0,
    recovering: false,
    ...overrides,
  }
}

/**
 * Without a real collection `heapUsed` only reports nursery garbage that has not
 * been swept yet, which is several megabytes whether or not the frame path
 * allocates. That made the guard below pass and fail for the wrong reasons.
 */
function collect(): void {
  setFlagsFromString('--expose-gc')
  ;(runInNewContext('gc') as () => void)()
  setFlagsFromString('--no-expose-gc')
}

function largestJump(a: Float32Array, b: Float32Array): { joint: Joint; angle: number } {
  let joint = 0
  let angle = 0
  for (let i = 0; i < Joint.Count; i++) {
    const moved = quatAngleBetween(a, i * 4, b, i * 4)
    if (moved > angle) {
      angle = moved
      joint = i
    }
  }
  return { joint, angle }
}

describe('every rig state poses', () => {
  for (const state of STATES) {
    it(`${state} produces a finite, normalised pose`, () => {
      const generator = createPoseGenerator(geometry)
      const pose = createPose()
      const positions = new Float32Array(Joint.Count * 3)
      for (let frame = 0; frame < 90; frame++) {
        const time = frame * DT
        generator.generate(
          input({ state, time, speed: state === 'moving' ? 3 : 0, phase: { windup: (frame % 30) / 30 } }),
          pose,
        )
        for (let i = 0; i < Joint.Count; i++) {
          expect(quatLength(pose.rotations, i * 4), `${state} ${JOINT_NAMES[i]}`).toBeCloseTo(1, 4)
        }
        resolvePositions(geometry, pose, positions)
        for (let i = 0; i < positions.length; i++) expect(Number.isFinite(positions[i]!)).toBe(true)
      }
    })
  }
})

/** Runs `frames` of idle and moving in alternating blocks, reporting joint jumps. */
function switchRun(speed: number, frames = 600, block = 75): { worst: number; joint: Joint; crossing: number; inside: number } {
  const generator = createPoseGenerator(geometry)
  const pose = createPose()
  let previous: Float32Array | null = null
  let worst = 0
  let joint = 0
  let crossing = 0
  let inside = 0
  for (let frame = 0; frame < frames; frame++) {
    const moving = Math.floor(frame / block) % 2 === 1
    generator.generate(input({ state: moving ? 'moving' : 'idle', speed: moving ? speed : 0, time: frame * DT }), pose)
    if (previous) {
      const jump = largestJump(previous, pose.rotations)
      if (jump.angle > worst) {
        worst = jump.angle
        joint = jump.joint
      }
      if (frame % block < 4) crossing = Math.max(crossing, jump.angle)
      else inside = Math.max(inside, jump.angle)
    }
    previous = new Float32Array(pose.rotations)
  }
  return { worst, joint, crossing, inside }
}

describe('continuity across state changes', () => {
  for (const speed of [0.8, 1.5]) {
    it(`never jumps a joint more than 0.2 rad in a frame switching at ${speed} m/s`, () => {
      const run = switchRun(speed)
      expect(run.worst, `${JOINT_NAMES[run.joint]} jumped`).toBeLessThan(0.2)
    })
  }

  /**
   * Above a walk the bound is not the generator's to keep: a planted foot moves
   * `speed * DT` every frame by definition of not sliding, and near the ends of a
   * step the knee angle is steep in foot position, so a short-legged body sprinting
   * moves its knee further than 0.2 rad a frame however it is posed. What still
   * has to hold is that the crossover itself adds nothing.
   */
  it('adds no jump of its own when a run starts or stops', () => {
    const run = switchRun(4)
    expect(run.crossing, 'the crossover moved faster than the run it crosses into').toBeLessThan(run.inside)
  })

  /**
   * A sword swing is genuinely faster than 0.2 rad a frame, so what is asserted
   * here is that the crossover adds nothing: the frames around a state change
   * move no faster than the fastest frame inside the swing itself.
   */
  it('adds no jump of its own when a skill starts or ends', () => {
    const generator = createPoseGenerator(geometry)
    const pose = createPose()
    let previous: Float32Array | null = null
    let switching = 0
    let settled = 0
    for (let frame = 0; frame < 400; frame++) {
      const acting = Math.floor(frame / 50) % 2 === 1
      const progress = ((frame % 50) / 50) * 2
      generator.generate(
        input({
          state: acting ? 'cleave' : 'moving',
          speed: acting ? 0 : 3,
          time: frame * DT,
          phase: acting ? (progress < 1 ? { windup: progress } : { recovery: progress - 1 }) : null,
        }),
        pose,
      )
      if (previous) {
        const jump = largestJump(previous, pose.rotations).angle
        if (frame % 50 < 4) switching = Math.max(switching, jump)
        else settled = Math.max(settled, jump)
      }
      previous = new Float32Array(pose.rotations)
    }
    expect(switching, 'the crossover moved faster than the swing it crosses into').toBeLessThan(settled)
  })
})

describe('death', () => {
  it('settles within the death window and then holds', () => {
    const generator = createPoseGenerator(geometry)
    const pose = createPose()
    let settled: Float32Array | null = null
    for (let frame = 0; frame <= 180; frame++) {
      const time = 10 + frame * DT
      generator.generate(input({ state: 'dead', time }), pose)
      if (frame * DT >= DEATH_SETTLE && !settled) settled = new Float32Array(pose.rotations)
    }
    expect(settled).not.toBeNull()
    for (let i = 0; i < settled!.length; i++) expect(pose.rotations[i]).toBeCloseTo(settled![i]!, 5)
  })

  it('starts the fall from when the body died, not from when the game started', () => {
    const generator = createPoseGenerator(geometry)
    const early = createPose()
    generator.generate(input({ state: 'dead', time: 400 }), early)
    const fresh = createPoseGenerator(geometry)
    const other = createPose()
    fresh.generate(input({ state: 'dead', time: 1 }), other)
    for (let i = 0; i < early.rotations.length; i++) expect(early.rotations[i]).toBeCloseTo(other.rotations[i]!, 5)
  })

  it('forgets the death it saw when the body is reused', () => {
    const generator = createPoseGenerator(geometry)
    const pose = createPose()
    for (let frame = 0; frame < 90; frame++) generator.generate(input({ state: 'dead', time: frame * DT }), pose)
    const fallen = new Float32Array(pose.rotations)
    generator.reset()
    generator.generate(input({ state: 'dead', time: 100 }), pose)
    expect([...pose.rotations]).not.toEqual([...fallen])
  })
})

describe('dash', () => {
  it('holds the dash pose while the flag outlives the skill', () => {
    const generator = createPoseGenerator(geometry)
    const dashing = createPose()
    const running = createPose()
    for (let frame = 0; frame < 60; frame++) {
      generator.generate(input({ state: 'moving', speed: 9, dashing: true, time: frame * DT }), dashing)
    }
    const other = createPoseGenerator(geometry)
    for (let frame = 0; frame < 60; frame++) {
      other.generate(input({ state: 'moving', speed: 9, time: frame * DT }), running)
    }
    expect([...dashing.rotations]).not.toEqual([...running.rotations])
  })
})

describe('determinism and allocation', () => {
  it('gives the same run for the same inputs', () => {
    const run = (): number[] => {
      const generator = createPoseGenerator(geometry)
      const pose = createPose()
      const samples: number[] = []
      for (let frame = 0; frame < 120; frame++) {
        generator.generate(input({ state: 'moving', speed: 2 + frame * 0.02, time: frame * DT }), pose)
        samples.push(...pose.rotations)
      }
      return samples
    }
    expect(run()).toEqual(run())
  })

  it('offsets each body by its seed so a pack does not march in step', () => {
    const sample = (seed: number): number[] => {
      const generator = createPoseGenerator(geometry)
      const pose = createPose()
      for (let frame = 0; frame < 30; frame++) {
        generator.generate(input({ state: 'moving', speed: 3, time: frame * DT, seed }), pose)
      }
      return [...pose.rotations]
    }
    expect(sample(1)).not.toEqual(sample(2))
  })

  it('writes into the caller\'s pose and never hands back a new one', () => {
    const generator = createPoseGenerator(geometry)
    const pose = createPose()
    const rotations = pose.rotations
    expect(generator.generate).toBe(generator.generate)
    for (let frame = 0; frame < 1000; frame++) {
      generator.generate(input({ state: 'moving', speed: 3, time: frame * DT }), pose)
      expect(pose.rotations).toBe(rotations)
    }
  })

  it('allocates nothing on the frame path', () => {
    const generator = createPoseGenerator(geometry)
    const pose = createPose()
    const frame = input({ state: 'moving', speed: 3 })
    const run = (times: number): void => {
      for (let i = 0; i < times; i++) {
        frame.time = i * DT
        generator.generate(frame, pose)
      }
    }
    run(20_000)
    collect()
    const before = process.memoryUsage().heapUsed
    run(100_000)
    collect()
    const grown = process.memoryUsage().heapUsed - before
    expect(grown, `heap grew ${(grown / 1024).toFixed(0)} kB over 100k frames`).toBeLessThan(256 * 1024)
  })
})
