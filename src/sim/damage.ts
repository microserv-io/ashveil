import type { Rng } from './rng'
import { damageModApplies } from './stats'
import {
  ARMOUR_DAMAGE_DIVISOR,
  DAMAGE_TYPES,
  MAX_PHYSICAL_REDUCTION,
  type Actor,
  type DamageType,
  type HitBreakdown,
  type Mod,
  type SkillDef,
  type Tag,
  type WeaponBase,
} from './types'

function emptyByType(): Record<DamageType, number> {
  return { physical: 0, fire: 0, cold: 0, lightning: 0, chaos: 0 }
}

/**
 * base -> flat added -> increased (additive) -> more (multiplicative) -> crit
 * -> mitigation. Every number a build can touch enters at exactly one of those
 * steps, which is what keeps the scaling readable once there are hundreds of mods.
 */
export function computeHit(
  source: Actor,
  target: Actor,
  skill: SkillDef,
  weapon: WeaponBase | null,
  rng: Rng,
  /** Falloff for area skills: 1 at the centre, less at the rim. */
  effectiveness = 1,
): HitBreakdown {
  const tags = skill.tags
  const raw = emptyByType()

  for (const type of DAMAGE_TYPES) {
    const range = skill.damage[type]
    if (range) raw[type] += rng.float(range[0], range[1])
  }

  if (skill.weaponScaling > 0 && weapon) {
    raw.physical += rng.float(weapon.physicalMin, weapon.physicalMax) * skill.weaponScaling
  }

  addFlatDamage(raw, source.mods, tags, rng)

  const scaled = emptyByType()
  for (const type of DAMAGE_TYPES) {
    if (raw[type] === 0) continue
    let increased = 0
    let more = 1
    for (const mod of source.mods) {
      if (mod.stat !== 'damage' || mod.kind === 'flat') continue
      if (!damageModApplies(mod, tags, type)) continue
      if (mod.kind === 'increased') increased += mod.value
      else more *= 1 + mod.value / 100
    }
    scaled[type] = raw[type] * (1 + increased / 100) * more * effectiveness
  }

  const crit = rng.chance(source.stats.critChance)
  if (crit) {
    for (const type of DAMAGE_TYPES) scaled[type] *= source.stats.critMulti
  }

  const final = emptyByType()
  let preMitigation = 0
  let total = 0
  for (const type of DAMAGE_TYPES) {
    const incoming = scaled[type]
    if (incoming === 0) continue
    preMitigation += incoming
    const taken = type === 'physical' ? applyArmour(incoming, target) : applyResistance(incoming, target, type)
    final[type] = taken
    total += taken
  }

  return {
    byType: final,
    total: Math.max(0, total),
    crit,
    mitigated: Math.max(0, preMitigation - total),
  }
}

function addFlatDamage(into: Record<DamageType, number>, mods: readonly Mod[], tags: readonly Tag[], rng: Rng): void {
  for (const mod of mods) {
    if (mod.stat !== 'damage' || mod.kind !== 'flat') continue
    const type = mod.damageType ?? 'physical'
    if (!damageModApplies(mod, tags, type)) continue
    into[type] += rng.float(mod.value, mod.valueMax ?? mod.value)
  }
}

/**
 * Armour scales with the size of the hit it faces, so a big armour number eats
 * a swarm's chip damage and barely dents a brute's slam.
 */
export function armourReduction(armour: number, incoming: number): number {
  if (armour <= 0 || incoming <= 0) return 0
  const reduction = armour / (armour + ARMOUR_DAMAGE_DIVISOR * incoming)
  return Math.min(reduction, MAX_PHYSICAL_REDUCTION)
}

function applyArmour(incoming: number, target: Actor): number {
  const flatReduction = target.stats.resistances.physical
  const afterArmour = incoming * (1 - armourReduction(target.stats.armour, incoming))
  return afterArmour * (1 - flatReduction)
}

function applyResistance(incoming: number, target: Actor, type: DamageType): number {
  return incoming * (1 - target.stats.resistances[type])
}
