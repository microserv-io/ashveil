import { describe, expect, it } from 'vitest'
import { ITEM_PICKUP_RANGE, equipFromBag, pickUpGroundItem, type ItemHolder } from '../src/sim/equipment'
import { Sim } from '../src/sim/sim'
import type { GroundItem } from '../src/sim/types'
import { add, vec2 } from '../src/sim/vec2'

function holder(sim: Sim): ItemHolder {
  return { playerId: sim.localPlayerId, character: sim.progress, actor: sim.player }
}

function dropNear(sim: Sim, gap: number): GroundItem {
  const item = sim.grantItem('rusted_axe', 4, 'rare')
  sim.progress.inventory.push(item)
  return { id: 9001, item, pos: add(sim.player.pos, vec2(gap, 0)), droppedAt: sim.time }
}

describe('picking loot off the floor', () => {
  it('moves the item from the floor into the bag', () => {
    const sim = new Sim({ seed: 11 })
    const ground = [dropNear(sim, 1)]
    const bagBefore = sim.progress.inventory.length

    const events = pickUpGroundItem(holder(sim), ground, ground[0]!.id)

    expect(ground).toHaveLength(0)
    expect(sim.progress.inventory).toHaveLength(bagBefore + 1)
    expect(events.map((event) => event.kind)).toEqual(['item_picked_up'])
    expect(events[0]!.subject).toBe(sim.localPlayerId)
  })

  it('leaves an item out of reach where it is', () => {
    const sim = new Sim({ seed: 11 })
    const ground = [dropNear(sim, ITEM_PICKUP_RANGE + 0.1)]

    expect(pickUpGroundItem(holder(sim), ground, ground[0]!.id)).toEqual([])
    expect(ground).toHaveLength(1)
  })

  it('shrugs at an item that is no longer on the floor', () => {
    const sim = new Sim({ seed: 11 })

    expect(pickUpGroundItem(holder(sim), [], 4242)).toEqual([])
  })
})

describe('equipping', () => {
  it('takes the item out of the bag and re-resolves the wearer stats', () => {
    const sim = new Sim({ seed: 11 })
    const item = sim.grantItem('rusted_axe', 20, 'rare')
    sim.progress.inventory.push(item)
    let recomputed = 0

    const events = equipFromBag(holder(sim), item.id, (actor) => {
      recomputed++
      sim.recomputeStats(actor)
    })

    expect(recomputed).toBe(1)
    expect(sim.progress.inventory).not.toContain(item)
    expect(events.map((event) => event.kind)).toEqual(['item_equipped'])
  })

  it('does nothing at all for an item nobody is carrying', () => {
    const sim = new Sim({ seed: 11 })
    let recomputed = 0

    expect(equipFromBag(holder(sim), 'no-such-item', () => recomputed++)).toEqual([])
    expect(recomputed).toBe(0)
  })
})
