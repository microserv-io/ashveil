import { describe, expect, it } from 'vitest'
import { createGaitState } from '../src/render/procedural/gait'
import { Joint } from '../src/render/procedural/joints'
import { createPose, type Pose, resolvePositions } from '../src/render/procedural/pose'
import { DEATH_SETTLE, MOTION_CLIPS, POSE_CLIPS, SKILL_CLIPS } from '../src/render/procedural/clips'
import { CARRY_HAND } from '../src/render/procedural/arms'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatAngleBetween, quatLength } from '../src/render/procedural/quat'
import { MASCULINE as geometry } from './fixtures/bodies'

const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)
const ALL_CLIPS = [...SKILL_CLIPS, ...MOTION_CLIPS]
const STRIKE_CLIPS = [
  ...SKILL_CLIPS,
  'cast',
  'execute_overhead',
  'execute_thrust',
  'swing_one_hand',
  'swing_two_hand',
  'bow_draw',
] as const

function write(clip: keyof typeof POSE_CLIPS, phase: number): void {
  writeClipPose(geometry, POSE_CLIPS[clip], phase, state, pose)
}

/** How far a pose has travelled from the clip's neutral first key, summed over joints. */
function deviation(from: Float32Array, to: Pose): number {
  let total = 0
  for (let joint = 0; joint < Joint.Count; joint++) total += quatAngleBetween(from, joint * 4, to.rotations, joint * 4)
  return total
}

/** How far the leading hand reaches ahead of the carry it started from, in arm lengths. */
function reach(): number {
  resolvePositions(geometry, pose, positions)
  const left = positions[Joint.HandL * 3 + 2]! - positions[Joint.ShoulderL * 3 + 2]!
  const right = positions[Joint.HandR * 3 + 2]! - positions[Joint.ShoulderR * 3 + 2]!
  return Math.max(left, right) / geometry.armLength - CARRY_HAND[2]!
}

/** Both hands of the cast at one phase and one instant of sim time, in the body frame. */
function castHands(phase: number, time: number): Float32Array {
  writeClipPose(geometry, POSE_CLIPS.cast, phase, state, pose, time)
  resolvePositions(geometry, pose, positions)
  return new Float32Array([
    ...positions.slice(Joint.HandL * 3, Joint.HandL * 3 + 3),
    ...positions.slice(Joint.HandR * 3, Joint.HandR * 3 + 3),
  ])
}

function travelled(from: Float32Array, to: Float32Array, lane: number): number {
  return Math.hypot(to[lane]! - from[lane]!, to[lane + 1]! - from[lane + 1]!, to[lane + 2]! - from[lane + 2]!)
}

describe('placeholder skill poses', () => {
  it('covers every skill the rig can be asked for', () => {
    expect(SKILL_CLIPS).toEqual(['cleave', 'firebolt', 'frost_nova', 'monster_bite', 'monster_bolt', 'monster_slam'])
  })

  it('pins the motion library order', () => {
    expect(MOTION_CLIPS).toEqual([
      'cast',
      'channel',
      'execute_overhead',
      'execute_thrust',
      'swing_one_hand',
      'swing_two_hand',
      'bow_draw',
      'stagger',
    ])
  })

  for (const clip of ALL_CLIPS) {
    it(`${clip} stays finite and normalised across its phase`, () => {
      for (let i = 0; i <= 60; i++) {
        write(clip, i / 60)
        for (let joint = 0; joint < Joint.Count; joint++) {
          expect(quatLength(pose.rotations, joint * 4), `${clip} joint ${joint}`).toBeCloseTo(1, 4)
        }
        expect(Number.isFinite(pose.offset[0]! + pose.offset[1]! + pose.offset[2]!)).toBe(true)
      }
    })

    it(`${clip} comes back towards the carry it started from`, () => {
      write(clip, 0)
      const neutral = new Float32Array(pose.rotations)
      let peak = 0
      for (let i = 0; i <= 100; i++) {
        write(clip, i / 100)
        peak = Math.max(peak, deviation(neutral, pose))
      }
      write(clip, 1)
      // Not all the way to the carry: a 0.12 s recovery cannot travel out and
      // back, so the clip ends on a guard and the generator's state blend relaxes
      // it. See the recovery note in `clips.ts`.
      expect(deviation(neutral, pose), `${clip} does not come back at all`).toBeLessThan(peak * 0.6)
    })

    it(`${clip} keeps both feet on the ground, because skills root you`, () => {
      write(clip, 0)
      resolvePositions(geometry, pose, positions)
      const planted = [positions[Joint.FootL * 3 + 2]!, positions[Joint.FootR * 3 + 2]!]
      const ground = positions[Joint.FootL * 3 + 1]!
      for (let i = 1; i <= 20; i++) {
        write(clip, i / 20)
        resolvePositions(geometry, pose, positions)
        // A step into a swing is a step, not a walk: it stays on the ground and
        // inside a third of a leg of where the body is standing.
        expect(Math.abs(positions[Joint.FootL * 3 + 2]! - planted[0]!), clip).toBeLessThan(geometry.legLength * 0.3)
        expect(Math.abs(positions[Joint.FootR * 3 + 2]! - planted[1]!), clip).toBeLessThan(geometry.legLength * 0.3)
        expect(positions[Joint.FootL * 3 + 1]! - ground, clip).toBeLessThan(1e-3)
        expect(positions[Joint.FootR * 3 + 1]! - ground, clip).toBeLessThan(1e-3)
      }
    })
  }

  for (const clip of STRIKE_CLIPS) {
    it(`${clip} pulls back through windup and strikes at the turn`, () => {
      let furthest = -Infinity
      let furthestAt = 0
      let nearest = Infinity
      let nearestAt = 1
      for (let i = 0; i <= 100; i++) {
        write(clip, i / 100)
        const ahead = reach()
        if (ahead > furthest) {
          furthest = ahead
          furthestAt = i / 100
        }
        if (ahead < nearest) {
          nearest = ahead
          nearestAt = i / 100
        }
      }
      // The strike lands on the turn or just past it: a skill whose recovery is
      // long enough to travel in uses some of it. See `clips.ts`.
      expect(furthestAt, `${clip} does not strike on the turn`).toBeGreaterThan(0.45)
      expect(furthestAt).toBeLessThan(0.8)
      expect(nearestAt, `${clip} does not anticipate before it strikes`).toBeLessThan(furthestAt)
      // A neutral first key hides an unreadable strike until the hand is already moving forward.
      expect(nearest, `${clip} never draws the hand back from its carry`).toBeLessThan(0)
    })
  }

  it('channel closes its loop while keeping its leading hand forward', () => {
    write('channel', 0)
    const startRotations = new Float32Array(pose.rotations)
    const startOffset = new Float32Array(pose.offset)
    write('channel', 1)
    for (let i = 0; i < pose.rotations.length; i++) {
      expect(Math.abs(pose.rotations[i]! - startRotations[i]!)).toBeLessThanOrEqual(1e-6)
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(pose.offset[axis]! - startOffset[axis]!)).toBeLessThanOrEqual(1e-6)
    }
    for (let sample = 0; sample < 40; sample++) {
      write('channel', sample / 39)
      expect(reach()).toBeGreaterThan(0)
    }
  })

  it('stagger recoils harder than the flinch and gives ground before recovering', () => {
    const identity = createPose()
    write('stagger', 0)
    const standing = new Float32Array(pose.offset)
    write('stagger', 0.5)
    expect(quatAngleBetween(identity.rotations, Joint.Chest * 4, pose.rotations, Joint.Chest * 4)).toBeGreaterThan(0.3)
    // Measured on the written pose, not the compiled key: `writeClipPose` adds the
    // stance offset to y, so the ground it gives back is the phase 0 root.
    expect(pose.offset[2]!).toBeLessThan(standing[2]!)
    write('stagger', 1)
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(pose.offset[axis]! - standing[axis]!)).toBeLessThanOrEqual(1e-6)
    }
  })

  it('rolls the ball between both hands through the cast wind-up', () => {
    const gather = POSE_CLIPS.cast.gather!
    const rolled = gather.radius * geometry.armLength * 0.5
    const gathering = [castHands(0.25, 0), castHands(0.25, gather.period / 4)]
    const firing = [castHands(0.5, 0), castHands(0.5, gather.period / 4)]
    for (const lane of [0, 3]) {
      expect(travelled(gathering[0]!, gathering[1]!, lane), `hand ${lane} does not roll`).toBeGreaterThanOrEqual(rolled)
      expect(travelled(firing[0]!, firing[1]!, lane), `hand ${lane} still rolls on the turn`).toBeLessThanOrEqual(1e-6)
    }
  })

  it('the executes start where the cast leaves both hands', () => {
    write('cast', 1)
    resolvePositions(geometry, pose, positions)
    const castHands = new Float32Array([
      ...positions.slice(Joint.HandL * 3, Joint.HandL * 3 + 3),
      ...positions.slice(Joint.HandR * 3, Joint.HandR * 3 + 3),
    ])
    for (const clip of ['execute_overhead', 'execute_thrust'] as const) {
      write(clip, 0)
      resolvePositions(geometry, pose, positions)
      for (const [hand, lane] of [[Joint.HandL, 0], [Joint.HandR, 3]] as const) {
        const distance = Math.hypot(
          positions[hand * 3]! - castHands[lane]!,
          positions[hand * 3 + 1]! - castHands[lane + 1]!,
          positions[hand * 3 + 2]! - castHands[lane + 2]!,
        )
        expect(distance / geometry.armLength, `${clip} hand ${hand}`).toBeLessThan(0.05)
      }
    }
  })
})

describe('the death settle', () => {
  it('settles inside the window the death fade allows', () => {
    expect(DEATH_SETTLE).toBeLessThanOrEqual(0.7)
  })

  it('puts the body on the ground', () => {
    write('dead', 0)
    resolvePositions(geometry, pose, positions)
    const standing = positions[Joint.Chest * 3 + 1]!
    write('dead', 1)
    resolvePositions(geometry, pose, positions)
    expect(positions[Joint.Chest * 3 + 1]!, 'the chest never came down').toBeLessThan(standing * 0.45)
    // Root is the skeleton origin, not anatomy: it sits at the feet in the bind
    // pose, so a body lying down legitimately carries it below the ground plane.
    for (let joint = Joint.Pelvis; joint < Joint.Count; joint++) {
      expect(positions[joint * 3 + 1]!, `joint ${joint} sank through the floor`).toBeGreaterThan(-0.05)
    }
    expect(positions[1]!, 'the root ran away downward').toBeGreaterThan(-geometry.legLength)
  })

  it('holds once it has settled', () => {
    write('dead', 1)
    const settled = new Float32Array(pose.rotations)
    const settledOffset = new Float32Array(pose.offset)
    write('dead', 4)
    for (let i = 0; i < settled.length; i++) expect(pose.rotations[i]).toBeCloseTo(settled[i]!, 6)
    for (let i = 0; i < 3; i++) expect(pose.offset[i]).toBeCloseTo(settledOffset[i]!, 6)
  })

  it('falls monotonically rather than bouncing', () => {
    let previous = Infinity
    for (let i = 0; i <= 40; i++) {
      write('dead', i / 40)
      resolvePositions(geometry, pose, positions)
      const chest = positions[Joint.Chest * 3 + 1]!
      expect(chest).toBeLessThanOrEqual(previous + 1e-4)
      previous = chest
    }
  })
})
