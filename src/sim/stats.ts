import {
  DAMAGE_TYPES,
  MAX_RESISTANCE,
  type DamageType,
  type Mod,
  type StatKey,
  type Stats,
  type Tag,
} from './types'

export interface BaseStats {
  maxLife: number
  maxMana: number
  lifeRegen: number
  manaRegen: number
  armour: number
  moveSpeed: number
  critChance: number
  critMulti: number
  /** Attacks per second before mods. For the player this is the weapon's rate. */
  attackSpeed: number
}

export const PLAYER_BASE: BaseStats = {
  maxLife: 75,
  maxMana: 45,
  lifeRegen: 0.6,
  manaRegen: 3.2,
  armour: 0,
  moveSpeed: 5.4,
  critChance: 0.05,
  critMulti: 1.5,
  attackSpeed: 1,
}

/**
 * (base + flat) * (1 + sum of increased) * product of each more.
 * The PoE order: additive within a step, multiplicative between them.
 */
export function resolveStat(key: StatKey, base: number, mods: readonly Mod[]): number {
  let flat = 0
  let increased = 0
  let more = 1
  for (const mod of mods) {
    if (mod.stat !== key) continue
    if (mod.kind === 'flat') flat += mod.value
    else if (mod.kind === 'increased') increased += mod.value
    else more *= 1 + mod.value / 100
  }
  return (base + flat) * (1 + increased / 100) * more
}

export function resolveStats(base: BaseStats, mods: readonly Mod[]): Stats {
  const resistances = {} as Record<DamageType, number>
  for (const type of DAMAGE_TYPES) {
    const raw = resolveStat(`res_${type}` as StatKey, 0, mods) / 100
    resistances[type] = Math.min(raw, MAX_RESISTANCE)
  }
  return {
    maxLife: Math.max(1, Math.round(resolveStat('maxLife', base.maxLife, mods))),
    maxMana: Math.max(0, Math.round(resolveStat('maxMana', base.maxMana, mods))),
    lifeRegen: resolveStat('lifeRegen', base.lifeRegen, mods),
    manaRegen: resolveStat('manaRegen', base.manaRegen, mods),
    armour: Math.max(0, resolveStat('armour', base.armour, mods)),
    moveSpeed: Math.max(0.5, resolveStat('moveSpeed', base.moveSpeed, mods)),
    attackSpeed: Math.max(0.2, resolveStat('attackSpeed', base.attackSpeed, mods)),
    castSpeed: Math.max(0.2, resolveStat('castSpeed', 1, mods)),
    critChance: Math.min(0.95, resolveStat('critChance', base.critChance, mods)),
    critMulti: resolveStat('critMulti', base.critMulti, mods),
    areaRadius: Math.max(0.2, resolveStat('areaRadius', 1, mods)),
    pickupRadius: Math.max(0.5, resolveStat('pickupRadius', 1.6, mods)),
    resistances,
  }
}

/**
 * A damage mod applies to a portion of a hit only when every tag it carries is
 * present on that hit. An untagged mod applies to everything.
 */
export function damageModApplies(mod: Mod, skillTags: readonly Tag[], type: DamageType): boolean {
  if (!mod.tags || mod.tags.length === 0) return true
  for (const tag of mod.tags) {
    if (tag !== type && !skillTags.includes(tag)) return false
  }
  return true
}

export function describeMod(mod: Mod): string {
  const sign = mod.value >= 0 ? '+' : ''
  if (mod.stat === 'damage') {
    const type = mod.damageType ?? 'physical'
    const scope = mod.tags?.filter((t) => t !== type).join(' ') ?? ''
    if (mod.kind === 'flat') {
      return `Adds ${Math.round(mod.value)} to ${Math.round(mod.valueMax ?? mod.value)} ${type} damage${scope ? ` to ${scope}s` : ''}`
    }
    const verb = mod.kind === 'increased' ? 'increased' : 'more'
    return `${Math.round(mod.value)}% ${verb} ${type} ${scope} damage`.replace(/\s+/g, ' ')
  }
  const label = STAT_LABELS[mod.stat] ?? mod.stat
  if (mod.kind === 'flat') return `${sign}${round(mod.value)} ${label}`
  return `${sign}${round(mod.value)}% ${mod.kind === 'increased' ? 'increased' : 'more'} ${label}`
}

function round(value: number): number {
  return Math.abs(value) < 10 ? Math.round(value * 10) / 10 : Math.round(value)
}

const STAT_LABELS: Partial<Record<StatKey, string>> = {
  maxLife: 'maximum life',
  maxMana: 'maximum mana',
  lifeRegen: 'life regenerated per second',
  manaRegen: 'mana regenerated per second',
  armour: 'armour',
  moveSpeed: 'movement speed',
  attackSpeed: 'attack speed',
  castSpeed: 'cast speed',
  critChance: 'critical strike chance',
  critMulti: 'critical strike multiplier',
  areaRadius: 'area of effect',
  pickupRadius: 'pickup radius',
  res_fire: 'fire resistance',
  res_cold: 'cold resistance',
  res_lightning: 'lightning resistance',
  res_chaos: 'chaos resistance',
  res_physical: 'physical damage reduction',
}
