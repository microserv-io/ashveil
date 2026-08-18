import { describe, expect, it } from 'vitest'
import { scatterWalkable, spoilsOf, type DropSite } from '../src/sim/drops'
import { areaRng, generateArea, isWalkable } from '../src/sim/mapgen'
import { Rng } from '../src/sim/rng'
import type { AreaMap, MonsterRarity } from '../src/sim/types'
import { vec2 } from '../src/sim/vec2'

function site(seed = 7): DropSite {
  const map = generateArea(areaRng(seed, 3), 3).map
  let entityId = 1
  let serial = 1
  return {
    map,
    rng: new Rng(seed),
    mint: {
      next: (source: string) => ({
        id: `test#${serial++}`,
        origin: { instanceId: 'test', depth: 3, tick: 0, source },
      }),
    },
    time: 12,
    nextId: () => entityId++,
  }
}

function corpseAt(rarity: MonsterRarity, map: AreaMap) {
  return { name: 'husk', rarity, level: 6, pos: map.spawn }
}

describe('what a corpse leaves behind', () => {
  it('pays out for a rare and announces every item', () => {
    const where = site()
    const spoils = spoilsOf(where, corpseAt('rare', where.map))

    expect(spoils.groundItems.length).toBeGreaterThan(0)
    expect(spoils.events.filter((e) => e.kind === 'item_dropped')).toHaveLength(spoils.groundItems.length)
  })

  it('scatters everything onto ground a body can stand on', () => {
    const where = site()
    const spoils = spoilsOf(where, corpseAt('rare', where.map))

    for (const dropped of [...spoils.groundItems, ...spoils.orbs]) {
      expect(isWalkable(where.map, dropped.pos, 0.3)).toBe(true)
    }
  })

  it('gives items and orbs distinct entity ids', () => {
    const where = site()
    const spoils = spoilsOf(where, corpseAt('rare', where.map))
    const ids = [...spoils.groundItems, ...spoils.orbs].map((dropped) => dropped.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stamps the drop time so the host can fade old loot', () => {
    const where = site()
    const spoils = spoilsOf(where, corpseAt('rare', where.map))

    for (const dropped of [...spoils.groundItems, ...spoils.orbs]) {
      expect(dropped.droppedAt).toBe(where.time)
    }
  })
})

describe('scatter', () => {
  it('falls back to the corpse when there is nowhere to scatter to', () => {
    const solid: AreaMap = {
      width: 8,
      height: 8,
      tiles: new Uint8Array(64),
      spawn: vec2(4, 4),
      portal: vec2(4, 4),
      rooms: [],
    }

    expect(scatterWalkable(solid, new Rng(1), vec2(4, 4), 1.1)).toEqual(vec2(4, 4))
  })
})
