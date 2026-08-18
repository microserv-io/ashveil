import { describe, expect, it } from 'vitest'
import { Sim } from '../src/sim/sim'
import { enterArea, resetPlayerForArea, revivePlayerAt } from '../src/sim/transitions'
import { vec2 } from '../src/sim/vec2'

describe('area entry', () => {
  it('is a pure function of seed and depth, so the wire carries neither', () => {
    const first = enterArea(17, 4)
    const second = enterArea(17, 4)

    expect(second.map.tiles).toEqual(first.map.tiles)
    expect(second.map.spawn).toEqual(first.map.spawn)
    expect(second.packs).toEqual(first.packs)
  })

  it('gives a different depth different ground', () => {
    expect(enterArea(17, 5).map.tiles).not.toEqual(enterArea(17, 4).map.tiles)
  })

  it('hands back a nav grid already built for the map it generated', () => {
    const entry = enterArea(17, 4)

    expect(entry.nav.map).toBe(entry.map)
    expect(entry.nav.passable(Math.floor(entry.map.spawn.x), Math.floor(entry.map.spawn.y), 0.44)).toBe(true)
  })
})

describe('putting a player back on their feet', () => {
  function downedPlayer() {
    const sim = new Sim({ seed: 21 })
    const actor = sim.player
    actor.dead = true
    actor.state = 'dead'
    actor.life = 0
    actor.mana = 0
    actor.ailments = [{ kind: 'ignited', magnitude: 3, expiresAt: 99, sourceId: 1 }]
    actor.windup = 0.4
    actor.recovery = 0.4
    actor.lastDamageFrom = 2
    actor.cooldowns = { dash: 3 }
    actor.anchor = vec2(99, 99)
    return { sim, actor }
  }

  it('revives at the spawn with a full bar and no lingering ailments', () => {
    const { sim, actor } = downedPlayer()

    revivePlayerAt(actor, sim.map.spawn)

    expect(actor.dead).toBe(false)
    expect(actor.state).toBe('idle')
    expect(actor.pos).toEqual(sim.map.spawn)
    expect(actor.life).toBe(actor.stats.maxLife)
    expect(actor.mana).toBe(actor.stats.maxMana)
    expect(actor.ailments).toEqual([])
    expect(actor.lastDamageFrom).toBeNull()
  })

  it('does not refund cooldowns, so dying is not a reset button', () => {
    const { sim, actor } = downedPlayer()

    revivePlayerAt(actor, sim.map.spawn)

    expect(actor.cooldowns.dash).toBe(3)
    expect(actor.anchor).toEqual(vec2(99, 99))
  })

  it('does refund them on a new area, which is a fresh start', () => {
    const { sim, actor } = downedPlayer()

    resetPlayerForArea(actor, sim.map.spawn)

    expect(actor.cooldowns).toEqual({})
    expect(actor.anchor).toEqual(sim.map.spawn)
  })
})
