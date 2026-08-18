import { describe, expect, it } from 'vitest'
import { grantKillXp, type XpRecipient } from '../src/sim/leveling'
import { Sim } from '../src/sim/sim'

function recipient(sim: Sim): XpRecipient {
  return {
    playerId: sim.localPlayerId,
    character: sim.progress,
    actor: sim.player,
    recomputeStats: (actor) => sim.recomputeStats(actor),
  }
}

function xpPaid(events: ReturnType<typeof grantKillXp>): number {
  const gained = events.find((event) => event.kind === 'xp_gained')
  return gained?.kind === 'xp_gained' ? gained.amount : 0
}

describe('experience from a kill', () => {
  it('pays full for on-level content and tails off for trivial content', () => {
    const sim = new Sim({ seed: 4 })
    sim.progress.level = 20

    const onLevel = xpPaid(grantKillXp(recipient(sim), 500, 20))
    const trivial = xpPaid(grantKillXp(recipient(sim), 500, 1))

    expect(onLevel).toBe(500)
    expect(trivial).toBeLessThan(onLevel / 10)
  })

  it('never pays nothing, so a kill always counts', () => {
    const sim = new Sim({ seed: 4 })
    sim.progress.level = 40

    expect(xpPaid(grantKillXp(recipient(sim), 1, 1))).toBeGreaterThan(0)
  })

  it('addresses every event to the player who earned it', () => {
    const sim = new Sim({ seed: 4 })
    const events = grantKillXp(recipient(sim), 5000, sim.progress.level)

    expect(events.length).toBeGreaterThan(1)
    for (const event of events) expect(event.subject).toBe(sim.localPlayerId)
  })
})

describe('levelling up', () => {
  it('announces one level_up per level crossed', () => {
    const sim = new Sim({ seed: 4 })
    const before = sim.progress.level
    const events = grantKillXp(recipient(sim), 20_000, before)
    const levels = events.filter((event) => event.kind === 'level_up')

    expect(sim.progress.level).toBeGreaterThan(before)
    expect(levels).toHaveLength(sim.progress.level - before)
  })

  it('hands the new maximum life to the actor rather than leaving it hurt', () => {
    const sim = new Sim({ seed: 4 })
    const actor = sim.player
    const maxBefore = actor.stats.maxLife
    actor.life = maxBefore

    grantKillXp(recipient(sim), 20_000, actor.level)

    expect(actor.stats.maxLife).toBeGreaterThan(maxBefore)
    expect(actor.life).toBe(actor.stats.maxLife)
  })
})
