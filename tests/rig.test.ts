import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProceduralDriver } from '../src/render/proceduraldriver'
import { MOTION_CLIPS } from '../src/render/procedural/clips'
import { MASCULINE_PROFILE } from '../src/render/profiles/masculine'
import { rigStateOf, type RigState } from '../src/render/rig'
import { createRigInputOwner } from '../src/render/riginput'
import { SKILLS } from '../src/sim/skills'
import { Sim } from '../src/sim/sim'
import type { Actor } from '../src/sim/types'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

/**
 * The renderer has to have a pose for everything the sim can be doing. A missing
 * one is invisible in review and shows up as a body frozen in its bind pose.
 */

describe('animation coverage', () => {
  const bodyPath = join(import.meta.dirname, '..', 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb')
  const states: RigState[] = ['idle', 'moving', 'dead', ...(Object.keys(SKILLS) as RigState[]), ...MOTION_CLIPS]

  it('procedurally poses every RigState on masculine-v3', () => {
    for (const state of states) {
      const body = loadGlbSkeleton(bodyPath)
      const driver = new ProceduralDriver()
      const input = createRigInputOwner().rigInput
      const bones = Object.values(MASCULINE_PROFILE.bones).map((name) => body.getObjectByName(name)!)
      const bindPose = bones.map((bone) => bone.quaternion.clone())
      driver.bind(body, MASCULINE_PROFILE)
      input.state = state
      input.speed = state === 'moving' ? 3 : 0
      input.dashing = state === 'dash'
      input.phase = state in SKILLS ? { windup: 0.5 } : null
      input.time = 1
      driver.update(input, 1 / 60)
      for (const bone of bones) {
        expect(Number.isFinite(bone.quaternion.length()), `${state}: ${bone.name}`).toBe(true)
      }
      const moved = Math.max(...bones.map((bone, index) => bone.quaternion.angleTo(bindPose[index]!)))
      expect(moved, `${state} stayed in the bind pose`).toBeGreaterThan(1e-3)
      driver.dispose()
    }
  })
})

describe('reading the pose off an actor', () => {
  const actorAt = (over: Partial<Actor>): Actor => ({ ...new Sim({ seed: 3 }).player, ...over })

  it('prefers death over everything, including a skill still in flight', () => {
    expect(rigStateOf(actorAt({ dead: true, state: 'acting', activeSkill: 'cleave' }))).toBe('dead')
  })

  it('shows the skill being cast while acting', () => {
    expect(rigStateOf(actorAt({ state: 'acting', activeSkill: 'firebolt' }))).toBe('firebolt')
  })

  it('falls back to idle when acting without a skill', () => {
    expect(rigStateOf(actorAt({ state: 'acting', activeSkill: null }))).toBe('idle')
  })

  it('walks and stands', () => {
    expect(rigStateOf(actorAt({ state: 'moving' }))).toBe('moving')
    expect(rigStateOf(actorAt({ state: 'idle' }))).toBe('idle')
  })
})
