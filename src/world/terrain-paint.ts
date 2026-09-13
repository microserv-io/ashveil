import { getActiveZone } from './zone-active'
import type { CompiledZone, WorldPoint, ZoneBounds, ZonePath } from './zone-types'

export interface TerrainPaintWeights { readonly earth: number; readonly ash: number }

export interface TerrainPaintTextureData {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  readonly worldUnitsPerTexel: number
}

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

function pathEarthAt(x: number, z: number, paths: readonly ZonePath[]): number {
  let earth = 0
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]!
      const end = path.points[index]!
      earth = Math.max(earth, segmentEarthAt(x, z, path.width, start, end))
    }
  }
  return earth
}

export function paintWeightsAt(
  x: number,
  z: number,
  paths: readonly ZonePath[],
  zone: CompiledZone = getActiveZone(),
): TerrainPaintWeights {
  const center = zone.riverCenterAt(z)
  const halfWidth = zone.riverHalfWidthAt(z)
  const shoreDistance = Math.abs(Math.abs(x - center) - halfWidth)
  const bankEarth = 1 - smoothstep(1.4, 4.4, shoreDistance)
  const earth = Math.max(pathEarthAt(x, z, paths), bankEarth)
  const ash = smoothstep(center + halfWidth + 1, center + halfWidth + 11, x)
  return { earth, ash }
}

function segmentEarthAt(x: number, z: number, width: number, start: WorldPoint, end: WorldPoint): number {
  const edgeVariation = (Math.sin(x * 1.73 + z * 0.91) + Math.sin(x * 0.37 - z * 1.41)) * 0.09
  const distance = distanceToSegment({ x, z }, start, end)
  const radius = width * 0.5 + edgeVariation
  return 1 - smoothstep(radius - 0.9, radius + 0.9, distance)
}

export function terrainPaintTextureData(
  zone: CompiledZone,
  targetWorldUnitsPerTexel = 1,
  maximumDimension = 4_096,
  maximumPixels = 16_000_000,
): TerrainPaintTextureData {
  const spanX = zone.bounds.maxX - zone.bounds.minX
  const spanZ = zone.bounds.maxZ - zone.bounds.minZ
  const desiredWidth = Math.ceil(spanX / targetWorldUnitsPerTexel)
  const desiredHeight = Math.ceil(spanZ / targetWorldUnitsPerTexel)
  const dimensionScale = Math.min(1, maximumDimension / Math.max(desiredWidth, desiredHeight))
  const pixelScale = Math.min(1, Math.sqrt(maximumPixels / (desiredWidth * desiredHeight)))
  const scale = Math.min(dimensionScale, pixelScale)
  const width = Math.max(1, scale < 1 ? Math.floor(desiredWidth * scale) : desiredWidth)
  const height = Math.max(1, scale < 1 ? Math.floor(desiredHeight * scale) : desiredHeight)
  return {
    data: createTerrainPaintPixels(zone.paths, width, height, zone.bounds, zone),
    width,
    height,
    worldUnitsPerTexel: Math.max(spanX / width, spanZ / height),
  }
}

export function createTerrainPaintData(
  paths: readonly ZonePath[],
  resolution = 512,
  zone: CompiledZone = getActiveZone(),
): Uint8Array {
  return createTerrainPaintPixels(paths, resolution, resolution, zone.bounds, zone)
}

function createTerrainPaintPixels(
  paths: readonly ZonePath[],
  width: number,
  height: number,
  bounds: ZoneBounds,
  zone: CompiledZone,
): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  for (let row = 0; row < height; row += 1) {
    const z = bounds.minZ + (row + 0.5) / height * spanZ
    for (let column = 0; column < width; column += 1) {
      const x = bounds.minX + (column + 0.5) / width * spanX
      const center = zone.riverCenterAt(z)
      const halfWidth = zone.riverHalfWidthAt(z)
      const shoreDistance = Math.abs(Math.abs(x - center) - halfWidth)
      const offset = (row * width + column) * 4
      data[offset] = Math.round((1 - smoothstep(1.4, 4.4, shoreDistance)) * 255)
      data[offset + 1] = Math.round(smoothstep(center + halfWidth + 1, center + halfWidth + 11, x) * 255)
      data[offset + 2] = 0
      data[offset + 3] = 255
    }
  }
  for (const path of paths) for (let index = 1; index < path.points.length; index += 1) {
    const start = path.points[index - 1]!
    const end = path.points[index]!
    const margin = path.width * 0.5 + 1.1
    const minColumn = Math.max(0, Math.floor((Math.min(start.x, end.x) - margin - bounds.minX) / spanX * width))
    const maxColumn = Math.min(width - 1, Math.ceil((Math.max(start.x, end.x) + margin - bounds.minX) / spanX * width))
    const minRow = Math.max(0, Math.floor((Math.min(start.z, end.z) - margin - bounds.minZ) / spanZ * height))
    const maxRow = Math.min(height - 1, Math.ceil((Math.max(start.z, end.z) + margin - bounds.minZ) / spanZ * height))
    for (let row = minRow; row <= maxRow; row += 1) {
      const z = bounds.minZ + (row + 0.5) / height * spanZ
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = bounds.minX + (column + 0.5) / width * spanX
        const offset = (row * width + column) * 4
        data[offset] = Math.max(data[offset]!, Math.round(segmentEarthAt(x, z, path.width, start, end) * 255))
      }
    }
  }
  return data
}
