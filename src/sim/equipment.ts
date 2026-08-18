import { equipFromInventory, type Character } from './character'
import type { Actor, EntityId, GroundItem, ItemId, PlayerId, SimEvent } from './types'
import { distance } from './vec2'

/**
 * Getting an item from the floor onto a body. Most of the work is already
 * `character.ts`; what is here is the part that needs a position and an actor.
 */

/** Generous on purpose: hunting for the exact pixel of a dropped rare is not fun. */
export const ITEM_PICKUP_RANGE = 2.6

export interface ItemHolder {
  playerId: PlayerId
  character: Character
  actor: Actor
}

/** Splices the item out of `groundItems` on success, leaves it there otherwise. */
export function pickUpGroundItem(holder: ItemHolder, groundItems: GroundItem[], groundItemId: EntityId): SimEvent[] {
  const index = groundItems.findIndex((ground) => ground.id === groundItemId)
  if (index === -1) return []
  const ground = groundItems[index]!
  if (distance(ground.pos, holder.actor.pos) > ITEM_PICKUP_RANGE) return []

  groundItems.splice(index, 1)
  holder.character.inventory.push(ground.item)
  return [
    {
      kind: 'item_picked_up',
      itemId: ground.item.id,
      name: ground.item.name,
      rarity: ground.item.rarity,
      subject: holder.playerId,
    },
  ]
}

export function equipFromBag(holder: ItemHolder, itemId: ItemId, recomputeStats: (actor: Actor) => void): SimEvent[] {
  const result = equipFromInventory(holder.character, itemId)
  if (!result) return []
  recomputeStats(holder.actor)
  return [{ kind: 'item_equipped', itemId, slot: result.slot, subject: holder.playerId }]
}
