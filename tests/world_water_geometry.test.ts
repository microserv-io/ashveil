import { describe, expect, it } from 'vitest'
import { DEFAULT_ZONE } from '../src/world/zone-default'
import { compileZone } from '../src/world/zone-compiler'
import { compileWaterRegion } from '../src/world/water-region'
import type { TerrainGeometryData } from '../src/world/zone-types'

function gridTerrain(
  columns: number,
  rows: number,
  cellSize: number,
  heightAt: (x: number, z: number) => number,
): TerrainGeometryData {
  const vertices = Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns * cellSize
    const z = Math.floor(index / columns) * cellSize
    return { x, y: heightAt(x, z), z }
  })
  const indices: number[] = []
  for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
    const a = row * columns + column
    const b = a + 1
    const c = a + columns
    const d = c + 1
    indices.push(a, c, b, d, b, c)
  }
  return {
    vertices,
    indices,
    colors: [],
    stoneWeights: [],
    columns,
  }
}

describe('compiled water region', () => {
  it('fills the default channel through the rendered terrain waterline without bank gaps', () => {
    const zone = compileZone(DEFAULT_ZONE)
    const waterLevel = zone.definition.river.waterLevel
    let firstGap: string | undefined
    for (let z = zone.bounds.minZ; z <= zone.bounds.maxZ; z += zone.cellSize * 0.5) {
      const center = zone.riverCenterAt(z)
      for (const side of [-1, 1]) {
        for (let distance = 0; distance <= zone.riverHalfWidthAt(z) + zone.cellSize * 2; distance += 0.25) {
          const x = center + side * distance
          if (zone.heightAt(x, z) > waterLevel) break
          if (!zone.isWaterAt(x, z) && firstGap === undefined) firstGap = `${x},${z}`
        }
      }
    }
    expect(firstGap).toBeUndefined()
    expect(zone.isWaterAt(814, -411.1)).toBe(true)
    expect(zone.waterLevelAt(814, -411.1)).toBe(waterLevel)
    expect(zone.canOccupyPoint(814, -411.1, 0)).toBe(false)
    expect(zone.isWaterAt(817, -411.1)).toBe(false)
    expect(zone.waterLevelAt(817, -411.1)).toBeUndefined()
    expect(zone.isWaterAt(816.3, -411.1, 0.1)).toBe(false)
    expect(zone.isWaterAt(816.3, -411.1, 0.2)).toBe(true)

    let maximumDepthError = 0
    let maximumShoreHeightError = 0
    let shoreVertices = 0
    for (const vertex of zone.waterGeometry().vertices) {
      const terrainDepth = Math.max(0, waterLevel - zone.heightAt(vertex.x, vertex.z))
      maximumDepthError = Math.max(maximumDepthError, Math.abs(vertex.depth - terrainDepth))
      if (vertex.depth === 0) {
        shoreVertices += 1
        maximumShoreHeightError = Math.max(maximumShoreHeightError,
          Math.abs(zone.heightAt(vertex.x, vertex.z) - waterLevel))
      }
    }
    expect(shoreVertices).toBeGreaterThan(0)
    expect(maximumDepthError).toBeLessThan(1e-8)
    expect(maximumShoreHeightError).toBeLessThan(1e-8)
  })

  it('follows a kinked channel on a large grid and anchors its clipped shore at zero depth', () => {
    const cellSize = 25
    const centerAt = (z: number): number => z <= 50 ? 25 + z : 125 - z
    const terrain = gridTerrain(5, 5, cellSize, (x, z) => Math.abs(x - centerAt(z)) - 40)
    const river = [{ x: 25, z: 0 }, { x: 75, z: 50 }, { x: 25, z: 100 }]
    const region = compileWaterRegion(terrain, 0, river, (x, z) => Math.abs(x - centerAt(z)) <= 4)
    for (let z = 0; z <= 100; z += 2.5) expect(region.overlapsCircle(centerAt(z), z, 0), `${z}`).toBe(true)
    expect(region.geometry.vertices.some((vertex) => vertex.depth === 0)).toBe(true)
    expect(region.geometry.vertices.every((vertex) => Number.isFinite(vertex.x)
      && Number.isFinite(vertex.z) && vertex.depth >= 0)).toBe(true)
    expect(region.geometry.indices.every((index) => index >= 0 && index < region.geometry.vertices.length)).toBe(true)
  })

  it('excludes disconnected low basins while flooding low ground connected to the river', () => {
    const terrain = gridTerrain(7, 3, 10, (x) => {
      if (x <= 10 || x >= 50) return -2
      if (x === 30) return -3
      return 2
    })
    const river = [{ x: 30, z: 0 }, { x: 30, z: 20 }]
    const region = compileWaterRegion(terrain, 0, river, (x) => Math.abs(x - 30) <= 4)
    expect(region.overlapsCircle(30, 10, 0)).toBe(true)
    expect(region.overlapsCircle(5, 10, 0)).toBe(false)
    expect(region.overlapsCircle(55, 10, 0)).toBe(false)
  })

  it('does not seed a wet triangle when the river centerline crosses only its dry portion', () => {
    const terrain = gridTerrain(2, 2, 10, (x, z) => x === 0 && z === 10 ? -2 : 2)
    const region = compileWaterRegion(terrain, 0, [{ x: 9, z: 0 }, { x: 9, z: 10 }],
      (x) => Math.abs(x - 9) < 0.1)
    expect(region.geometry.vertices).toHaveLength(0)
    expect(region.overlapsCircle(1, 9, 0)).toBe(false)
  })

  it('uses exact circle-to-water-polygon distance for radius occupancy', () => {
    const terrain = gridTerrain(3, 2, 10, (x) => x - 5)
    const river = [{ x: 0, z: 0 }, { x: 0, z: 10 }]
    const region = compileWaterRegion(terrain, 0, river, (x) => x <= 4)
    expect(region.overlapsCircle(5.5, 5, 0)).toBe(false)
    expect(region.overlapsCircle(5.5, 5, 0.49)).toBe(false)
    expect(region.overlapsCircle(5.5, 5, 0.5)).toBe(true)
  })

  it('treats selected triangle diagonals as closed water boundaries', () => {
    const terrain: TerrainGeometryData = {
      columns: 2,
      vertices: [
        { x: 0, y: 1, z: 0 }, { x: 10, y: 0, z: 0 },
        { x: 0, y: 0, z: 10 }, { x: 10, y: -1, z: 10 },
      ],
      indices: [0, 2, 1, 3, 1, 2],
      colors: [],
      stoneWeights: [],
    }
    const region = compileWaterRegion(terrain, 0, [{ x: 10, z: 10 }, { x: 9, z: 9 }],
      (x, z) => x > 8 && z > 8)
    expect(region.overlapsCircle(5, 5, 0)).toBe(true)
    expect(region.overlapsCircle(5.01, 5.01, 0)).toBe(true)
    expect(region.overlapsCircle(4.99, 4.99, 0)).toBe(false)
  })

  it('treats selected cell edges as closed water boundaries', () => {
    const terrain = gridTerrain(3, 2, 10, (x) => x / 10 - 1)
    const region = compileWaterRegion(terrain, 0, [{ x: 0, z: 0 }, { x: 0, z: 10 }], (x) => x < 9)
    expect(region.overlapsCircle(10, 5, 0)).toBe(true)
    expect(region.overlapsCircle(9.99, 5, 0)).toBe(true)
    expect(region.overlapsCircle(10.01, 5, 0)).toBe(false)
  })

  it('compiles deterministic immutable surface arrays', () => {
    const first = compileZone(DEFAULT_ZONE).waterGeometry()
    const second = compileZone(structuredClone(DEFAULT_ZONE)).waterGeometry()
    expect(first).toEqual(second)
    expect(Object.isFrozen(first.vertices)).toBe(true)
    expect(Object.isFrozen(first.indices)).toBe(true)
  })

  it('keeps a broad near-limit flood bounded by unique terrain vertices', () => {
    const columns = 500
    const rows = 500
    const terrain = gridTerrain(columns, rows, 5, () => -1)
    const region = compileWaterRegion(terrain, 0, [{ x: 1_250, z: 0 }, { x: 1_250, z: 2_495 }],
      (x) => Math.abs(x - 1_250) < 4)
    expect(terrain.vertices).toHaveLength(250_000)
    expect(region.geometry.vertices).toHaveLength(terrain.vertices.length)
    expect(region.geometry.indices).toHaveLength(terrain.indices.length)
  })
})
