import { describe, expect, it } from 'vitest'
import { armourReduction, computeHit } from '../src/sim/damage'
import { Rng } from '../src/sim/rng'
import { resolveStat, resolveStats, type BaseStats } from '../src/sim/stats'
import { MAX_RESISTANCE, type Actor, type Mod, type SkillDef } from '../src/sim/types'

const NEUTRAL_BASE: BaseStats = {
  maxLife: 100,
  maxMana: 0,
  lifeRegen: 0,
  manaRegen: 0,
  armour: 0,
  moveSpeed: 5,
  critChance: 0,
  critMulti: 1.5,
  attackSpeed: 1,
}

function actor(mods: Mod[] = [], base: Partial<BaseStats> = {}): Actor {
  const stats = resolveStats({ ...NEUTRAL_BASE, ...base }, mods)
  return {
    id: 1,
    kind: 'player',
    name: 'test',
    level: 1,
    archetype: null,
    rarity: 'normal',
    packId: 0,
    pos: { x: 0, y: 0 },
    radius: 0.4,
    facing: 0,
    velocity: { x: 0, y: 0 },
    life: stats.maxLife,
    mana: stats.maxMana,
    mods,
    stats,
    state: 'idle',
    targetId: null,
    windup: 0,
    recovery: 0,
    activeSkill: null,
    pendingCast: null,
    cooldowns: new Map(),
    skills: [],
    moveTarget: null,
    moveDirection: null,
    moveDirectionExpiry: 0,
    path: [],
    pathCursor: 0,
    repathAt: 0,
    stuckFor: 0,
    anchor: { x: 0, y: 0 },
    aggroed: false,
    dash: null,
    ailments: [],
    dead: false,
    diedAt: 0,
    hitFlash: 0,
    xpValue: 0,
  }
}

/** A spell with an exactly-known base so every step is checkable by hand. */
const FIXED_SPELL: SkillDef = {
  id: 'firebolt',
  name: 'test bolt',
  shape: 'projectile',
  tags: ['spell', 'projectile', 'fire'],
  manaCost: 0,
  cooldown: 0,
  windup: 0,
  recovery: 0,
  range: 10,
  damage: { fire: [100, 100] },
  weaponScaling: 0,
}

const rng = () => new Rng(42)

describe('stat resolution order', () => {
  it('applies flat, then increased additively, then more multiplicatively', () => {
    const mods: Mod[] = [
      { stat: 'maxLife', kind: 'flat', value: 50 },
      { stat: 'maxLife', kind: 'increased', value: 50 },
      { stat: 'maxLife', kind: 'increased', value: 50 },
      { stat: 'maxLife', kind: 'more', value: 10 },
    ]
    // (100 + 50) * (1 + 1.00) * 1.1
    expect(resolveStat('maxLife', 100, mods)).toBeCloseTo(330)
  })

  it('caps resistances', () => {
    const stats = resolveStats(NEUTRAL_BASE, [{ stat: 'res_fire', kind: 'flat', value: 200 }])
    expect(stats.resistances.fire).toBe(MAX_RESISTANCE)
  })
})

describe('damage pipeline', () => {
  it('increased damage is additive between mods', () => {
    const source = actor([
      { stat: 'damage', kind: 'increased', value: 50, tags: ['fire'] },
      { stat: 'damage', kind: 'increased', value: 50, tags: ['spell'] },
    ])
    const hit = computeHit(source, actor(), FIXED_SPELL, null, rng())
    expect(hit.total).toBeCloseTo(200)
  })

  it('more damage multiplies on top of increased', () => {
    const source = actor([
      { stat: 'damage', kind: 'increased', value: 100 },
      { stat: 'damage', kind: 'more', value: 50 },
    ])
    const hit = computeHit(source, actor(), FIXED_SPELL, null, rng())
    expect(hit.total).toBeCloseTo(300)
  })

  it('only applies a damage mod when every one of its tags is on the hit', () => {
    const wrongType = actor([{ stat: 'damage', kind: 'increased', value: 100, tags: ['cold'] }])
    expect(computeHit(wrongType, actor(), FIXED_SPELL, null, rng()).total).toBeCloseTo(100)

    const wrongDelivery = actor([{ stat: 'damage', kind: 'increased', value: 100, tags: ['attack'] }])
    expect(computeHit(wrongDelivery, actor(), FIXED_SPELL, null, rng()).total).toBeCloseTo(100)

    const bothPresent = actor([{ stat: 'damage', kind: 'increased', value: 100, tags: ['fire', 'spell'] }])
    expect(computeHit(bothPresent, actor(), FIXED_SPELL, null, rng()).total).toBeCloseTo(200)
  })

  it('adds flat damage before the increases scale it', () => {
    const source = actor([
      { stat: 'damage', kind: 'flat', value: 50, damageType: 'fire' },
      { stat: 'damage', kind: 'increased', value: 100 },
    ])
    expect(computeHit(source, actor(), FIXED_SPELL, null, rng()).total).toBeCloseTo(300)
  })

  it('applies resistance after all scaling', () => {
    const target = actor([{ stat: 'res_fire', kind: 'flat', value: 50 }])
    const hit = computeHit(actor(), target, FIXED_SPELL, null, rng())
    expect(hit.total).toBeCloseTo(50)
    expect(hit.mitigated).toBeCloseTo(50)
  })

  it('crit multiplies the whole hit', () => {
    const source = actor([], { critChance: 1, critMulti: 2 })
    const hit = computeHit(source, actor(), FIXED_SPELL, null, rng())
    expect(hit.crit).toBe(true)
    expect(hit.total).toBeCloseTo(200)
  })

  it('scales area falloff by effectiveness', () => {
    const hit = computeHit(actor(), actor(), FIXED_SPELL, null, rng(), 0.65)
    expect(hit.total).toBeCloseTo(65)
  })

  it('rolls weapon damage into attacks and ignores it for spells', () => {
    const attack: SkillDef = { ...FIXED_SPELL, tags: ['attack', 'melee'], damage: {}, weaponScaling: 1 }
    const weapon = { physicalMin: 10, physicalMax: 10, attacksPerSecond: 1 }
    expect(computeHit(actor(), actor(), attack, weapon, rng()).total).toBeCloseTo(10)
    expect(computeHit(actor(), actor(), FIXED_SPELL, weapon, rng()).total).toBeCloseTo(100)
  })
})

describe('armour', () => {
  it('mitigates small hits far better than large ones', () => {
    const small = armourReduction(500, 10)
    const large = armourReduction(500, 200)
    expect(small).toBeGreaterThan(large)
    expect(small).toBeGreaterThan(0.9 - 1e-9)
  })

  it('never fully negates a hit', () => {
    expect(armourReduction(1e9, 100)).toBeLessThanOrEqual(0.9)
  })

  it('is zero without armour', () => {
    expect(armourReduction(0, 100)).toBe(0)
  })
})
