import { describe, expect, it } from 'vitest'
import { ashInfluenceAt, paintWeightsAt, terrainPaintTextureData } from '../src/world/terrain-paint'
import { getActiveZone } from '../src/world/zone-active'
import { PATHS } from '../src/world/world-data'
import { riverCenterAt, riverHalfWidthAt } from '../src/world/terrain'

describe('terrain paint field', () => {
  it('feathers a route from earth centre to living ground', () => {
    const path = [{ id: 'test', from: 'a', to: 'b', width: 4, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] }]
    const center = paintWeightsAt(5, 0, path)
    const edge = paintWeightsAt(5, 2, path)
    const outside = paintWeightsAt(5, 4, path)
    expect(center.earth).toBeGreaterThan(0.95)
    expect(edge.earth).toBeGreaterThan(0.1)
    expect(edge.earth).toBeLessThan(0.9)
    expect(outside.earth).toBeLessThan(0.05)
  })

  it('keeps round caps and connected junctions soft', () => {
    const cap = paintWeightsAt(PATHS[0]!.points[0]!.x - 1, PATHS[0]!.points[0]!.z, [PATHS[0]!])
    const junctionPoint = PATHS[0]!.points.at(-1)!
    const junction = paintWeightsAt(junctionPoint.x, junctionPoint.z, PATHS)
    expect(cap.earth).toBeGreaterThan(0.5)
    expect(junction.earth).toBeGreaterThan(0.9)
  })

  it('blends continuously into ash across the far bank', () => {
    const zone = getActiveZone()
    const z = 5
    const start = riverCenterAt(z) + riverHalfWidthAt(z) + 1
    const near = paintWeightsAt(start, z, []).ash
    const middle = paintWeightsAt(start + 5, z, []).ash
    const far = paintWeightsAt(start + 10, z, []).ash
    expect(near).toBeLessThan(0.05)
    expect(middle).toBeGreaterThan(near)
    expect(middle).toBeLessThan(far)
    expect(far).toBeGreaterThan(0.95)
    expect([near, middle, far]).toEqual([
      ashInfluenceAt(zone, start, z),
      ashInfluenceAt(zone, start + 5, z),
      ashInfluenceAt(zone, start + 10, z),
    ])
  })

  it('rasterizes the reusable ash influence without a second boundary formula', () => {
    const zone = getActiveZone()
    const paint = terrainPaintTextureData(zone, 20, 128, 128 * 128)
    const row = Math.floor(paint.height * 0.5)
    const column = Math.floor(paint.width * 0.75)
    const x = zone.bounds.minX + (column + 0.5) / paint.width * (zone.bounds.maxX - zone.bounds.minX)
    const z = zone.bounds.minZ + (row + 0.5) / paint.height * (zone.bounds.maxZ - zone.bounds.minZ)
    const rasterized = paint.data[(row * paint.width + column) * 4 + 1]! / 255
    expect(rasterized).toBeCloseTo(ashInfluenceAt(zone, x, z), 2)
  })
})
