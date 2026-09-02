import { describe, expect, it } from 'vitest'
import { POSE_CLIPS } from '../src/render/procedural/clips'
import { createGaitState } from '../src/render/procedural/gait'
import { Joint } from '../src/render/procedural/joints'
import { createPose, resolvePositions } from '../src/render/procedural/pose'
import { writeClipPose } from '../src/render/procedural/poses'
import { MASCULINE } from './fixtures/bodies'

/**
 * A death is watched from above for a second and a half, so it has to read as a
 * body going down and lying flat: nothing through the floor, every joint within
 * what a person can bend, and the corpse low enough not to clip a wall it fell
 * against. The clip is data; this is what the data must hold.
 */
const state = createGaitState()
const pose = createPose()
const positions = new Float32Array(Joint.Count * 3)

function at(phase: number): Float32Array {
  writeClipPose(MASCULINE, POSE_CLIPS.dead, phase, state, pose)
  resolvePositions(MASCULINE, pose, positions)
  return positions
}

function point(joint: Joint): [number, number, number] {
  return [positions[joint * 3]!, positions[joint * 3 + 1]!, positions[joint * 3 + 2]!]
}

function angleAt(a: Joint, b: Joint, c: Joint): number {
  const [ax, ay, az] = point(a)
  const [bx, by, bz] = point(b)
  const [cx, cy, cz] = point(c)
  const u = [ax - bx, ay - by, az - bz]
  const v = [cx - bx, cy - by, cz - bz]
  const dot = u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!
  return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v)))))
}

describe('the death lies down like a person', () => {
  it('keeps every joint above the floor all the way down', () => {
    for (let phase = 0; phase <= 1; phase += 1 / 32) {
      at(phase)
      // The root is the ground marker under the body, not a limb.
      for (let joint = Joint.Pelvis; joint < Joint.Count; joint++) {
        expect(positions[joint * 3 + 1]!, `joint ${joint} at phase ${phase.toFixed(2)} is under the floor`).toBeGreaterThan(0.03)
      }
    }
  })

  it('settles flat: nothing higher than a lying body, hips and head down', () => {
    at(1)
    for (let joint = 0; joint < Joint.Count; joint++) {
      expect(positions[joint * 3 + 1]!, `joint ${joint} still stands`).toBeLessThan(0.3)
    }
    expect(point(Joint.Pelvis)[1]).toBeLessThan(0.2)
    expect(point(Joint.Head)[1]).toBeLessThan(0.25)
    expect(point(Joint.Head)[2], 'the head lies behind the hips: a fall backwards').toBeLessThan(point(Joint.Pelvis)[2])
    expect(point(Joint.FootL)[2], 'the feet lie ahead of the hips').toBeGreaterThan(point(Joint.Pelvis)[2] + 0.4)
  })

  it('never bends a knee or an elbow past what a person can', () => {
    for (let phase = 0; phase <= 1; phase += 1 / 32) {
      at(phase)
      for (const [hip, knee, foot] of [[Joint.HipL, Joint.KneeL, Joint.FootL], [Joint.HipR, Joint.KneeR, Joint.FootR]] as const) {
        const bend = Math.PI - angleAt(hip, knee, foot)
        expect(bend, `knee folded ${bend.toFixed(2)} rad at ${phase.toFixed(2)}`).toBeLessThan((150 * Math.PI) / 180)
      }
      for (const [shoulder, elbow, hand] of [[Joint.ShoulderL, Joint.ElbowL, Joint.HandL], [Joint.ShoulderR, Joint.ElbowR, Joint.HandR]] as const) {
        const bend = Math.PI - angleAt(shoulder, elbow, hand)
        expect(bend, `elbow folded ${bend.toFixed(2)} rad at ${phase.toFixed(2)}`).toBeLessThan((150 * Math.PI) / 180)
      }
    }
  })

  it('bends the knees up toward the sky once it is down, not into the ground', () => {
    at(1)
    for (const [hip, knee, foot] of [[Joint.HipL, Joint.KneeL, Joint.FootL], [Joint.HipR, Joint.KneeR, Joint.FootR]] as const) {
      const [hx, hy, hz] = point(hip)
      const [kx, ky, kz] = point(knee)
      const [fx, fy, fz] = point(foot)
      const midY = (hy + fy) / 2
      expect(ky, 'the knee sits above the hip-to-foot line').toBeGreaterThanOrEqual(midY - 0.005)
      void hx; void hz; void kx; void kz; void fx; void fz
    }
  })
})
