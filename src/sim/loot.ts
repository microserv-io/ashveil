import { basesForLevel, rollItem } from './items'
import type { Rng } from './rng'
import type { Item, ItemRarity, MonsterRarity } from './types'

interface DropProfile {
  /** Probability the corpse drops anything at all. */
  dropChance: number
  minItems: number
  maxItems: number
  rarityWeights: Record<ItemRarity, number>
  orbChance: number
}

/**
 * Normal monsters are mostly silent, rares are the payout. The gap between the
 * two is what makes a pack leader worth walking across the room for.
 */
export const DROP_PROFILES: Record<MonsterRarity, DropProfile> = {
  normal: {
    dropChance: 0.22,
    minItems: 1,
    maxItems: 1,
    rarityWeights: { normal: 62, magic: 34, rare: 4 },
    orbChance: 0.14,
  },
  magic: {
    dropChance: 0.7,
    minItems: 1,
    maxItems: 2,
    rarityWeights: { normal: 30, magic: 56, rare: 14 },
    orbChance: 0.3,
  },
  rare: {
    dropChance: 1,
    minItems: 2,
    maxItems: 4,
    rarityWeights: { normal: 12, magic: 52, rare: 36 },
    orbChance: 0.6,
  },
}

export interface Drops {
  items: Item[]
  orbs: number
}

export function rollDrops(monsterRarity: MonsterRarity, monsterLevel: number, rng: Rng): Drops {
  const profile = DROP_PROFILES[monsterRarity]
  const orbs = rng.chance(profile.orbChance) ? 1 : 0
  if (!rng.chance(profile.dropChance)) return { items: [], orbs }

  const count = rng.int(profile.minItems, profile.maxItems)
  const items: Item[] = []
  for (let i = 0; i < count; i++) {
    const itemLevel = Math.max(1, monsterLevel + rng.int(-1, 1))
    const bases = basesForLevel(itemLevel)
    if (bases.length === 0) continue
    const base = rng.pick(bases)
    const rarity = rng.weighted([
      { weight: profile.rarityWeights.normal, value: 'normal' as ItemRarity },
      { weight: profile.rarityWeights.magic, value: 'magic' as ItemRarity },
      { weight: profile.rarityWeights.rare, value: 'rare' as ItemRarity },
    ])
    items.push(rollItem(base.id, itemLevel, rarity, rng))
  }
  return { items, orbs }
}

/** The kit a fresh character starts in, so the first fight is not a formality. */
export function startingGear(rng: Rng): Item[] {
  return [rollItem('rusted_axe', 1, 'normal', rng), rollItem('rags', 1, 'normal', rng)]
}
