import { describe, expect, it } from 'vitest'
import { paintWeightsAt } from '../src/world/terrain-paint'
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
    const junction = paintWeightsAt(-55.2, -10.2, PATHS)
    expect(cap.earth).toBeGreaterThan(0.5)
    expect(junction.earth).toBeGreaterThan(0.9)
  })

  it('blends continuously into ash across the far bank', () => {
    const z = 5
    const start = riverCenterAt(z) + riverHalfWidthAt(z) + 1
    const near = paintWeightsAt(start, z, []).ash
    const middle = paintWeightsAt(start + 5, z, []).ash
    const far = paintWeightsAt(start + 10, z, []).ash
    expect(near).toBeLessThan(0.05)
    expect(middle).toBeGreaterThan(near)
    expect(middle).toBeLessThan(far)
    expect(far).toBeGreaterThan(0.95)
  })
})
