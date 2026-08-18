import { describe, expect, it } from 'vitest'
import { RIG_CLIPS, rigStateOf, type RigState } from '../src/render/rig'
import { SKILLS } from '../src/sim/skills'
import { Sim } from '../src/sim/sim'
import type { Actor, SkillId } from '../src/sim/types'

/**
 * The renderer has to have a pose for everything the sim can be doing. A missing
 * one is invisible in review and shows up as a body frozen in its bind pose.
 */

describe('animation coverage', () => {
  it('maps every skill in the game', () => {
    const unmapped = (Object.keys(SKILLS) as SkillId[]).filter((id) => !RIG_CLIPS[id]?.length)
    expect(unmapped, 'add a clip for these in RIG_CLIPS').toEqual([])
  })

  it('maps every state an actor can be in outside a skill', () => {
    for (const state of ['idle', 'moving', 'dead'] as const) {
      expect(RIG_CLIPS[state].length, `${state} has no clip`).toBeGreaterThan(0)
    }
  })

  it('names a fallback for each pose, since the packs do not share every clip', () => {
    for (const [state, clips] of Object.entries(RIG_CLIPS)) {
      expect(clips.length, `${state} has no fallback clip`).toBeGreaterThan(1)
    }
  })

  it('has no mapping for a state the sim cannot produce', () => {
    const known = new Set<RigState>(['idle', 'moving', 'dead', ...(Object.keys(SKILLS) as SkillId[])])
    for (const state of Object.keys(RIG_CLIPS) as RigState[]) {
      expect(known.has(state), `${state} is mapped but unreachable`).toBe(true)
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
