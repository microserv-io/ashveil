import { describe, expect, it } from 'vitest'
import { Harness, measureDps, punchingBag } from '../src/sim/harness'
import { Sim } from '../src/sim/sim'
import { TICK_RATE } from '../src/sim/types'

/**
 * The loop itself: pull a pack, kill it, loot it, get stronger, go deeper. These
 * assert the loop closes, not the exact numbers, so tuning does not break them.
 */
describe('the core loop closes', () => {
  const harness = new Harness({ seed: 7, captureEvents: true })
  harness.run(4 * 60 * TICK_RATE)
  const report = harness.report()

  it('kills monsters', () => {
    expect(report.monstersKilled).toBeGreaterThan(30)
  })

  it('drops loot, and the player picks up and equips upgrades', () => {
    expect(report.drops.normal + report.drops.magic + report.drops.rare).toBeGreaterThan(5)
    expect(report.itemsEquipped).toBeGreaterThan(0)
  })

  it('awards experience and levels', () => {
    expect(report.xp).toBeGreaterThan(0)
    expect(report.level).toBeGreaterThan(2)
  })

  it('clears an area and descends through the portal', () => {
    expect(report.areasCleared).toBeGreaterThan(0)
    expect(report.depthReached).toBeGreaterThan(1)
  })

  it('spends its passive points', () => {
    expect(harness.sim.progress.allocated.size).toBeGreaterThan(1)
  })

  it('uses all three damaging skills', () => {
    expect(Object.keys(report.damageBySkill).sort()).toEqual(['cleave', 'firebolt', 'frost_nova'])
  })

  it('keeps the player alive most of the time', () => {
    expect(report.stateShare.dead).toBeLessThan(10)
  })
})

describe('monsters are a real threat', () => {
  it('kills a player who walks into a pack and never fights back', () => {
    const harness = new Harness({ seed: 3, policy: punchingBag })
    const sim = harness.sim
    // The spawn room is deliberately empty, so put the player in a pack's lap.
    const monster = sim.monsters()[0]!
    sim.player.pos = { x: monster.pos.x + 1, y: monster.pos.y }

    harness.runUntil((s) => s.player.dead, 90 * TICK_RATE)
    expect(sim.player.dead).toBe(true)
  })

  it('leaves a player standing in the empty spawn room alone', () => {
    const harness = new Harness({ seed: 3, policy: punchingBag })
    harness.run(30 * TICK_RATE)
    expect(harness.sim.player.dead).toBe(false)
    expect(harness.report().damageTaken).toBe(0)
  })

  it('respawns the player at the area spawn after dying', () => {
    const sim = new Sim({ seed: 3 })
    sim.player.life = -1
    sim.tick()
    expect(sim.player.dead).toBe(true)

    for (let i = 0; i < 3 * TICK_RATE; i++) sim.tick()
    expect(sim.player.dead).toBe(false)
    expect(sim.player.life).toBe(sim.player.stats.maxLife)
    expect(sim.player.pos).toEqual(sim.map.spawn)
  })

  it('drops aggro the moment the player dies', () => {
    const sim = new Sim({ seed: 5 })
    const monster = sim.monsters()[0]!
    monster.aggroed = true
    monster.targetId = sim.player.id
    sim.player.life = -1
    sim.tick()

    expect(sim.player.dead).toBe(true)
    expect(monster.aggroed).toBe(false)
    expect(monster.targetId).toBeNull()
  })
})

describe('power growth', () => {
  it('gear and passives multiply damage substantially', () => {
    const bare = measureDps({ seed: 1, skill: 'cleave', seconds: 20 })
    const geared = measureDps({
      seed: 1,
      skill: 'cleave',
      seconds: 20,
      level: 12,
      gear: [{ baseId: 'cleaver', itemLevel: 16, rarity: 'rare' }],
      passives: ['might_1', 'might_2', 'might_3'],
    })
    expect(geared.dps).toBeGreaterThan(bare.dps * 4)
  })

  it('a slow heavy weapon hits harder per swing than a fast one', () => {
    const fast = measureDps({ seed: 2, skill: 'cleave', seconds: 20, gear: [{ baseId: 'ashen_blade', itemLevel: 6, rarity: 'normal' }] })
    const slow = measureDps({ seed: 2, skill: 'cleave', seconds: 20, gear: [{ baseId: 'warmaul', itemLevel: 16, rarity: 'normal' }] })
    expect(slow.averageHit).toBeGreaterThan(fast.averageHit)
    expect(slow.hitsPerSecond).toBeLessThan(fast.hitsPerSecond)
  })
})

describe('resource costs bite', () => {
  it('refuses a cast the player cannot pay for and says so', () => {
    const sim = new Sim({ seed: 1 })
    sim.player.mana = 0
    sim.queue({ kind: 'use_skill', skill: 'frost_nova', aim: { x: 1, y: 1 } })
    sim.tick()
    expect(sim.events.some((e) => e.kind === 'mana_insufficient')).toBe(true)
    expect(sim.player.pendingCast).toBeNull()
  })

  it('puts a cooldown skill on cooldown', () => {
    const sim = new Sim({ seed: 1 })
    sim.queue({ kind: 'use_skill', skill: 'frost_nova', aim: sim.player.pos })
    sim.tick()
    expect(sim.cooldownRemaining(sim.player, 'frost_nova')).toBeGreaterThan(0)
  })

  it('commits to a cast: no second skill during windup', () => {
    const sim = new Sim({ seed: 1 })
    sim.queue({ kind: 'use_skill', skill: 'cleave', aim: { x: 5, y: 5 } })
    sim.tick()
    const used = sim.events.filter((e) => e.kind === 'skill_used').length
    expect(used).toBe(1)

    sim.queue({ kind: 'use_skill', skill: 'firebolt', aim: { x: 5, y: 5 } })
    sim.tick()
    expect(sim.events.some((e) => e.kind === 'skill_used')).toBe(false)
  })
})
