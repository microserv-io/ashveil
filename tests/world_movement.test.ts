import { describe, expect, it } from 'vitest'
import { canOccupy, createExplorer, MAX_FRAME_DELTA, moveExplorer } from '../src/world/movement'
import { PATHS, SPAWN } from '../src/world/world-data'
import { heightAt, riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from '../src/world/terrain'

describe('first-zone movement', () => {
  it('substeps a long frame and caps elapsed time', () => {
    const explorer = createExplorer(SPAWN)
    const moved = moveExplorer(explorer, { x: 1, z: 0, sprint: true }, 2)
    expect(moved.x - explorer.x).toBeLessThanOrEqual(8 * MAX_FRAME_DELTA + 0.001)
    expect(moved.y).toBeCloseTo(heightAt(moved.x, moved.z), 10)
  })

  it('blocks diagonal entry into the river', () => {
    const z = 4
    const edge = riverCenterAt(z) - riverHalfWidthAt(z)
    let explorer = createExplorer({ x: edge - 3, z: z - 3 })
    for (let i = 0; i < 40; i += 1) {
      explorer = moveExplorer(explorer, { x: 1, z: 1, sprint: true }, 1 / 30)
    }
    const localEdge = riverCenterAt(explorer.z) - riverHalfWidthAt(explorer.z)
    expect(explorer.x + explorer.radius).toBeLessThanOrEqual(localEdge + 0.001)
  })

  it('blocks an angled attempt across the broken span', () => {
    let explorer = createExplorer({ x: -2, z: -86 })
    for (let i = 0; i < 180; i += 1) {
      explorer = moveExplorer(explorer, { x: 1, z: 0.35, sprint: true }, 1 / 60)
    }
    expect(explorer.x + explorer.radius).toBeLessThanOrEqual(
      riverCenterAt(explorer.z) - riverHalfWidthAt(explorer.z) + 0.001,
    )
    expect(Math.hypot(explorer.x - 5, explorer.z + 80)).toBeGreaterThanOrEqual(4 + explorer.radius)
    expect(canOccupy(createExplorer({ x: -20, z: -76 }), -19.5, -76.2)).toBe(true)
  })

  it('blocks diagonal escape through the world corner', () => {
    let explorer = createExplorer({ x: WORLD_BOUNDS.minX + 2, z: WORLD_BOUNDS.minZ + 2 })
    for (let i = 0; i < 40; i += 1) {
      explorer = moveExplorer(explorer, { x: -1, z: -1, sprint: true }, 1 / 30)
    }
    expect(explorer.x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + explorer.radius)
    expect(explorer.z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + explorer.radius)
  })

  it('keeps dense route centerlines clear for the controller', () => {
    for (const path of PATHS) {
      for (let segment = 1; segment < path.points.length; segment += 1) {
        const from = path.points[segment - 1]!
        const to = path.points[segment]!
        const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z))
        let explorer = createExplorer(from)
        for (let step = 1; step <= steps; step += 1) {
          const point = { x: from.x + (to.x - from.x) * step / steps, z: from.z + (to.z - from.z) * step / steps }
          expect(canOccupy(explorer, point.x, point.z), `${path.id} blocked at ${point.x},${point.z}`).toBe(true)
          explorer = createExplorer(point)
        }
      }
    }
  })
})
