import { describe, expect, it } from 'vitest'
import { AFFIX_COUNTS, itemBase, itemMods, itemScore, rollItem } from '../src/sim/items'
import { rollDrops } from '../src/sim/loot'
import { Rng } from '../src/sim/rng'
import type { ItemRarity } from '../src/sim/types'

describe('item rolling', () => {
  it('respects the affix budget for each rarity', () => {
    const rng = new Rng(7)
    for (const rarity of ['normal', 'magic', 'rare'] as ItemRarity[]) {
      for (let i = 0; i < 40; i++) {
        const item = rollItem('cleaver', 20, rarity, rng)
        const prefixes = item.affixes.filter((a) => a.kind === 'prefix').length
        const suffixes = item.affixes.filter((a) => a.kind === 'suffix').length
        expect(prefixes).toBeLessThanOrEqual(AFFIX_COUNTS[rarity].prefixes)
        expect(suffixes).toBeLessThanOrEqual(AFFIX_COUNTS[rarity].suffixes)
      }
    }
  })

  it('never rolls the same affix twice on one item', () => {
    const rng = new Rng(11)
    for (let i = 0; i < 60; i++) {
      const item = rollItem('iron_ring', 20, 'rare', rng)
      const ids = item.affixes.map((a) => a.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('only rolls affixes the item level unlocks', () => {
    const rng = new Rng(3)
    for (let i = 0; i < 60; i++) {
      const item = rollItem('rusted_axe', 1, 'rare', rng)
      // Tier 1 mods all require item level well above 1.
      expect(item.affixes.every((a) => a.tier >= 2)).toBe(true)
    }
  })

  it('folds local weapon mods into the weapon and keeps them off the wearer', () => {
    const rng = new Rng(5)
    const base = itemBase('cleaver').weapon!
    let sawLocal = false
    for (let i = 0; i < 80; i++) {
      const item = rollItem('cleaver', 20, 'rare', rng)
      const localMods = item.affixes.flatMap((a) => a.mods).filter((m) => m.source?.endsWith(':local'))
      if (localMods.length === 0) continue
      sawLocal = true
      expect(item.weapon!.physicalMax).toBeGreaterThan(base.physicalMax)
      // Local mods must not also be granted globally, or they would count twice.
      expect(itemMods(item).some((m) => m.source?.endsWith(':local'))).toBe(false)
    }
    expect(sawLocal).toBe(true)
  })

  it('scores a rare above a normal of the same base', () => {
    const rng = new Rng(9)
    const normal = rollItem('ringmail', 20, 'normal', rng)
    const rare = rollItem('ringmail', 20, 'rare', rng)
    expect(itemScore(rare)).toBeGreaterThan(itemScore(normal))
  })
})

describe('drops', () => {
  it('pays out more from rarer monsters', () => {
    const rng = new Rng(21)
    const counts = { normal: 0, magic: 0, rare: 0 }
    for (let i = 0; i < 2000; i++) {
      counts.normal += rollDrops('normal', 10, rng).items.length
      counts.magic += rollDrops('magic', 10, rng).items.length
      counts.rare += rollDrops('rare', 10, rng).items.length
    }
    expect(counts.magic).toBeGreaterThan(counts.normal)
    expect(counts.rare).toBeGreaterThan(counts.magic)
  })

  it('never drops an item above the monster level plus one', () => {
    const rng = new Rng(33)
    for (let i = 0; i < 500; i++) {
      for (const item of rollDrops('rare', 8, rng).items) {
        expect(item.itemLevel).toBeLessThanOrEqual(9)
        expect(item.itemLevel).toBeGreaterThanOrEqual(1)
      }
    }
  })
})
