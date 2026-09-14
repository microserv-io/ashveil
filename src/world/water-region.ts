import type {
  TerrainGeometryData, WaterGeometryData, WaterSurfaceVertex, WorldPoint,
} from './zone-types'

const EPSILON = 1e-7

export interface WaterRegion {
  readonly geometry: WaterGeometryData
  overlapsCircle(x: number, z: number, radius: number): boolean
}

interface ClipPoint extends WaterSurfaceVertex {
  readonly sourceIndex: number
}

function pointInTriangle(point: WorldPoint, a: WorldPoint, b: WorldPoint, c: WorldPoint): boolean {
  const cross = (from: WorldPoint, to: WorldPoint): number =>
    (to.x - from.x) * (point.z - from.z) - (to.z - from.z) * (point.x - from.x)
  const ab = cross(a, b)
  const bc = cross(b, c)
  const ca = cross(c, a)
  return (ab >= -EPSILON && bc >= -EPSILON && ca >= -EPSILON)
    || (ab <= EPSILON && bc <= EPSILON && ca <= EPSILON)
}

function distanceToSegmentSquared(point: WorldPoint, from: WorldPoint, to: WorldPoint): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const lengthSquared = dx * dx + dz * dz
  const blend = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared,
  ))
  const x = from.x + dx * blend
  const z = from.z + dz * blend
  return (point.x - x) ** 2 + (point.z - z) ** 2
}

function triangleOverlapsCircle(
  vertices: readonly WaterSurfaceVertex[],
  indices: readonly number[],
  offset: number,
  point: WorldPoint,
  radius: number,
): boolean {
  const a = vertices[indices[offset]!]!
  const b = vertices[indices[offset + 1]!]!
  const c = vertices[indices[offset + 2]!]!
  if (pointInTriangle(point, a, b, c)) return true
  const radiusSquared = radius * radius + EPSILON * EPSILON
  return distanceToSegmentSquared(point, a, b) <= radiusSquared
    || distanceToSegmentSquared(point, b, c) <= radiusSquared
    || distanceToSegmentSquared(point, c, a) <= radiusSquared
}

export function compileWaterRegion(
  terrain: TerrainGeometryData,
  waterLevel: number,
  riverPoints: readonly WorldPoint[],
  authoredContains: (x: number, z: number) => boolean,
): WaterRegion {
  const triangleCount = terrain.indices.length / 3
  const wet = new Uint8Array(triangleCount)
  const selected = new Uint8Array(triangleCount)
  const queue = new Int32Array(triangleCount)
  let queueStart = 0
  let queueEnd = 0
  const depthAt = (index: number): number => waterLevel - terrain.vertices[index]!.y
  const enqueue = (triangle: number): void => {
    if (!wet[triangle] || selected[triangle]) return
    selected[triangle] = 1
    queue[queueEnd] = triangle
    queueEnd += 1
  }

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3
    const a = terrain.indices[offset]!
    const b = terrain.indices[offset + 1]!
    const c = terrain.indices[offset + 2]!
    if (Math.max(depthAt(a), depthAt(b), depthAt(c)) <= EPSILON) continue
    wet[triangle] = 1
    const av = terrain.vertices[a]!
    const bv = terrain.vertices[b]!
    const cv = terrain.vertices[c]!
    const centroid = { x: (av.x + bv.x + cv.x) / 3, z: (av.z + bv.z + cv.z) / 3 }
    if (authoredContains(av.x, av.z) || authoredContains(bv.x, bv.z)
      || authoredContains(cv.x, cv.z) || authoredContains(centroid.x, centroid.z)) enqueue(triangle)
  }

  const first = terrain.vertices[0]!
  const last = terrain.vertices.at(-1)!
  const rows = terrain.vertices.length / terrain.columns
  const cellSize = terrain.vertices[1]!.x - first.x
  const cellColumns = terrain.columns - 1
  const cellRows = rows - 1
  for (let segment = 1; segment < riverPoints.length; segment += 1) {
    const from = riverPoints[segment - 1]!
    const to = riverPoints[segment]!
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / (cellSize * 0.25)))
    for (let step = 0; step <= steps; step += 1) {
      const x = from.x + (to.x - from.x) * step / steps
      const z = from.z + (to.z - from.z) * step / steps
      if (x < first.x || x > last.x || z < first.z || z > last.z) continue
      const localX = Math.min(cellColumns - Number.EPSILON, Math.max(0, (x - first.x) / cellSize))
      const localZ = Math.min(cellRows - Number.EPSILON, Math.max(0, (z - first.z) / cellSize))
      const column = Math.min(cellColumns - 1, Math.floor(localX))
      const row = Math.min(cellRows - 1, Math.floor(localZ))
      const cell = row * cellColumns + column
      const tx = localX - column
      const tz = localZ - row
      const a = row * terrain.columns + column
      const b = a + 1
      const c = a + terrain.columns
      const d = c + 1
      if (tx + tz <= 1) {
        if (depthAt(a) * (1 - tx - tz) + depthAt(b) * tx + depthAt(c) * tz > EPSILON) enqueue(cell * 2)
      } else if (depthAt(d) * (tx + tz - 1) + depthAt(c) * (1 - tx) + depthAt(b) * (1 - tz) > EPSILON) {
        enqueue(cell * 2 + 1)
      }
    }
  }

  const sharedEdgeIsWet = (left: number, right: number): boolean =>
    depthAt(left) > EPSILON || depthAt(right) > EPSILON
  while (queueStart < queueEnd) {
    const triangle = queue[queueStart]!
    queueStart += 1
    const cell = Math.floor(triangle / 2)
    const row = Math.floor(cell / cellColumns)
    const column = cell % cellColumns
    const a = row * terrain.columns + column
    const b = a + 1
    const c = a + terrain.columns
    const d = c + 1
    if (triangle % 2 === 0) {
      if (sharedEdgeIsWet(b, c)) enqueue(triangle + 1)
      if (column > 0 && sharedEdgeIsWet(a, c)) enqueue((cell - 1) * 2 + 1)
      if (row > 0 && sharedEdgeIsWet(a, b)) enqueue((cell - cellColumns) * 2 + 1)
    } else {
      if (sharedEdgeIsWet(b, c)) enqueue(triangle - 1)
      if (column < cellColumns - 1 && sharedEdgeIsWet(b, d)) enqueue((cell + 1) * 2)
      if (row < cellRows - 1 && sharedEdgeIsWet(c, d)) enqueue((cell + cellColumns) * 2)
    }
  }

  const vertices: WaterSurfaceVertex[] = []
  const indices: number[] = []
  const originalVertices = new Int32Array(terrain.vertices.length)
  originalVertices.fill(-1)
  const crossedEdges = new Map<string, number>()
  const surfaceOffsets = new Int32Array(triangleCount)
  surfaceOffsets.fill(-1)
  const surfaceCounts = new Uint8Array(triangleCount)
  const originalPoint = (sourceIndex: number): ClipPoint => {
    const source = terrain.vertices[sourceIndex]!
    return { x: source.x, z: source.z, depth: depthAt(sourceIndex), sourceIndex }
  }
  const outputOriginal = (point: ClipPoint): number => {
    const existing = originalVertices[point.sourceIndex]!
    if (existing >= 0) return existing
    const output = vertices.length
    originalVertices[point.sourceIndex] = output
    vertices.push(Object.freeze({ x: point.x, z: point.z, depth: Math.max(0, point.depth) }))
    return output
  }
  const outputCrossing = (from: ClipPoint, to: ClipPoint): number => {
    const key = from.sourceIndex < to.sourceIndex
      ? `${from.sourceIndex}:${to.sourceIndex}`
      : `${to.sourceIndex}:${from.sourceIndex}`
    const existing = crossedEdges.get(key)
    if (existing !== undefined) return existing
    const blend = from.depth / (from.depth - to.depth)
    const output = vertices.length
    crossedEdges.set(key, output)
    vertices.push(Object.freeze({
      x: from.x + (to.x - from.x) * blend,
      z: from.z + (to.z - from.z) * blend,
      depth: 0,
    }))
    return output
  }

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (!selected[triangle]) continue
    const offset = triangle * 3
    const source = [
      originalPoint(terrain.indices[offset]!),
      originalPoint(terrain.indices[offset + 1]!),
      originalPoint(terrain.indices[offset + 2]!),
    ]
    const polygon: number[] = []
    for (let edge = 0; edge < 3; edge += 1) {
      const from = source[edge]!
      const to = source[(edge + 1) % 3]!
      const fromWet = from.depth >= -EPSILON
      const toWet = to.depth >= -EPSILON
      if (fromWet) polygon.push(outputOriginal(from))
      if (fromWet !== toWet) polygon.push(outputCrossing(from, to))
    }
    if (polygon.length < 3) continue
    surfaceOffsets[triangle] = indices.length
    for (let index = 1; index < polygon.length - 1; index += 1) indices.push(polygon[0]!, polygon[index]!, polygon[index + 1]!)
    surfaceCounts[triangle] = indices.length - surfaceOffsets[triangle]!
  }

  const geometry = Object.freeze({ vertices: Object.freeze(vertices), indices: Object.freeze(indices) })
  return Object.freeze({
    geometry,
    overlapsCircle: (x: number, z: number, radius: number): boolean => {
      radius = Math.max(0, radius)
      if (x + radius < first.x || x - radius > last.x || z + radius < first.z || z - radius > last.z) return false
      if (radius === 0) {
        const localX = Math.min(cellColumns - Number.EPSILON, Math.max(0, (x - first.x) / cellSize))
        const localZ = Math.min(cellRows - Number.EPSILON, Math.max(0, (z - first.z) / cellSize))
        const column = Math.min(cellColumns - 1, Math.floor(localX))
        const row = Math.min(cellRows - 1, Math.floor(localZ))
        const tx = localX - column
        const tz = localZ - row
        const cell = row * cellColumns + column
        const a = row * terrain.columns + column
        const b = a + 1
        const c = a + terrain.columns
        const onSharedBoundary = tx <= EPSILON || tz <= EPSILON
          || 1 - tx <= EPSILON || 1 - tz <= EPSILON || Math.abs(tx + tz - 1) <= EPSILON
        if (!onSharedBoundary && tx + tz < 1) {
          return selected[cell * 2] === 1
            && depthAt(a) * (1 - tx - tz) + depthAt(b) * tx + depthAt(c) * tz >= -EPSILON
        }
        if (!onSharedBoundary) {
          const d = c + 1
          return selected[cell * 2 + 1] === 1
            && depthAt(d) * (tx + tz - 1) + depthAt(c) * (1 - tx) + depthAt(b) * (1 - tz) >= -EPSILON
        }
        const point = { x, z }
        for (let candidateRow = Math.max(0, row - 1); candidateRow <= Math.min(cellRows - 1, row + 1); candidateRow += 1) {
          for (let candidateColumn = Math.max(0, column - 1); candidateColumn <= Math.min(cellColumns - 1, column + 1); candidateColumn += 1) {
            const firstTriangle = (candidateRow * cellColumns + candidateColumn) * 2
            for (let triangle = firstTriangle; triangle <= firstTriangle + 1; triangle += 1) {
              const offset = surfaceOffsets[triangle]!
              const count = surfaceCounts[triangle]!
              for (let local = 0; local < count; local += 3) {
                if (triangleOverlapsCircle(vertices, indices, offset + local, point, 0)) return true
              }
            }
          }
        }
        return false
      }
      const point = { x, z }
      const minColumn = Math.max(0, Math.min(cellColumns - 1, Math.floor((x - radius - first.x) / cellSize)))
      const maxColumn = Math.max(0, Math.min(cellColumns - 1, Math.floor((x + radius - first.x) / cellSize)))
      const minRow = Math.max(0, Math.min(cellRows - 1, Math.floor((z - radius - first.z) / cellSize)))
      const maxRow = Math.max(0, Math.min(cellRows - 1, Math.floor((z + radius - first.z) / cellSize)))
      for (let row = minRow; row <= maxRow; row += 1) for (let column = minColumn; column <= maxColumn; column += 1) {
        const firstTriangle = (row * cellColumns + column) * 2
        for (let triangle = firstTriangle; triangle <= firstTriangle + 1; triangle += 1) {
          const offset = surfaceOffsets[triangle]!
          const count = surfaceCounts[triangle]!
          for (let local = 0; local < count; local += 3) {
            if (triangleOverlapsCircle(vertices, indices, offset + local, point, radius)) return true
          }
        }
      }
      return false
    },
  })
}
