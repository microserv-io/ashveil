import { allocatePassive, grantExperience, type Character } from './character'
import { xpPenalty } from './progression'
import type { Actor, PlayerId, SimEvent } from './types'

/**
 * The instance half of progression. `character.ts` owns the persisted numbers;
 * this is what a level-up does to the body standing in the world.
 */

export interface Advancement {
  playerId: PlayerId
  character: Character
  actor: Actor
  /** The instance owns stat resolution, so a level-up has to ask it to re-run. */
  recomputeStats: (actor: Actor) => void
}

/**
 * Experience goes to whoever landed the killing blow. Sharing it across a party
 * is a session-level policy and belongs there, not here.
 */
export function grantKillXp(who: Advancement, amount: number, monsterLevel: number): SimEvent[] {
  const { playerId, character, actor, recomputeStats } = who
  const gained = Math.max(1, Math.round(amount * xpPenalty(character.level, monsterLevel)))
  const levels = grantExperience(character, gained)
  const events: SimEvent[] = [{ kind: 'xp_gained', amount: gained, total: character.xp, subject: playerId }]

  for (let i = 0; i < levels; i++) {
    actor.level = character.level
    const lifeBefore = actor.stats.maxLife
    recomputeStats(actor)
    actor.life += actor.stats.maxLife - lifeBefore
    events.push({
      kind: 'level_up',
      level: character.level,
      passivePoints: character.passivePoints,
      subject: playerId,
    })
  }

  return events
}

/** Spending a point can widen the life pool, and the extra should not arrive empty. */
export function allocatePassiveNode(who: Advancement, nodeId: string): SimEvent[] {
  if (!allocatePassive(who.character, nodeId)) return []
  const lifeBefore = who.actor.stats.maxLife
  who.recomputeStats(who.actor)
  who.actor.life += Math.max(0, who.actor.stats.maxLife - lifeBefore)
  return [{ kind: 'passive_allocated', nodeId, subject: who.playerId }]
}
