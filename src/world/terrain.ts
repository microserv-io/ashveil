export const WORLD_BOUNDS = {
  minX: -110,
  maxX: 110,
  minZ: -90,
  maxZ: 90,
} as const

export const TERRAIN_CELL_SIZE = 5

export interface TerrainVertex {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface WeightedTerrainVertex extends TerrainVertex {
  readonly weight: number
}

export interface TerrainGeometryData {
  readonly vertices: readonly TerrainVertex[]
  readonly indices: readonly number[]
  readonly colors: readonly [number, number, number][]
  readonly columns: number
}

const columns = (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / TERRAIN_CELL_SIZE + 1
const rows = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / TERRAIN_CELL_SIZE + 1

export function riverCenterAt(z: number): number {
  return 21 + Math.sin(z * 0.043) * 5 + Math.sin(z * 0.095) * 1.7
}

export function riverHalfWidthAt(z: number): number {
  return 6.5 + (Math.sin(z * 0.061 + 1.4) + 1) * 0.9
}

function authoredHeight(x: number, z: number): number {
  const riverDistance = Math.abs(x - riverCenterAt(z))
  const bank = Math.min(1, Math.max(0, (riverDistance - riverHalfWidthAt(z)) / 12))
  const broadSlope = 3.1 + (-x - 10) * 0.018 + (z + 20) * 0.006
  const hills = Math.sin((x + 31) * 0.052) * 1.15 + Math.cos((z - 8) * 0.047) * 0.85
  const terrace = Math.sin((x + z) * 0.021) * 0.55
  const dryGround = broadSlope + hills + terrace
  return -1.3 + bank * (dryGround + 1.3)
}

function gridVertex(column: number, row: number): TerrainVertex {
  const x = WORLD_BOUNDS.minX + column * TERRAIN_CELL_SIZE
  const z = WORLD_BOUNDS.minZ + row * TERRAIN_CELL_SIZE
  return { x, y: authoredHeight(x, z), z }
}

export function terrainVertices(): readonly TerrainVertex[] {
  const result: TerrainVertex[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) result.push(gridVertex(column, row))
  }
  return result
}

export function terrainTriangleAt(x: number, z: number): readonly WeightedTerrainVertex[] {
  const localX = Math.min(columns - 1 - Number.EPSILON, Math.max(0, (x - WORLD_BOUNDS.minX) / TERRAIN_CELL_SIZE))
  const localZ = Math.min(rows - 1 - Number.EPSILON, Math.max(0, (z - WORLD_BOUNDS.minZ) / TERRAIN_CELL_SIZE))
  const column = Math.min(columns - 2, Math.floor(localX))
  const row = Math.min(rows - 2, Math.floor(localZ))
  const tx = localX - column
  const tz = localZ - row
  if (tx + tz <= 1) {
    return [
      { ...gridVertex(column, row), weight: 1 - tx - tz },
      { ...gridVertex(column + 1, row), weight: tx },
      { ...gridVertex(column, row + 1), weight: tz },
    ]
  }
  return [
    { ...gridVertex(column + 1, row + 1), weight: tx + tz - 1 },
    { ...gridVertex(column, row + 1), weight: 1 - tx },
    { ...gridVertex(column + 1, row), weight: 1 - tz },
  ]
}

export function heightAt(x: number, z: number): number {
  return terrainTriangleAt(x, z).reduce((height, vertex) => height + vertex.y * vertex.weight, 0)
}

function terrainColor(vertex: TerrainVertex): [number, number, number] {
  const distance = Math.abs(vertex.x - riverCenterAt(vertex.z))
  if (distance < riverHalfWidthAt(vertex.z) + 2) return [0.58, 0.7, 0.62]
  if (vertex.x > riverCenterAt(vertex.z)) return [0.48, 0.48, 0.46]
  if (vertex.y > 5.2) return [0.75, 0.71, 0.59]
  return [0.67, 0.84, 0.59]
}

export function createTerrainGeometryData(): TerrainGeometryData {
  const vertices = terrainVertices()
  const indices: number[] = []
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices.push(a, c, b, d, b, c)
    }
  }
  return { vertices, indices, colors: vertices.map(terrainColor), columns }
}
