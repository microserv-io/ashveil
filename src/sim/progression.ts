import type { Mod } from './types'

export const MAX_LEVEL = 30

/** Cumulative experience required to reach each level; index 0 is level 1. */
export const XP_TABLE: readonly number[] = (() => {
  const table: number[] = [0]
  let requirement = 130
  for (let level = 2; level <= MAX_LEVEL; level++) {
    table.push(Math.round(table[level - 2]! + requirement))
    requirement = Math.round(requirement * 1.42)
  }
  return table
})()

export function levelForXp(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= XP_TABLE[level]!) level++
  return level
}

export function xpIntoLevel(xp: number, level: number): { into: number; needed: number } {
  if (level >= MAX_LEVEL) return { into: 0, needed: 0 }
  const floorXp = XP_TABLE[level - 1]!
  return { into: xp - floorXp, needed: XP_TABLE[level]! - floorXp }
}

/**
 * Experience falls off when the area is far below the character, so progress
 * always means moving deeper rather than re-clearing the first floor.
 */
export function xpPenalty(playerLevel: number, monsterLevel: number): number {
  const gap = playerLevel - monsterLevel
  if (gap <= 2) return 1
  return Math.max(0.05, 1 - (gap - 2) * 0.18)
}

/** Stats every character gains per level, independent of the passive tree. */
export function levelMods(level: number): Mod[] {
  const gained = level - 1
  if (gained <= 0) return []
  return [
    { stat: 'maxLife', kind: 'flat', value: gained * 11, source: 'level' },
    { stat: 'maxMana', kind: 'flat', value: gained * 5, source: 'level' },
  ]
}

export interface PassiveNode {
  id: string
  name: string
  description: string
  mods: readonly Mod[]
  requires: string | null
  /** Layout for the passive panel; -1..1 on both axes. */
  position: { x: number; y: number }
}

export const PASSIVE_ROOT = 'root'

export const PASSIVES: readonly PassiveNode[] = [
  {
    id: PASSIVE_ROOT,
    name: 'Ashen Wake',
    description: 'The start of the tree.',
    mods: [],
    requires: null,
    position: { x: 0, y: 0 },
  },

  {
    id: 'might_1',
    name: 'Heavy Hands',
    description: '20% increased physical damage',
    mods: [{ stat: 'damage', kind: 'increased', value: 20, tags: ['physical'], source: 'might_1' }],
    requires: PASSIVE_ROOT,
    position: { x: -0.45, y: -0.3 },
  },
  {
    id: 'might_2',
    name: 'Butcher',
    description: '12% increased attack speed',
    mods: [{ stat: 'attackSpeed', kind: 'increased', value: 12, source: 'might_2' }],
    requires: 'might_1',
    position: { x: -0.75, y: -0.5 },
  },
  {
    id: 'might_3',
    name: 'Wide Swing',
    description: '25% increased area damage and 15% increased area of effect',
    mods: [
      { stat: 'damage', kind: 'increased', value: 25, tags: ['area'], source: 'might_3' },
      { stat: 'areaRadius', kind: 'increased', value: 15, source: 'might_3' },
    ],
    requires: 'might_1',
    position: { x: -0.7, y: -0.05 },
  },
  {
    id: 'might_4',
    name: 'Executioner',
    description: '30% increased critical strike multiplier',
    mods: [{ stat: 'critMulti', kind: 'flat', value: 0.3, source: 'might_4' }],
    requires: 'might_2',
    position: { x: -0.95, y: -0.75 },
  },

  {
    id: 'ward_1',
    name: 'Thick Skin',
    description: '+25 maximum life',
    mods: [{ stat: 'maxLife', kind: 'flat', value: 25, source: 'ward_1' }],
    requires: PASSIVE_ROOT,
    position: { x: 0, y: 0.42 },
  },
  {
    id: 'ward_2',
    name: 'Ironclad',
    description: '40% increased armour',
    mods: [{ stat: 'armour', kind: 'increased', value: 40, source: 'ward_2' }],
    requires: 'ward_1',
    position: { x: -0.28, y: 0.72 },
  },
  {
    id: 'ward_3',
    name: 'Elemental Ward',
    description: '+18% to all elemental resistances',
    mods: [
      { stat: 'res_fire', kind: 'flat', value: 18, source: 'ward_3' },
      { stat: 'res_cold', kind: 'flat', value: 18, source: 'ward_3' },
      { stat: 'res_lightning', kind: 'flat', value: 18, source: 'ward_3' },
    ],
    requires: 'ward_1',
    position: { x: 0.28, y: 0.72 },
  },
  {
    id: 'ward_4',
    name: 'Slow Mending',
    description: '2 life regenerated per second',
    mods: [{ stat: 'lifeRegen', kind: 'flat', value: 2, source: 'ward_4' }],
    requires: 'ward_2',
    position: { x: -0.5, y: 0.95 },
  },

  {
    id: 'ember_1',
    name: 'Kindling',
    description: '25% increased spell damage',
    mods: [{ stat: 'damage', kind: 'increased', value: 25, tags: ['spell'], source: 'ember_1' }],
    requires: PASSIVE_ROOT,
    position: { x: 0.45, y: -0.3 },
  },
  {
    id: 'ember_2',
    name: 'Quick Chant',
    description: '14% increased cast speed',
    mods: [{ stat: 'castSpeed', kind: 'increased', value: 14, source: 'ember_2' }],
    requires: 'ember_1',
    position: { x: 0.75, y: -0.5 },
  },
  {
    id: 'ember_3',
    name: 'Deep Well',
    description: '+30 maximum mana and 30% increased mana regeneration',
    mods: [
      { stat: 'maxMana', kind: 'flat', value: 30, source: 'ember_3' },
      { stat: 'manaRegen', kind: 'increased', value: 30, source: 'ember_3' },
    ],
    requires: 'ember_1',
    position: { x: 0.7, y: -0.05 },
  },
  {
    id: 'ember_4',
    name: 'Conflagration',
    description: '35% increased fire damage',
    mods: [{ stat: 'damage', kind: 'increased', value: 35, tags: ['fire'], source: 'ember_4' }],
    requires: 'ember_2',
    position: { x: 0.95, y: -0.75 },
  },
  {
    id: 'ember_5',
    name: 'Hoarfrost',
    description: '35% increased cold damage',
    mods: [{ stat: 'damage', kind: 'increased', value: 35, tags: ['cold'], source: 'ember_5' }],
    requires: 'ember_3',
    position: { x: 1, y: 0.1 },
  },
]

export function passive(id: string): PassiveNode {
  const node = PASSIVES.find((p) => p.id === id)
  if (!node) throw new Error(`unknown passive: ${id}`)
  return node
}

export function canAllocate(id: string, allocated: ReadonlySet<string>, points: number): boolean {
  if (allocated.has(id)) return false
  if (points <= 0) return false
  const node = PASSIVES.find((p) => p.id === id)
  if (!node) return false
  return node.requires === null || allocated.has(node.requires)
}
