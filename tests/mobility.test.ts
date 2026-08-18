import { describe, expect, it } from 'vitest'
import { SKILLS } from '../src/sim/skills'
import { Sim } from '../src/sim/sim'
import type { Actor, SkillId } from '../src/sim/types'

/**
 * Rooting on attack is the genre's core tension: committing to a swing is a decision
 * with a cost. These pin which skills relax it and, more importantly, which must not.
 */

function walkFor(sim: Sim, actor: Actor, ticks: number): number {
  const from = { ...actor.pos }
  for (let i = 0; i < ticks; i++) {
    sim.queue({ kind: 'move_direction', direction: { x: 1, y: 0 } })
    sim.tick()
  }
  return Math.hypot(actor.pos.x - from.x, actor.pos.y - from.y)
}

describe('mobility while acting', () => {
  it('roots melee, because a swing has to be a commitment', () => {
    const sim = new Sim({ seed: 5 })
    const actor = sim.player
    sim.beginCast(actor, 'cleave', { x: actor.pos.x + 2, y: actor.pos.y })
    expect(walkFor(sim, actor, 8)).toBe(0)
  })

  it('lets a ranged spell walk, at a fraction of full speed', () => {
    const sim = new Sim({ seed: 5 })
    const actor = sim.player
    const free = walkFor(sim, actor, 8)

    const casting = new Sim({ seed: 5 })
    const caster = casting.player
    casting.beginCast(caster, 'firebolt', { x: caster.pos.x + 2, y: caster.pos.y })
    const moved = walkFor(casting, caster, 8)

    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(free)
  })

  it('keeps the actor facing what it is casting at, not where it is walking', () => {
    const sim = new Sim({ seed: 5 })
    const actor = sim.player
    sim.beginCast(actor, 'firebolt', { x: actor.pos.x, y: actor.pos.y + 3 })
    const aimed = actor.facing
    walkFor(sim, actor, 6)
    expect(actor.facing).toBeCloseTo(aimed, 5)
  })

  it('still reads as acting, so the renderer shows the cast and not a walk', () => {
    const sim = new Sim({ seed: 5 })
    const actor = sim.player
    sim.beginCast(actor, 'firebolt', { x: actor.pos.x + 2, y: actor.pos.y })
    walkFor(sim, actor, 4)
    expect(actor.state).toBe('acting')
  })

  it('never lets a monster move while winding up, or its tell is unreadable', () => {
    const rooted = (Object.entries(SKILLS) as [SkillId, (typeof SKILLS)[SkillId]][])
      .filter(([id]) => id.startsWith('monster_'))
      .filter(([, def]) => (def.mobility ?? 0) !== 0)
    expect(rooted.map(([id]) => id), 'monster skills must stay rooted').toEqual([])
  })

  it('defaults to rooted, so a new skill cannot silently gain mobility', () => {
    for (const [id, def] of Object.entries(SKILLS)) {
      expect(def.mobility ?? 0, `${id} mobility`).toBeGreaterThanOrEqual(0)
      expect(def.mobility ?? 0, `${id} mobility`).toBeLessThanOrEqual(1)
    }
    expect(SKILLS.cleave.mobility ?? 0).toBe(0)
    expect(SKILLS.frost_nova.mobility ?? 0).toBe(0)
  })
})
