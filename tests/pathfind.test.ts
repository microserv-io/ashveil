import { describe, expect, it } from 'vitest'
import { generateArea, isFloor, isWalkable } from '../src/sim/mapgen'
import { NavGrid, findPath, hasLineOfSight } from '../src/sim/pathfind'
import { Rng } from '../src/sim/rng'
import { Sim } from '../src/sim/sim'
import { TICK_RATE } from '../src/sim/types'
import { distance } from '../src/sim/vec2'

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('map generation', () => {
  it('puts spawn and portal on walkable floor in different rooms', () => {
    for (const seed of SEEDS) {
      const { map } = generateArea(new Rng(seed), 1)
      expect(map.rooms.length).toBeGreaterThan(1)
      expect(isWalkable(map, map.spawn, 0.5)).toBe(true)
      expect(isWalkable(map, map.portal, 0.5)).toBe(true)
      expect(distance(map.spawn, map.portal)).toBeGreaterThan(5)
    }
  })

  it('spawns every monster on walkable ground', () => {
    for (const seed of SEEDS) {
      const { map, packs } = generateArea(new Rng(seed), 3)
      expect(packs.length).toBeGreaterThan(0)
      for (const pack of packs) {
        for (const member of pack.members) {
          expect(isFloor(map, Math.floor(member.pos.x), Math.floor(member.pos.y))).toBe(true)
        }
      }
    }
  })
})

describe('pathfinding', () => {
  it('finds a route from spawn to portal on every seed', () => {
    for (const seed of SEEDS) {
      const { map } = generateArea(new Rng(seed), 1)
      const nav = new NavGrid(map)
      const path = findPath(nav, map.spawn, map.portal, 0.44)
      expect(path, `seed ${seed}`).not.toBeNull()
      expect(path!.length).toBeGreaterThan(0)
    }
  })

  it('keeps every waypoint on ground the body fits through', () => {
    const { map } = generateArea(new Rng(4), 1)
    const nav = new NavGrid(map)
    const path = findPath(nav, map.spawn, map.portal, 0.44)!
    for (const waypoint of path) {
      expect(isWalkable(map, waypoint, 0.44)).toBe(true)
    }
  })

  it('reports no path to somewhere off the map', () => {
    const { map } = generateArea(new Rng(1), 1)
    const nav = new NavGrid(map)
    expect(findPath(nav, map.spawn, { x: -50, y: -50 }, 0.44)).toBeNull()
  })

  it('does not see through walls', () => {
    const { map } = generateArea(new Rng(2), 1)
    // A point outside the map is never visible from inside it.
    expect(hasLineOfSight(map, map.spawn, { x: -5, y: -5 })).toBe(false)
    expect(hasLineOfSight(map, map.spawn, map.spawn)).toBe(true)
  })
})

/**
 * Regression: a smoothed waypoint could sit behind a wall relative to where the
 * body actually stood, so it slid along that wall at nearly full speed while
 * making no progress. Distance-travelled looked healthy, so nothing recovered and
 * the run stalled for good.
 */
describe('walking across an area cannot stall', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed} reaches the portal`, () => {
      const sim = new Sim({ seed })
      // Remove the monsters so this measures locomotion, not combat.
      for (const monster of sim.monsters()) monster.life = -1
      sim.tick()

      const budgetTicks = 90 * TICK_RATE
      let arrived = false
      for (let i = 0; i < budgetTicks; i++) {
        if (distance(sim.player.pos, sim.map.portal) <= 2.4) {
          arrived = true
          break
        }
        if (!sim.player.moveTarget) sim.queue({ kind: 'move', to: sim.map.portal })
        sim.tick()
      }
      expect(arrived, `seed ${seed} never reached the portal`).toBe(true)
    })
  }
})
