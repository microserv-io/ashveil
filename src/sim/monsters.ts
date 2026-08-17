import type { BaseStats } from './stats'
import type { Mod, MonsterArchetype, MonsterRarity, SkillId } from './types'

export interface MonsterDef {
  archetype: MonsterArchetype
  name: string
  radius: number
  skills: readonly SkillId[]
  life: number
  lifePerLevel: number
  armour: number
  armourPerLevel: number
  moveSpeed: number
  aggroRadius: number
  /** How close it wants to be. Ranged archetypes back off below this. */
  preferredRange: number
  leashRadius: number
  xp: number
  damageMultiplier: number
}

export const MONSTERS: Record<MonsterArchetype, MonsterDef> = {
  swarm: {
    archetype: 'swarm',
    name: 'Husk',
    radius: 0.42,
    skills: ['monster_bite'],
    life: 26,
    lifePerLevel: 7,
    armour: 0,
    armourPerLevel: 2,
    moveSpeed: 5.1,
    aggroRadius: 11,
    preferredRange: 1.5,
    leashRadius: 26,
    xp: 12,
    damageMultiplier: 1,
  },
  ranged: {
    archetype: 'ranged',
    name: 'Sparkbound',
    radius: 0.45,
    skills: ['monster_bolt'],
    life: 34,
    lifePerLevel: 8,
    armour: 0,
    armourPerLevel: 1,
    moveSpeed: 4.1,
    aggroRadius: 13,
    preferredRange: 9,
    leashRadius: 22,
    xp: 18,
    damageMultiplier: 1,
  },
  brute: {
    archetype: 'brute',
    name: 'Gravebound',
    radius: 0.78,
    skills: ['monster_slam', 'monster_bite'],
    life: 74,
    lifePerLevel: 17,
    armour: 40,
    armourPerLevel: 14,
    moveSpeed: 3.3,
    aggroRadius: 10,
    preferredRange: 2.2,
    leashRadius: 20,
    xp: 55,
    damageMultiplier: 1,
  },
}

interface RarityScaling {
  life: number
  damage: number
  xp: number
  extraMods: number
  namePrefix: string
}

export const RARITY_SCALING: Record<MonsterRarity, RarityScaling> = {
  normal: { life: 1, damage: 1, xp: 1, extraMods: 0, namePrefix: '' },
  magic: { life: 1.9, damage: 1.2, xp: 3, extraMods: 1, namePrefix: 'Wretched ' },
  rare: { life: 3.4, damage: 1.4, xp: 9, extraMods: 2, namePrefix: 'Ashen ' },
}

/** Rolled onto magic and rare monsters so packs are not all the same fight. */
export const MONSTER_MODIFIERS: readonly { name: string; mods: readonly Mod[] }[] = [
  { name: 'Quickened', mods: [{ stat: 'moveSpeed', kind: 'increased', value: 30 }, { stat: 'attackSpeed', kind: 'increased', value: 25 }] },
  { name: 'Ironhide', mods: [{ stat: 'armour', kind: 'flat', value: 120 }] },
  { name: 'Emberheart', mods: [{ stat: 'damage', kind: 'flat', value: 6, valueMax: 12, damageType: 'fire' }] },
  { name: 'Stormtouched', mods: [{ stat: 'damage', kind: 'flat', value: 4, valueMax: 16, damageType: 'lightning' }] },
  { name: 'Brutal', mods: [{ stat: 'damage', kind: 'increased', value: 45, damageType: 'physical', tags: ['physical'] }] },
  { name: 'Warded', mods: [{ stat: 'res_fire', kind: 'flat', value: 40 }, { stat: 'res_cold', kind: 'flat', value: 40 }] },
  { name: 'Vital', mods: [{ stat: 'maxLife', kind: 'increased', value: 60 }] },
]

export function monsterBaseStats(def: MonsterDef, level: number, rarity: MonsterRarity): BaseStats {
  const scaling = RARITY_SCALING[rarity]
  return {
    maxLife: Math.round((def.life + def.lifePerLevel * (level - 1)) * scaling.life),
    maxMana: 0,
    lifeRegen: 0,
    manaRegen: 0,
    armour: def.armour + def.armourPerLevel * (level - 1),
    moveSpeed: def.moveSpeed,
    critChance: 0.05,
    critMulti: 1.3,
    attackSpeed: 1,
  }
}

/**
 * Monster damage rises with area level through a global mod rather than per-skill
 * tables, so one number tunes the whole difficulty curve.
 */
export function monsterDamageMods(def: MonsterDef, level: number, rarity: MonsterRarity): Mod[] {
  const perLevel = 11
  const increased = (level - 1) * perLevel * def.damageMultiplier * RARITY_SCALING[rarity].damage
  return increased === 0 ? [] : [{ stat: 'damage', kind: 'increased', value: increased, source: 'monster level' }]
}

/**
 * A rare with two modifiers on the first floor is a wall a starting character
 * cannot get through, so modifier count ramps with depth.
 */
export function monsterModifierCount(rarity: MonsterRarity, depth: number): number {
  const cap = RARITY_SCALING[rarity].extraMods
  if (cap === 0) return 0
  return Math.max(1, Math.min(cap, Math.floor(depth / 3) + 1))
}

export function monsterXp(def: MonsterDef, level: number, rarity: MonsterRarity): number {
  return Math.round(def.xp * (1 + (level - 1) * 0.35) * RARITY_SCALING[rarity].xp)
}
