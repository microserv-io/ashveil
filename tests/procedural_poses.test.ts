import { describe, expect, it } from 'vitest'
import { createGaitState } from '../src/render/procedural/gait'
import {
  buildRigGeometry,
  KAYKIT_KNIGHT_JOINTS,
  KAYKIT_KNIGHT_STANDING_HEIGHT,
  resolvePositions,
} from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, type Pose } from '../src/render/procedural/pose'
import { DEATH_SETTLE, POSE_CLIPS, SKILL_CLIPS } from '../src/render/procedural/clips'
import { CARRY_HAND } from '../src/render/procedural/arms'
import { writeClipPose } from '../src/render/procedural/poses'
import { quatAngleBetween, quatLength } from '../src/render/procedural/quat'

const geometry = buildRigGeometry(KAYKIT_KNIGHT_JOINTS, 1.2, KAYKIT_KNIGHT_STANDING_HEIGHT)
const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)

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

describe('placeholder skill poses', () => {
  it('covers every skill the rig can be asked for', () => {
    expect(SKILL_CLIPS).toEqual(['cleave', 'firebolt', 'frost_nova', 'monster_bite', 'monster_bolt', 'monster_slam'])
  })

  for (const skill of ['cleave', 'firebolt', 'frost_nova', 'monster_bite', 'monster_bolt', 'monster_slam'] as const) {
    it(`${skill} stays finite and normalised across its phase`, () => {
      for (let i = 0; i <= 60; i++) {
        write(skill, i / 60)
        for (let joint = 0; joint < Joint.Count; joint++) {
          expect(quatLength(pose.rotations, joint * 4), `${skill} joint ${joint}`).toBeCloseTo(1, 4)
        }
        expect(Number.isFinite(pose.offset[0]! + pose.offset[1]! + pose.offset[2]!)).toBe(true)
      }
    })

    it(`${skill} pulls back through windup and strikes at the turn`, () => {
      let furthest = -Infinity
      let furthestAt = 0
      let nearest = Infinity
      let nearestAt = 1
      for (let i = 0; i <= 100; i++) {
        write(skill, i / 100)
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
      expect(furthestAt, `${skill} does not strike on the turn`).toBeGreaterThan(0.45)
      expect(furthestAt).toBeLessThan(0.8)
      expect(nearestAt, `${skill} does not anticipate before it strikes`).toBeLessThan(furthestAt)
      expect(nearest, `${skill} never draws the hand back from its carry`).toBeLessThan(0)
    })

    it(`${skill} comes back towards the carry it started from`, () => {
      write(skill, 0)
      const neutral = new Float32Array(pose.rotations)
      let peak = 0
      for (let i = 0; i <= 100; i++) {
        write(skill, i / 100)
        peak = Math.max(peak, deviation(neutral, pose))
      }
      write(skill, 1)
      // Not all the way to the carry: a 0.12 s recovery cannot travel out and
      // back, so the clip ends on a guard and the generator's state blend relaxes
      // it. See the recovery note in `clips.ts`.
      expect(deviation(neutral, pose), `${skill} does not come back at all`).toBeLessThan(peak * 0.6)
    })

    it(`${skill} keeps both feet on the ground, because skills root you`, () => {
      write(skill, 0)
      resolvePositions(geometry, pose, positions)
      const planted = [positions[Joint.FootL * 3 + 2]!, positions[Joint.FootR * 3 + 2]!]
      const ground = positions[Joint.FootL * 3 + 1]!
      for (let i = 1; i <= 20; i++) {
        write(skill, i / 20)
        resolvePositions(geometry, pose, positions)
        // A step into a swing is a step, not a walk: it stays on the ground and
        // inside a third of a leg of where the body is standing.
        expect(Math.abs(positions[Joint.FootL * 3 + 2]! - planted[0]!), skill).toBeLessThan(geometry.legLength * 0.3)
        expect(Math.abs(positions[Joint.FootR * 3 + 2]! - planted[1]!), skill).toBeLessThan(geometry.legLength * 0.3)
        expect(positions[Joint.FootL * 3 + 1]! - ground, skill).toBeLessThan(1e-3)
        expect(positions[Joint.FootR * 3 + 1]! - ground, skill).toBeLessThan(1e-3)
      }
    })
  }
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
