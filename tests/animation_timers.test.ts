import { describe, expect, it } from 'vitest'
import { decodeSnapshot, encodeSnapshot } from '../src/sim/snapshot'
import { Sim } from '../src/sim/sim'
import { revivePlayerAt } from '../src/sim/transitions'
import { DT, type Actor } from '../src/sim/types'

type ActorWithTotals = Actor & { windupTotal: number; recoveryTotal: number }

describe('animation timer totals', () => {
  it('keeps the duration each cast timer started from', () => {
    const sim = new Sim({ seed: 23 })
    const actor = sim.player as ActorWithTotals

    expect(sim.beginCast(actor, 'cleave', { x: actor.pos.x + 2, y: actor.pos.y })).toBe(true)
    expect(actor.windupTotal).toBe(actor.windup)

    while (actor.windup > 0) sim.tick()

    expect(actor.recovery).toBeGreaterThan(0)
    expect(actor.recoveryTotal).toBe(actor.recovery)
  })

  it('preserves both totals through a JSON snapshot round-trip', () => {
    const sim = new Sim({ seed: 29 })
    const actor = sim.player as ActorWithTotals
    sim.beginCast(actor, 'firebolt', { x: actor.pos.x + 3, y: actor.pos.y })
    actor.recoveryTotal = 0.75
    actor.recovery = Math.max(DT, actor.recoveryTotal - DT)

    const restored = Sim.restore(decodeSnapshot(encodeSnapshot(sim.snapshot()))).player as ActorWithTotals

    expect(restored.windupTotal).toBe(actor.windupTotal)
    expect(restored.recoveryTotal).toBe(actor.recoveryTotal)
  })

  it('clears timer totals when a transition clears the active timers', () => {
    const sim = new Sim({ seed: 31 })
    const actor = sim.player as ActorWithTotals
    actor.windup = 0.2
    actor.windupTotal = 0.3
    actor.recovery = 0.4
    actor.recoveryTotal = 0.5

    revivePlayerAt(actor, sim.map.spawn)

    expect({ windup: actor.windup, windupTotal: actor.windupTotal }).toEqual({ windup: 0, windupTotal: 0 })
    expect({ recovery: actor.recovery, recoveryTotal: actor.recoveryTotal }).toEqual({ recovery: 0, recoveryTotal: 0 })
  })

  it('initialises and advances monster timer totals through recovery', () => {
    const sim = new Sim({ seed: 37 })
    const monster = sim.monsters()[0] as ActorWithTotals
    const skill = monster.skills[0]!

    expect({ windupTotal: monster.windupTotal, recoveryTotal: monster.recoveryTotal }).toEqual({
      windupTotal: 0,
      recoveryTotal: 0,
    })
    expect(sim.beginCast(monster, skill, sim.player.pos)).toBe(true)
    expect(monster.windupTotal).toBe(monster.windup)

    while (monster.windup > 0) sim.tick()

    expect(monster.recovery).toBeGreaterThan(0)
    expect(monster.recoveryTotal).toBe(monster.recovery)
  })
})
