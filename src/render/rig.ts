import type { Actor, SkillId } from '../sim/types'

/**
 * What the body is doing, derived from sim state. Skills are their own poses, so a
 * new skill that nobody mapped fails a test rather than rendering as a T-pose.
 */
export type RigState = 'idle' | 'moving' | 'dead' | SkillId

/**
 * KayKit clip names, best first. Both character packs ship the same 41-bone rig and
 * 76 shared clip names, so one table drives the player and every monster; the
 * fallbacks cover the handful of clips only the skeletons carry.
 */
export const RIG_CLIPS: Record<RigState, readonly string[]> = {
  idle: ['Idle', 'Unarmed_Idle'],
  moving: ['Running_A', 'Walking_A'],
  dead: ['Death_A', 'Death_B'],

  cleave: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'],
  firebolt: ['Spellcast_Shoot', 'Spellcasting'],
  frost_nova: ['Spellcast_Raise', 'Spellcasting'],
  dash: ['Dodge_Forward', 'Running_A'],

  monster_bite: ['Unarmed_Melee_Attack_Punch_A', '1H_Melee_Attack_Chop'],
  monster_bolt: ['Spellcast_Shoot', 'Spellcasting'],
  monster_slam: ['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop'],
}

export function rigStateOf(actor: Actor): RigState {
  if (actor.dead) return 'dead'
  if (actor.state === 'acting' && actor.activeSkill) return actor.activeSkill
  if (actor.state === 'moving') return 'moving'
  return 'idle'
}
