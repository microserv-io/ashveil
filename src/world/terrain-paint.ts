import { riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from './terrain'
import type { WorldPath, WorldPoint } from './world-data'

export interface TerrainPaintWeights { readonly earth: number; readonly ash: number }

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

function distanceToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.z - start.z)
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t))
}

function pathEarthAt(x: number, z: number, paths: readonly WorldPath[]): number {
  let earth = 0
  const edgeVariation = (Math.sin(x * 1.73 + z * 0.91) + Math.sin(x * 0.37 - z * 1.41)) * 0.09
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]!
      const end = path.points[index]!
      const distance = distanceToSegment({ x, z }, start, end)
      const radius = path.width * 0.5 + edgeVariation
      earth = Math.max(earth, 1 - smoothstep(radius - 0.9, radius + 0.9, distance))
    }
  }
  return earth
}

export function paintWeightsAt(x: number, z: number, paths: readonly WorldPath[]): TerrainPaintWeights {
  const center = riverCenterAt(z)
  const halfWidth = riverHalfWidthAt(z)
  const shoreDistance = Math.abs(Math.abs(x - center) - halfWidth)
  const bankEarth = 1 - smoothstep(1.4, 4.4, shoreDistance)
  const earth = Math.max(pathEarthAt(x, z, paths), bankEarth)
  const ash = smoothstep(center + halfWidth + 1, center + halfWidth + 11, x)
  return { earth, ash }
}

export function createTerrainPaintData(paths: readonly WorldPath[], resolution = 512): Uint8Array {
  const data = new Uint8Array(resolution * resolution * 4)
  for (let row = 0; row < resolution; row += 1) {
    const z = WORLD_BOUNDS.minZ + (row + 0.5) / resolution * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)
    for (let column = 0; column < resolution; column += 1) {
      const x = WORLD_BOUNDS.minX + (column + 0.5) / resolution * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)
      const weights = paintWeightsAt(x, z, paths)
      const offset = (row * resolution + column) * 4
      data[offset] = Math.round(weights.earth * 255)
      data[offset + 1] = Math.round(weights.ash * 255)
      data[offset + 2] = 0
      data[offset + 3] = 255
    }
  }
  return data
}
