/**
 * Ashveil's actor states and skills, mapped onto KayKit clip names.
 *
 * Both packs ship the identical 41-bone rig and share 76 clip names, so one mapping
 * drives every character. Each entry lists fallbacks: the skeletons carry a few clips
 * the adventurers do not, and vice versa.
 */

/** The sim's `ActorState`, split by skill so each animation can be judged separately. */
export type ShownState = 'idle' | 'moving' | 'cleave' | 'firebolt' | 'frost_nova' | 'dash' | 'hit' | 'dead'

export const ASHVEIL_CLIP: Record<ShownState, readonly string[]> = {
  idle: ['Idle', 'Unarmed_Idle'],
  moving: ['Running_A', 'Walking_A'],
  cleave: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'],
  firebolt: ['Spellcast_Shoot', 'Spellcasting'],
  frost_nova: ['Spellcast_Raise', 'Spellcasting'],
  dash: ['Dodge_Forward', 'Running_A'],
  hit: ['Hit_A', 'Block_Hit'],
  dead: ['Death_A', 'Death_B'],
}

export const STATE_ORDER: readonly ShownState[] = [
  'idle',
  'moving',
  'cleave',
  'firebolt',
  'frost_nova',
  'dash',
  'hit',
  'dead',
]
