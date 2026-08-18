import type { ItemMint } from './items'
import { rollDrops } from './loot'
import { isWalkable } from './mapgen'
import type { Rng } from './rng'
import type { AreaMap, EntityId, GroundItem, MonsterRarity, Orb, SimEvent } from './types'
import { add, clone, fromAngle, type Vec2 } from './vec2'

/**
 * Turning a death into things on the floor. `loot.ts` owns the drop tables; this
 * owns where they land and what the host is told about them.
 */

/** A share of maximum life, so an orb is worth the same at every level. */
const ORB_LIFE_FRACTION = 0.22
const ITEM_SCATTER = 1.1
const ORB_SCATTER = 0.8
const SCATTER_ATTEMPTS = 8
/** Loot is smaller than a body, so it fits where a body would not. */
const DROP_RADIUS = 0.3

/** Everything a drop needs from the instance it happens in, and nothing else. */
export interface DropSite {
  map: AreaMap
  rng: Rng
  mint: ItemMint
  time: number
  nextId: () => EntityId
}

export interface Corpse {
  name: string
  rarity: MonsterRarity
  level: number
  pos: Vec2
}

export interface Spoils {
  groundItems: GroundItem[]
  orbs: Orb[]
  events: SimEvent[]
}

export function spoilsOf(site: DropSite, corpse: Corpse): Spoils {
  const drops = rollDrops(corpse.rarity, corpse.level, site.rng, site.mint, `drop:${corpse.name}`)
  const spoils: Spoils = { groundItems: [], orbs: [], events: [] }

  for (const item of drops.items) {
    const groundItem: GroundItem = {
      id: site.nextId(),
      item,
      pos: scatterWalkable(site.map, site.rng, corpse.pos, ITEM_SCATTER),
      droppedAt: site.time,
    }
    spoils.groundItems.push(groundItem)
    spoils.events.push({
      kind: 'item_dropped',
      groundItemId: groundItem.id,
      rarity: item.rarity,
      pos: clone(groundItem.pos),
    })
  }

  for (let i = 0; i < drops.orbs; i++) {
    spoils.orbs.push({
      id: site.nextId(),
      pos: scatterWalkable(site.map, site.rng, corpse.pos, ORB_SCATTER),
      lifeFraction: ORB_LIFE_FRACTION,
      droppedAt: site.time,
    })
  }

  return spoils
}

/** Loot inside a wall is loot nobody can reach, so a boxed-in corpse keeps its pile. */
export function scatterWalkable(map: AreaMap, rng: Rng, origin: Vec2, spread: number): Vec2 {
  for (let attempt = 0; attempt < SCATTER_ATTEMPTS; attempt++) {
    const candidate = add(origin, fromAngle(rng.float(0, Math.PI * 2), rng.float(0.2, spread)))
    if (isWalkable(map, candidate, DROP_RADIUS)) return candidate
  }
  return clone(origin)
}
