import type { Rng } from './rng'
import {
  type DamageType,
  type EquipSlot,
  type Item,
  type ItemBaseDef,
  type ItemRarity,
  type Mod,
  type ModKind,
  type RolledAffix,
  type StatKey,
  type Tag,
  type WeaponBase,
} from './types'

export const ITEM_BASES: readonly ItemBaseDef[] = [
  {
    id: 'rusted_axe',
    name: 'Rusted Axe',
    slot: 'weapon',
    dropLevel: 1,
    implicit: [],
    weapon: { physicalMin: 6, physicalMax: 11, attacksPerSecond: 1.25 },
  },
  {
    id: 'ashen_blade',
    name: 'Ashen Blade',
    slot: 'weapon',
    dropLevel: 6,
    implicit: [{ stat: 'critChance', kind: 'increased', value: 25, source: 'implicit' }],
    weapon: { physicalMin: 8, physicalMax: 15, attacksPerSecond: 1.45 },
  },
  {
    id: 'cleaver',
    name: 'Cleaver',
    slot: 'weapon',
    dropLevel: 10,
    implicit: [],
    weapon: { physicalMin: 14, physicalMax: 26, attacksPerSecond: 1.15 },
  },
  {
    id: 'warmaul',
    name: 'Warmaul',
    slot: 'weapon',
    dropLevel: 16,
    implicit: [{ stat: 'damage', kind: 'increased', value: 15, tags: ['area'], source: 'implicit' }],
    weapon: { physicalMin: 26, physicalMax: 48, attacksPerSecond: 0.95 },
  },

  { id: 'rags', name: 'Rags', slot: 'body', dropLevel: 1, implicit: [{ stat: 'armour', kind: 'flat', value: 14, source: 'implicit' }] },
  { id: 'leather_vest', name: 'Leather Vest', slot: 'body', dropLevel: 5, implicit: [{ stat: 'armour', kind: 'flat', value: 52, source: 'implicit' }] },
  { id: 'ringmail', name: 'Ringmail', slot: 'body', dropLevel: 12, implicit: [{ stat: 'armour', kind: 'flat', value: 145, source: 'implicit' }] },

  { id: 'leather_cap', name: 'Leather Cap', slot: 'helm', dropLevel: 1, implicit: [{ stat: 'armour', kind: 'flat', value: 9, source: 'implicit' }] },
  { id: 'iron_helm', name: 'Iron Helm', slot: 'helm', dropLevel: 8, implicit: [{ stat: 'armour', kind: 'flat', value: 46, source: 'implicit' }] },

  { id: 'rough_gloves', name: 'Rough Gloves', slot: 'gloves', dropLevel: 1, implicit: [{ stat: 'armour', kind: 'flat', value: 6, source: 'implicit' }] },
  { id: 'bracers', name: 'Bracers', slot: 'gloves', dropLevel: 9, implicit: [{ stat: 'attackSpeed', kind: 'increased', value: 4, source: 'implicit' }] },

  { id: 'worn_boots', name: 'Worn Boots', slot: 'boots', dropLevel: 1, implicit: [{ stat: 'moveSpeed', kind: 'increased', value: 6, source: 'implicit' }] },
  { id: 'trekking_boots', name: 'Trekking Boots', slot: 'boots', dropLevel: 9, implicit: [{ stat: 'moveSpeed', kind: 'increased', value: 12, source: 'implicit' }] },

  { id: 'bone_charm', name: 'Bone Charm', slot: 'amulet', dropLevel: 3, implicit: [{ stat: 'maxLife', kind: 'flat', value: 12, source: 'implicit' }] },
  { id: 'jade_amulet', name: 'Jade Amulet', slot: 'amulet', dropLevel: 11, implicit: [{ stat: 'manaRegen', kind: 'increased', value: 30, source: 'implicit' }] },

  { id: 'iron_ring', name: 'Iron Ring', slot: 'ring1', dropLevel: 2, implicit: [{ stat: 'damage', kind: 'flat', value: 1, valueMax: 3, damageType: 'physical', tags: ['attack'], source: 'implicit' }] },
  { id: 'copper_ring', name: 'Copper Ring', slot: 'ring1', dropLevel: 7, implicit: [{ stat: 'maxMana', kind: 'flat', value: 18, source: 'implicit' }] },
]

interface ModTemplate {
  stat: StatKey | 'damage'
  kind: ModKind
  min: number
  max: number
  /** Second range, for "adds X-Y to Z-W" style flat damage mods. */
  min2?: number
  max2?: number
  damageType?: DamageType
  tags?: readonly Tag[]
  /** Local mods change the item's own weapon numbers instead of the wearer's stats. */
  local?: boolean
}

interface AffixTier {
  tier: number
  itemLevel: number
  mods: readonly ModTemplate[]
}

interface AffixDef {
  id: string
  name: string
  kind: 'prefix' | 'suffix'
  slots: readonly EquipSlot[]
  tiers: readonly AffixTier[]
}

const ARMOUR_SLOTS: readonly EquipSlot[] = ['helm', 'body', 'gloves', 'boots']
const JEWELLERY: readonly EquipSlot[] = ['amulet', 'ring1', 'ring2']

export const AFFIXES: readonly AffixDef[] = [
  {
    id: 'life',
    name: 'Hale',
    kind: 'prefix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'maxLife', kind: 'flat', min: 8, max: 16 }] },
      { tier: 2, itemLevel: 8, mods: [{ stat: 'maxLife', kind: 'flat', min: 18, max: 30 }] },
      { tier: 1, itemLevel: 16, mods: [{ stat: 'maxLife', kind: 'flat', min: 34, max: 52 }] },
    ],
  },
  {
    id: 'armour',
    name: 'Plated',
    kind: 'prefix',
    slots: ARMOUR_SLOTS,
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'armour', kind: 'increased', min: 15, max: 30 }] },
      { tier: 2, itemLevel: 10, mods: [{ stat: 'armour', kind: 'increased', min: 32, max: 55 }] },
      { tier: 1, itemLevel: 18, mods: [{ stat: 'armour', kind: 'increased', min: 60, max: 90 }] },
    ],
  },
  {
    id: 'weapon_physical',
    name: 'Heavy',
    kind: 'prefix',
    slots: ['weapon'],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'damage', kind: 'flat', min: 2, max: 4, min2: 5, max2: 8, damageType: 'physical', local: true }] },
      { tier: 2, itemLevel: 9, mods: [{ stat: 'damage', kind: 'flat', min: 5, max: 8, min2: 11, max2: 17, damageType: 'physical', local: true }] },
      { tier: 1, itemLevel: 17, mods: [{ stat: 'damage', kind: 'flat', min: 9, max: 14, min2: 20, max2: 30, damageType: 'physical', local: true }] },
    ],
  },
  {
    id: 'weapon_increased_physical',
    name: 'Vicious',
    kind: 'prefix',
    slots: ['weapon'],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'damage', kind: 'increased', min: 20, max: 40, damageType: 'physical', local: true }] },
      { tier: 2, itemLevel: 11, mods: [{ stat: 'damage', kind: 'increased', min: 45, max: 70, damageType: 'physical', local: true }] },
      { tier: 1, itemLevel: 20, mods: [{ stat: 'damage', kind: 'increased', min: 75, max: 110, damageType: 'physical', local: true }] },
    ],
  },
  {
    id: 'added_fire',
    name: 'Smouldering',
    kind: 'prefix',
    slots: ['weapon', ...JEWELLERY],
    tiers: [
      { tier: 3, itemLevel: 2, mods: [{ stat: 'damage', kind: 'flat', min: 2, max: 4, min2: 6, max2: 10, damageType: 'fire', tags: ['attack'] }] },
      { tier: 1, itemLevel: 14, mods: [{ stat: 'damage', kind: 'flat', min: 6, max: 10, min2: 14, max2: 22, damageType: 'fire', tags: ['attack'] }] },
    ],
  },
  {
    id: 'spell_damage',
    name: 'Arcanist',
    kind: 'prefix',
    slots: [...JEWELLERY, 'weapon'],
    tiers: [
      { tier: 3, itemLevel: 3, mods: [{ stat: 'damage', kind: 'increased', min: 15, max: 28, tags: ['spell'] }] },
      { tier: 2, itemLevel: 12, mods: [{ stat: 'damage', kind: 'increased', min: 30, max: 48, tags: ['spell'] }] },
      { tier: 1, itemLevel: 20, mods: [{ stat: 'damage', kind: 'increased', min: 52, max: 78, tags: ['spell'] }] },
    ],
  },
  {
    id: 'mana',
    name: 'Wellspring',
    kind: 'prefix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 2, itemLevel: 1, mods: [{ stat: 'maxMana', kind: 'flat', min: 10, max: 22 }] },
      { tier: 1, itemLevel: 12, mods: [{ stat: 'maxMana', kind: 'flat', min: 24, max: 44 }] },
    ],
  },

  {
    id: 'attack_speed',
    name: 'of Fury',
    kind: 'suffix',
    slots: ['weapon', 'gloves', ...JEWELLERY],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'attackSpeed', kind: 'increased', min: 6, max: 11 }] },
      { tier: 2, itemLevel: 11, mods: [{ stat: 'attackSpeed', kind: 'increased', min: 12, max: 17 }] },
      { tier: 1, itemLevel: 19, mods: [{ stat: 'attackSpeed', kind: 'increased', min: 18, max: 25 }] },
    ],
  },
  {
    id: 'cast_speed',
    name: 'of Insight',
    kind: 'suffix',
    slots: ['weapon', 'gloves', ...JEWELLERY],
    tiers: [
      { tier: 2, itemLevel: 4, mods: [{ stat: 'castSpeed', kind: 'increased', min: 7, max: 13 }] },
      { tier: 1, itemLevel: 15, mods: [{ stat: 'castSpeed', kind: 'increased', min: 14, max: 22 }] },
    ],
  },
  {
    id: 'crit_chance',
    name: 'of Precision',
    kind: 'suffix',
    slots: ['weapon', ...JEWELLERY],
    tiers: [
      { tier: 2, itemLevel: 5, mods: [{ stat: 'critChance', kind: 'increased', min: 20, max: 40 }] },
      { tier: 1, itemLevel: 16, mods: [{ stat: 'critChance', kind: 'increased', min: 45, max: 75 }] },
    ],
  },
  {
    id: 'crit_multi',
    name: 'of Ruin',
    kind: 'suffix',
    slots: ['weapon', 'amulet'],
    tiers: [
      { tier: 2, itemLevel: 8, mods: [{ stat: 'critMulti', kind: 'flat', min: 0.1, max: 0.2 }] },
      { tier: 1, itemLevel: 18, mods: [{ stat: 'critMulti', kind: 'flat', min: 0.22, max: 0.38 }] },
    ],
  },
  {
    id: 'fire_res',
    name: 'of the Ember',
    kind: 'suffix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'res_fire', kind: 'flat', min: 10, max: 20 }] },
      { tier: 1, itemLevel: 12, mods: [{ stat: 'res_fire', kind: 'flat', min: 22, max: 38 }] },
    ],
  },
  {
    id: 'cold_res',
    name: 'of the Rime',
    kind: 'suffix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'res_cold', kind: 'flat', min: 10, max: 20 }] },
      { tier: 1, itemLevel: 12, mods: [{ stat: 'res_cold', kind: 'flat', min: 22, max: 38 }] },
    ],
  },
  {
    id: 'lightning_res',
    name: 'of the Storm',
    kind: 'suffix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 3, itemLevel: 1, mods: [{ stat: 'res_lightning', kind: 'flat', min: 10, max: 20 }] },
      { tier: 1, itemLevel: 12, mods: [{ stat: 'res_lightning', kind: 'flat', min: 22, max: 38 }] },
    ],
  },
  {
    id: 'move_speed',
    name: 'of the Wind',
    kind: 'suffix',
    slots: ['boots'],
    tiers: [
      { tier: 2, itemLevel: 1, mods: [{ stat: 'moveSpeed', kind: 'increased', min: 8, max: 14 }] },
      { tier: 1, itemLevel: 14, mods: [{ stat: 'moveSpeed', kind: 'increased', min: 15, max: 22 }] },
    ],
  },
  {
    id: 'mana_regen',
    name: 'of Renewal',
    kind: 'suffix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 2, itemLevel: 1, mods: [{ stat: 'manaRegen', kind: 'increased', min: 20, max: 40 }] },
      { tier: 1, itemLevel: 13, mods: [{ stat: 'manaRegen', kind: 'increased', min: 45, max: 75 }] },
    ],
  },
  {
    id: 'life_regen',
    name: 'of Mending',
    kind: 'suffix',
    slots: [...ARMOUR_SLOTS, ...JEWELLERY],
    tiers: [
      { tier: 2, itemLevel: 1, mods: [{ stat: 'lifeRegen', kind: 'flat', min: 0.6, max: 1.6 }] },
      { tier: 1, itemLevel: 13, mods: [{ stat: 'lifeRegen', kind: 'flat', min: 1.8, max: 3.6 }] },
    ],
  },
]

export const AFFIX_COUNTS: Record<ItemRarity, { prefixes: number; suffixes: number }> = {
  normal: { prefixes: 0, suffixes: 0 },
  magic: { prefixes: 1, suffixes: 1 },
  rare: { prefixes: 3, suffixes: 3 },
}

export function itemBase(baseId: string): ItemBaseDef {
  const found = ITEM_BASES.find((b) => b.id === baseId)
  if (!found) throw new Error(`unknown item base: ${baseId}`)
  return found
}

export function basesForLevel(itemLevel: number, slot?: EquipSlot): ItemBaseDef[] {
  return ITEM_BASES.filter((b) => b.dropLevel <= itemLevel && (!slot || slotMatches(b.slot, slot)))
}

function slotMatches(baseSlot: EquipSlot, wanted: EquipSlot): boolean {
  if (baseSlot === wanted) return true
  return baseSlot === 'ring1' && wanted === 'ring2'
}

let nextItemId = 1
export function resetItemIds(): void {
  nextItemId = 1
}

export function rollItem(baseId: string, itemLevel: number, rarity: ItemRarity, rng: Rng): Item {
  const base = itemBase(baseId)
  const counts = AFFIX_COUNTS[rarity]
  const prefixes = rollAffixes(base.slot, itemLevel, 'prefix', rng.int(rarity === 'rare' ? 2 : counts.prefixes, counts.prefixes), rng)
  const suffixes = rollAffixes(base.slot, itemLevel, 'suffix', rng.int(rarity === 'rare' ? 2 : counts.suffixes, counts.suffixes), rng)
  const affixes = [...prefixes, ...suffixes]

  const weapon = base.weapon ? applyLocalMods({ ...base.weapon }, affixes) : undefined

  return {
    id: nextItemId++,
    baseId: base.id,
    name: itemName(base, rarity, prefixes[0], suffixes[0], rng),
    slot: base.slot,
    rarity,
    itemLevel,
    implicit: base.implicit,
    affixes,
    weapon,
  }
}

function rollAffixes(
  slot: EquipSlot,
  itemLevel: number,
  kind: 'prefix' | 'suffix',
  count: number,
  rng: Rng,
): RolledAffix[] {
  if (count <= 0) return []
  const pool = AFFIXES.filter(
    (a) => a.kind === kind && a.slots.some((s) => slotMatches(s, slot)) && a.tiers.some((t) => t.itemLevel <= itemLevel),
  )
  const out: RolledAffix[] = []
  const taken = new Set<string>()
  for (let i = 0; i < count && taken.size < pool.length; i++) {
    const candidates = pool.filter((a) => !taken.has(a.id))
    if (candidates.length === 0) break
    const def = rng.pick(candidates)
    taken.add(def.id)
    const eligible = def.tiers.filter((t) => t.itemLevel <= itemLevel)
    // Weight the best available tier lowest so upgrades stay meaningful.
    const tier = rng.weighted(eligible.map((t, index) => ({ weight: index === eligible.length - 1 ? 1 : 2, value: t })))
    out.push({
      id: def.id,
      name: def.name,
      kind: def.kind,
      tier: tier.tier,
      mods: tier.mods.map((template) => rollMod(template, def.id, rng)),
    })
  }
  return out
}

function rollMod(template: ModTemplate, source: string, rng: Rng): Mod {
  const mod: Mod = {
    stat: template.stat,
    kind: template.kind,
    value: roundValue(rng.float(template.min, template.max)),
    source,
  }
  if (template.min2 !== undefined) mod.valueMax = roundValue(rng.float(template.min2, template.max2 ?? template.min2))
  if (template.damageType) mod.damageType = template.damageType
  if (template.tags) mod.tags = template.tags
  if (template.local) mod.source = `${source}:local`
  return mod
}

function roundValue(value: number): number {
  return value < 3 ? Math.round(value * 100) / 100 : Math.round(value)
}

function applyLocalMods(weapon: WeaponBase, affixes: readonly RolledAffix[]): WeaponBase {
  let flatMin = 0
  let flatMax = 0
  let increased = 0
  let attackSpeed = 0
  for (const affix of affixes) {
    for (const mod of affix.mods) {
      if (!mod.source?.endsWith(':local')) continue
      if (mod.stat === 'damage' && mod.kind === 'flat') {
        flatMin += mod.value
        flatMax += mod.valueMax ?? mod.value
      } else if (mod.stat === 'damage' && mod.kind === 'increased') {
        increased += mod.value
      } else if (mod.stat === 'attackSpeed') {
        attackSpeed += mod.value
      }
    }
  }
  const multiplier = 1 + increased / 100
  return {
    physicalMin: Math.round((weapon.physicalMin + flatMin) * multiplier),
    physicalMax: Math.round((weapon.physicalMax + flatMax) * multiplier),
    attacksPerSecond: Math.round(weapon.attacksPerSecond * (1 + attackSpeed / 100) * 100) / 100,
  }
}

const RARE_PREFIX_WORDS = ['Grim', 'Ash', 'Dread', 'Ember', 'Rime', 'Storm', 'Bone', 'Gore', 'Void', 'Hollow']
const RARE_SUFFIX_WORDS = ['bane', 'song', 'ward', 'brand', 'shard', 'weave', 'coil', 'rend', 'thirst', 'veil']

function itemName(
  base: { name: string },
  rarity: ItemRarity,
  prefix: RolledAffix | undefined,
  suffix: RolledAffix | undefined,
  rng: Rng,
): string {
  if (rarity === 'normal') return base.name
  if (rarity === 'magic') {
    const head = prefix ? `${prefix.name} ` : ''
    const tail = suffix ? ` ${suffix.name}` : ''
    return `${head}${base.name}${tail}`.trim()
  }
  return `${rng.pick(RARE_PREFIX_WORDS)}${rng.pick(RARE_SUFFIX_WORDS)}, ${base.name}`
}

/**
 * The mods an equipped item grants its wearer. Local mods are excluded — they
 * already live in the rolled weapon numbers.
 */
export function itemMods(item: Item): Mod[] {
  const out: Mod[] = [...item.implicit]
  for (const affix of item.affixes) {
    for (const mod of affix.mods) {
      if (mod.source?.endsWith(':local')) continue
      out.push(mod)
    }
  }
  return out
}

/** A single number for "is this an upgrade", used by the harness bot and the UI. */
export function itemScore(item: Item): number {
  let score = 0
  if (item.weapon) {
    score += ((item.weapon.physicalMin + item.weapon.physicalMax) / 2) * item.weapon.attacksPerSecond * 2
  }
  for (const mod of [...item.implicit, ...item.affixes.flatMap((a) => a.mods)]) {
    if (mod.source?.endsWith(':local')) continue
    score += modScore(mod)
  }
  return Math.round(score * 10) / 10
}

function modScore(mod: Mod): number {
  const magnitude = mod.value + (mod.valueMax ?? mod.value) * 0.5
  switch (mod.stat) {
    case 'maxLife':
      return magnitude * 0.6
    case 'armour':
      return mod.kind === 'flat' ? magnitude * 0.05 : magnitude * 0.2
    case 'maxMana':
      return magnitude * 0.2
    case 'damage':
      return magnitude * (mod.kind === 'flat' ? 1.2 : 0.5)
    case 'attackSpeed':
    case 'castSpeed':
      return magnitude * 1.1
    case 'moveSpeed':
      return magnitude * 1.4
    case 'critChance':
      return magnitude * 0.35
    case 'critMulti':
      return magnitude * 30
    case 'lifeRegen':
      return magnitude * 3
    case 'manaRegen':
      return magnitude * 0.4
    default:
      return magnitude * 0.5
  }
}
