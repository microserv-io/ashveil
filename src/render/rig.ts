import type { Actor, SkillId } from '../sim/types'
import type { MotionName } from './procedural/clips'

/**
 * What the body is doing, derived from sim state. Skills are their own poses, so a
 * new skill that nobody mapped fails a test rather than rendering as a T-pose.
 */
export type RigState = 'idle' | 'moving' | 'dead' | SkillId | MotionName

export function rigStateOf(actor: Actor): RigState {
  if (actor.dead) return 'dead'
  if (actor.state === 'acting' && actor.activeSkill) return actor.activeSkill
  if (actor.state === 'moving') return 'moving'
  return 'idle'
}
