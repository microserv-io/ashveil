import { areaRng, generateArea, type PackPlan } from './mapgen'
import { NavGrid } from './pathfind'
import type { Actor, AreaMap } from './types'
import { clone, type Vec2 } from './vec2'

/**
 * Arriving somewhere: the ground under an instance and the state of the bodies
 * standing on it. Kept out of the tick coordinator because the session, not the
 * instance, is what will own the transition once parties exist.
 */

export interface AreaEntry {
  map: AreaMap
  nav: NavGrid
  packs: readonly PackPlan[]
}

/** Geometry is a pure function of (seed, depth). Never send a map, send the seed. */
export function enterArea(seed: number, depth: number): AreaEntry {
  const generated = generateArea(areaRng(seed, depth), depth)
  return { map: generated.map, nav: new NavGrid(generated.map), packs: generated.packs }
}

/**
 * Back on your feet where you came in. The caller still clears the path: routing
 * needs the nav grid, which a revive has no business knowing about.
 */
export function revivePlayerAt(actor: Actor, spawn: Vec2): void {
  actor.pos = clone(spawn)
  actor.dead = false
  actor.state = 'idle'
  actor.life = actor.stats.maxLife
  actor.mana = actor.stats.maxMana
  actor.ailments = []
  actor.windup = 0
  actor.recovery = 0
  actor.pendingCast = null
  actor.dash = null
  actor.lastDamageFrom = null
}

/** A new area is a fresh start, which a respawn deliberately is not. */
export function resetPlayerForArea(actor: Actor, spawn: Vec2): void {
  revivePlayerAt(actor, spawn)
  actor.anchor = clone(spawn)
  actor.cooldowns = {}
}
