import type { SkillDef, SkillId } from './types'

/**
 * Every skill commits: a windup you cannot cancel, then the hit, then recovery.
 * That commitment is what makes positioning matter, so the numbers here are the
 * main lever on how the loop feels.
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  cleave: {
    id: 'cleave',
    name: 'Cleave',
    shape: 'melee_arc',
    tags: ['attack', 'melee', 'area', 'physical'],
    manaCost: 0,
    cooldown: 0,
    windup: 0.22,
    recovery: 0.14,
    range: 2.4,
    arcDegrees: 120,
    damage: {},
    weaponScaling: 1,
  },

  firebolt: {
    id: 'firebolt',
    name: 'Firebolt',
    shape: 'projectile',
    tags: ['spell', 'projectile', 'fire'],
    manaCost: 5,
    cooldown: 0,
    windup: 0.3,
    recovery: 0.12,
    range: 15,
    damage: { fire: [13, 21] },
    weaponScaling: 0,
    projectileSpeed: 19,
    projectileRadius: 0.35,
    pierce: 0,
    ailmentChance: 0.25,
    // A bolt is aimed, not swung: walking while you throw it costs accuracy of
    // position, not of the shot, so it is the one skill that reads right in motion.
    mobility: 0.5,
  },

  frost_nova: {
    id: 'frost_nova',
    name: 'Frost Nova',
    shape: 'nova',
    tags: ['spell', 'area', 'cold'],
    manaCost: 15,
    cooldown: 3.4,
    windup: 0.38,
    recovery: 0.24,
    range: 0,
    radius: 4.2,
    damage: { cold: [20, 32] },
    weaponScaling: 0,
    ailmentChance: 0.9,
  },

  dash: {
    id: 'dash',
    name: 'Dash',
    shape: 'dash',
    tags: ['movement'],
    manaCost: 0,
    cooldown: 2.2,
    windup: 0.04,
    recovery: 0.14,
    range: 5.6,
    damage: {},
    weaponScaling: 0,
    dashSpeed: 26,
  },

  monster_bite: {
    id: 'monster_bite',
    name: 'Bite',
    shape: 'melee_arc',
    tags: ['attack', 'melee', 'physical'],
    manaCost: 0,
    cooldown: 0.9,
    windup: 0.34,
    recovery: 0.3,
    range: 1.9,
    arcDegrees: 100,
    damage: { physical: [5, 9] },
    weaponScaling: 0,
  },

  monster_bolt: {
    id: 'monster_bolt',
    name: 'Spark Bolt',
    shape: 'projectile',
    tags: ['spell', 'projectile', 'lightning'],
    manaCost: 0,
    cooldown: 2.1,
    windup: 0.6,
    recovery: 0.45,
    range: 12,
    damage: { lightning: [6, 13] },
    weaponScaling: 0,
    projectileSpeed: 13,
    projectileRadius: 0.3,
    pierce: 0,
    telegraph: 0.6,
  },

  monster_slam: {
    id: 'monster_slam',
    name: 'Slam',
    shape: 'nova',
    tags: ['attack', 'area', 'physical'],
    manaCost: 0,
    cooldown: 4.2,
    windup: 0.85,
    recovery: 0.65,
    range: 2.6,
    radius: 3.2,
    damage: { physical: [13, 22] },
    weaponScaling: 0,
    telegraph: 0.85,
  },
}

export const PLAYER_SKILLS: readonly SkillId[] = ['cleave', 'firebolt', 'frost_nova', 'dash']

export function skill(id: SkillId): SkillDef {
  return SKILLS[id]
}

/** Attacks scale their timings with attack speed, spells with cast speed. */
export function speedMultiplier(def: SkillDef, attackSpeed: number, castSpeed: number): number {
  if (def.tags.includes('attack')) return attackSpeed
  if (def.tags.includes('spell')) return castSpeed
  return 1
}
