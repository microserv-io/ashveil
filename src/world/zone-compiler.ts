import type {
  CompiledZone, TerrainGeometryData, TerrainStroke, TerrainVertex, WeightedTerrainVertex,
  WorldPoint, ZoneDefinition, ZonePath, ZoneRiverPoint, ZoneRidge,
} from './zone-types'
import { projectZoneSolids } from './zone-placements'
import { CompiledLandforms } from './zone-landforms'

const MAX_JSON_BYTES = 512 * 1024
const MAX_GRID_VERTICES = 300_000
const RUN_SPEED = 5
const EPSILON = 1e-7

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function id(value: unknown): value is string { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) }

function validPoint(value: unknown): value is WorldPoint {
  const item = record(value)
  return item !== undefined && finite(item.x) && finite(item.z)
}

function utf8Length(value: string): number {
  let bytes = 0
  for (const character of value) {
    const code = character.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

export function validateZoneDefinition(value: unknown): string[] {
  const errors: string[] = []
  const zone = record(value)
  if (!zone) return ['definition must be an object']
  if (zone.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (!id(zone.id)) errors.push('id must be a lowercase stable ID')

  const bounds = record(zone.bounds)
  if (!bounds || !finite(bounds.minX) || !finite(bounds.maxX) || !finite(bounds.minZ) || !finite(bounds.maxZ)
    || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ
    || bounds.maxX - bounds.minX > 5_000 || bounds.maxZ - bounds.minZ > 5_000) {
    errors.push('bounds must be finite positive spans no larger than 5000')
  }
  const pointInBounds = (point: WorldPoint, margin = 0): boolean => Boolean(bounds
    && finite(bounds.minX) && finite(bounds.maxX) && finite(bounds.minZ) && finite(bounds.maxZ)
    && point.x >= bounds.minX - margin && point.x <= bounds.maxX + margin
    && point.z >= bounds.minZ - margin && point.z <= bounds.maxZ + margin)
  if (!finite(zone.cellSize) || zone.cellSize < 4 || zone.cellSize > 25) errors.push('cellSize must be between 4 and 25')
  if (bounds && finite(bounds.minX) && finite(bounds.maxX) && finite(bounds.minZ) && finite(bounds.maxZ) && finite(zone.cellSize) && zone.cellSize > 0) {
    const xCells = (bounds.maxX - bounds.minX) / zone.cellSize
    const zCells = (bounds.maxZ - bounds.minZ) / zone.cellSize
    if (Math.abs(xCells - Math.round(xCells)) > EPSILON || Math.abs(zCells - Math.round(zCells)) > EPSILON) {
      errors.push('bounds spans must contain exact whole cells')
    } else if ((Math.round(xCells) + 1) * (Math.round(zCells) + 1) > MAX_GRID_VERTICES) {
      errors.push('terrain grid exceeds 300000 vertices')
    }
  }

  const rawLandmarks = Array.isArray(zone.landmarks) ? zone.landmarks : []
  const landmarks = rawLandmarks.slice(0, 64)
  if (!Array.isArray(zone.landmarks) || rawLandmarks.length === 0 || rawLandmarks.length > 64) errors.push('landmarks must contain 1 to 64 entries')
  const landmarkIds = new Set<string>()
  for (const candidate of landmarks) {
    const item = record(candidate)
    if (!item || !id(item.id) || typeof item.label !== 'string' || item.label.length === 0 || item.label.length > 100
      || !validPoint(item) || !finite(item.radius) || item.radius <= 0 || item.radius > 150) {
      errors.push('landmark is malformed')
      continue
    }
    if (!pointInBounds(item)) errors.push(`landmark ${item.id} lies outside bounds`)
    if (landmarkIds.has(item.id)) errors.push(`duplicate landmark ID ${item.id}`)
    landmarkIds.add(item.id)
  }

  const rawPaths = Array.isArray(zone.paths) ? zone.paths : []
  const paths = rawPaths.slice(0, 32)
  if (!Array.isArray(zone.paths) || rawPaths.length === 0 || rawPaths.length > 32) errors.push('paths must contain 1 to 32 entries')
  let pathPointCount = 0
  const pathIds = new Set<string>()
  for (const candidate of paths) {
    const item = record(candidate)
    const rawPoints = item && Array.isArray(item.points) ? item.points : []
    const points = rawPoints.slice(0, 257)
    if (rawPoints.length > 256) errors.push('paths exceed 256 total points')
    pathPointCount += points.length
    if (!item || !id(item.id) || !id(item.from) || !id(item.to) || !finite(item.width) || item.width < 2 || item.width > 100
      || points.length < 2 || points.some((point) => !validPoint(point))) {
      errors.push('path is malformed')
      continue
    }
    if (!landmarkIds.has(item.from) || !landmarkIds.has(item.to)) errors.push(`path ${item.id} references unknown landmark`)
    const fromLandmark = landmarks.find((landmark) => record(landmark)?.id === item.from)
    const toLandmark = landmarks.find((landmark) => record(landmark)?.id === item.to)
    if (fromLandmark && validPoint(fromLandmark) && validPoint(points[0])
      && Math.hypot(points[0].x - fromLandmark.x, points[0].z - fromLandmark.z) > 0.001) {
      errors.push(`path ${item.id} first point does not match from landmark`)
    }
    if (toLandmark && validPoint(toLandmark) && validPoint(points.at(-1))
      && Math.hypot(points.at(-1).x - toLandmark.x, points.at(-1).z - toLandmark.z) > 0.001) {
      errors.push(`path ${item.id} last point does not match to landmark`)
    }
    if (points.some((point) => validPoint(point) && !pointInBounds(point))) errors.push(`path ${item.id} lies outside bounds`)
    if (pathIds.has(item.id)) errors.push(`duplicate path ID ${item.id}`)
    pathIds.add(item.id)
  }
  if (pathPointCount > 256) errors.push('paths exceed 256 total points')

  const rawRidges = Array.isArray(zone.ridges) ? zone.ridges : []
  const ridges = rawRidges.slice(0, 16)
  if (!Array.isArray(zone.ridges) || rawRidges.length > 16) errors.push('ridges must contain at most 16 entries')
  let ridgePointCount = 0
  const ridgeIds = new Set<string>()
  for (const candidate of ridges) {
    const item = record(candidate)
    const rawPoints = item && Array.isArray(item.points) ? item.points : []
    const points = rawPoints.slice(0, 257)
    if (rawPoints.length > 256) errors.push('ridges exceed 256 total points')
    ridgePointCount += points.length
    if (!item || !id(item.id) || !finite(item.halfWidth) || item.halfWidth < 10 || item.halfWidth > 400
      || !finite(item.height) || item.height <= 0 || item.height > 500 || points.length < 2 || points.some((point) => !validPoint(point))) {
      errors.push('ridge is malformed')
    }
    if (item && id(item.id)) {
      if (ridgeIds.has(item.id)) errors.push(`duplicate ridge ID ${item.id}`)
      ridgeIds.add(item.id)
    }
    if (item && points.some((point) => validPoint(point) && !pointInBounds(point))) errors.push(`ridge ${String(item.id)} lies outside bounds`)
  }
  if (ridgePointCount > 256) errors.push('ridges exceed 256 total points')

  const river = record(zone.river)
  const rawRiverPoints = river && Array.isArray(river.points) ? river.points : []
  const riverPoints = rawRiverPoints.slice(0, 129)
  if (!river || !finite(river.waterLevel) || river.waterLevel < -100 || river.waterLevel > 500
    || rawRiverPoints.length < 2 || rawRiverPoints.length > 128) errors.push('river is malformed')
  let priorZ = -Infinity
  for (const candidate of riverPoints) {
    const item = record(candidate)
    if (!item || !validPoint(item) || !finite(item.halfWidth) || item.halfWidth < 4 || item.halfWidth > 300
      || !finite(item.depth) || item.depth <= 0 || item.depth > 100) {
      errors.push('river point is malformed')
      continue
    }
    if (item.z <= priorZ) errors.push('river points must be strictly ordered by distinct z')
    if (!pointInBounds(item, finite(zone.cellSize) ? zone.cellSize * 3 : 0)) errors.push('river point lies outside bounds allowance')
    priorZ = item.z
  }

  const terrain = record(zone.terrain)
  const rawStrokes = terrain && Array.isArray(terrain.strokes) ? terrain.strokes : []
  const strokes = rawStrokes.slice(0, 128)
  if (!terrain || !finite(terrain.baseHeight) || terrain.baseHeight < -100 || terrain.baseHeight > 500
    || !Array.isArray(terrain.strokes) || rawStrokes.length > 128) errors.push('terrain is malformed')
  const strokeIds = new Set<string>()
  for (const candidate of strokes) {
    const item = record(candidate)
    if (!item || !id(item.id) || !validPoint(item) || !['raise', 'lower', 'smooth'].includes(String(item.mode))
      || !finite(item.radius) || item.radius < 3 || item.radius > 150 || !finite(item.amount) || item.amount <= 0 || item.amount > 100) {
      errors.push('terrain stroke is malformed')
    }
    if (item && id(item.id)) {
      if (strokeIds.has(item.id)) errors.push(`duplicate terrain stroke ID ${item.id}`)
      strokeIds.add(item.id)
    }
    if (item && validPoint(item) && !pointInBounds(item)) errors.push(`terrain stroke ${String(item.id)} lies outside bounds`)
  }

  const rawLandforms = terrain && Array.isArray(terrain.landforms) ? terrain.landforms : []
  const landforms = rawLandforms.slice(0, 16)
  if (terrain && terrain.landforms !== undefined && !Array.isArray(terrain.landforms)) errors.push('terrain landforms must be an array')
  if (rawLandforms.length > 16) errors.push('terrain landforms must contain at most 16 entries')
  let landformPointCount = 0
  const landformIds = new Set<string>()
  for (const candidate of landforms) {
    const item = record(candidate)
    const rawPoints = item && Array.isArray(item.points) ? item.points : []
    const points = rawPoints.slice(0, 129)
    const halfWidth = item && finite(item.halfWidth) ? item.halfWidth : NaN
    const height = item && finite(item.height) ? item.height : NaN
    landformPointCount += points.length
    if (rawPoints.length > 128) errors.push('terrain landforms exceed 128 total points')
    const commonMalformed = !item || !id(item.id) || !['hill', 'barrier'].includes(String(item.kind))
      || points.length < 2 || points.some((point) => !validPoint(point))
      || !Number.isFinite(halfWidth) || !Number.isFinite(height)
    if (commonMalformed) errors.push('terrain landform is malformed')
    else if (item.kind === 'hill'
      && (height <= 0 || height > 40 || halfWidth < 20 || halfWidth > 200 || halfWidth < height * 2.5)) {
      errors.push(`hill landform ${item.id} must be broad and walkable`)
    } else if (item.kind === 'barrier'
      && (height < 12 || height > 80 || halfWidth < (finite(zone.cellSize) ? zone.cellSize * 5 : 20)
        || halfWidth > 100 || height / halfWidth < 0.55)) {
      errors.push(`barrier landform ${item.id} must have a visible multi-cell rock core`)
    }
    if (item && id(item.id)) {
      if (landformIds.has(item.id) || ridgeIds.has(item.id) || strokeIds.has(item.id)) errors.push(`duplicate terrain feature ID ${item.id}`)
      landformIds.add(item.id)
    }
    if (item && points.some((point) => validPoint(point) && !pointInBounds(point))) {
      errors.push(`terrain landform ${String(item.id)} lies outside bounds`)
    }
  }
  if (landformPointCount > 128) errors.push('terrain landforms exceed 128 total points')

  const spawn = record(zone.spawn)
  if (!spawn || !id(spawn.landmarkId) || !landmarkIds.has(spawn.landmarkId) || !validPoint(spawn.offset)) {
    errors.push('spawn must reference a known landmark with a finite offset')
  }
  const rawMainRoute = Array.isArray(zone.mainRoute) ? zone.mainRoute : []
  const mainRoute = rawMainRoute.slice(0, 32)
  if (rawMainRoute.length > 32) errors.push('mainRoute must contain at most 32 paths')
  if (!Array.isArray(zone.mainRoute) || mainRoute.length === 0 || mainRoute.some((pathId) => typeof pathId !== 'string' || !pathIds.has(pathId))) {
    errors.push('mainRoute must reference known paths')
  }
  if (new Set(mainRoute).size !== mainRoute.length) errors.push('mainRoute path IDs must be distinct')
  for (let index = 1; index < mainRoute.length; index += 1) {
    const previous = paths.find((path) => record(path)?.id === mainRoute[index - 1]) as Record<string, unknown> | undefined
    const current = paths.find((path) => record(path)?.id === mainRoute[index]) as Record<string, unknown> | undefined
    if (previous && current && previous.to !== current.from) errors.push('mainRoute paths must connect in order')
  }
  return [...new Set(errors)]
}

export function parseZoneDefinitionJson(text: string): ZoneDefinition {
  if (utf8Length(text) > MAX_JSON_BYTES) throw new Error('Zone definition exceeds 512 KiB')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Zone definition is not valid JSON') }
  const errors = validateZoneDefinition(value)
  if (errors.length) throw new Error(`Invalid zone definition: ${errors.join('; ')}`)
  return value as ZoneDefinition
}

function distanceToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): { distance: number; t: number } {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
  return { distance: Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t)), t }
}

function distanceToPolyline(point: WorldPoint, points: readonly WorldPoint[]): number {
  let distance = Infinity
  for (let index = 1; index < points.length; index += 1) distance = Math.min(distance, distanceToSegment(point, points[index - 1]!, points[index]!).distance)
  return distance
}

function interpolateRiver(points: readonly ZoneRiverPoint[], z: number): ZoneRiverPoint {
  if (z <= points[0]!.z) return points[0]!
  if (z >= points.at(-1)!.z) return points.at(-1)!
  let high = 1
  while (points[high]!.z < z) high += 1
  const low = points[high - 1]!
  const next = points[high]!
  const t = (z - low.z) / (next.z - low.z)
  return {
    x: low.x + (next.x - low.x) * t,
    z,
    halfWidth: low.halfWidth + (next.halfWidth - low.halfWidth) * t,
    depth: low.depth + (next.depth - low.depth) * t,
  }
}

function pathLength(path: ZonePath): number {
  let length = 0
  for (let index = 1; index < path.points.length; index += 1) {
    const from = path.points[index - 1]!
    const to = path.points[index]!
    length += Math.hypot(to.x - from.x, to.z - from.z)
  }
  return length
}

function strokeHeight(stroke: TerrainStroke, x: number, z: number): number {
  const distance = Math.hypot(x - stroke.x, z - stroke.z)
  if (distance >= stroke.radius) return 0
  const weight = (1 + Math.cos(Math.PI * distance / stroke.radius)) * 0.5
  if (stroke.mode === 'smooth') return 0
  return (stroke.mode === 'lower' ? -1 : 1) * stroke.amount * weight
}

function ridgeHeight(ridge: ZoneRidge, x: number, z: number): number {
  let distance = Infinity
  let along = 0
  let traversed = 0
  for (let index = 1; index < ridge.points.length; index += 1) {
    const start = ridge.points[index - 1]!
    const end = ridge.points[index]!
    const segmentLength = Math.hypot(end.x - start.x, end.z - start.z)
    const nearest = distanceToSegment({ x, z }, start, end)
    if (nearest.distance < distance) {
      distance = nearest.distance
      along = traversed + segmentLength * nearest.t
    }
    traversed += segmentLength
  }
  const phase = ridge.id.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0) * 0.01
  const foothillWidth = ridge.halfWidth * 1.8 * (0.88 + 0.12 * Math.sin(along * 0.019 + phase))
  if (distance >= foothillWidth) return 0
  const weight = Math.max(0, 1 - distance / foothillWidth)
  const peak = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(along * 0.024 + phase))
  const brokenFace = 0.92 + 0.08 * Math.sin(x * 0.031 - z * 0.023 + phase)
  return ridge.height * peak * brokenFace * weight ** 1.7
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function compileZone(source: ZoneDefinition): CompiledZone {
  const errors = validateZoneDefinition(source)
  if (errors.length) throw new Error(`Invalid zone definition: ${errors.join('; ')}`)
  const serialized = JSON.stringify(source)
  if (utf8Length(serialized) > MAX_JSON_BYTES) throw new Error('Zone definition exceeds 512 KiB')
  const definition = deepFreeze(JSON.parse(serialized) as ZoneDefinition)
  const { bounds, cellSize } = definition
  const columns = Math.round((bounds.maxX - bounds.minX) / cellSize) + 1
  const rows = Math.round((bounds.maxZ - bounds.minZ) / cellSize) + 1
  const riverAt = (z: number): ZoneRiverPoint => interpolateRiver(definition.river.points, z)
  const landforms = new CompiledLandforms(definition.terrain.landforms ?? [])

  function dryHeight(x: number, z: number): number {
    const river = riverAt(z)
    const riverDistance = Math.abs(x - river.x)
    let height = definition.terrain.baseHeight + Math.sin(x * 0.004) * 7 + Math.cos(z * 0.005) * 5
      + Math.sin((x + z) * 0.007) * 2.5
    const shore = Math.min(1, (riverDistance - river.halfWidth) / 30)
    height = definition.river.waterLevel + 0.35 + shore * (height - definition.river.waterLevel - 0.35)
    return height
  }

  function hillFoundation(x: number, z: number): number {
    return dryHeight(x, z) + landforms.sample(x, z).hillHeight
  }

  function generatedHeight(x: number, z: number): number {
    const river = riverAt(z)
    const riverDistance = Math.abs(x - river.x)
    if (riverDistance <= river.halfWidth) {
      const channel = 1 - Math.min(1, riverDistance / river.halfWidth)
      return definition.river.waterLevel - river.depth * (0.35 + channel * 0.65)
    }
    const landform = landforms.sample(x, z)
    let height = dryHeight(x, z) + landform.hillHeight + landform.barrierHeight
    for (const ridge of definition.ridges) height += ridgeHeight(ridge, x, z)
    if (!definition.ridges.some((ridge) => distanceToPolyline({ x, z }, ridge.points) <= ridge.halfWidth * 1.8)
      && !landforms.overlapsBarrierFootprint({ x, z }, 0)) {
      let gradeBlend = 0
      let gradeHeight = height
      for (const path of definition.paths) {
        for (let index = 1; index < path.points.length; index += 1) {
          const start = path.points[index - 1]!
          const end = path.points[index]!
          const nearest = distanceToSegment({ x, z }, start, end)
          const gradeRadius = path.width * 0.5 + cellSize * 1.5
          if (nearest.distance >= gradeRadius) continue
          const roadX = start.x + (end.x - start.x) * nearest.t
          const roadZ = start.z + (end.z - start.z) * nearest.t
          const blend = (1 + Math.cos(Math.PI * nearest.distance / gradeRadius)) * 0.5
          if (blend > gradeBlend) {
            gradeBlend = blend
            gradeHeight = hillFoundation(roadX, roadZ)
          }
        }
      }
      for (const landmark of definition.landmarks) {
        const distance = Math.hypot(x - landmark.x, z - landmark.z)
        const padRadius = landmark.radius + cellSize
        if (distance >= padRadius) continue
        const blend = (1 + Math.cos(Math.PI * distance / padRadius)) * 0.5
        if (blend > gradeBlend) {
          gradeBlend = blend
          gradeHeight = hillFoundation(landmark.x, landmark.z)
        }
      }
      height += (gradeHeight - height) * gradeBlend
    }
    return Math.max(-100, Math.min(500, height))
  }

  const heightValues: number[] = []
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = bounds.minX + column * cellSize
    const z = bounds.minZ + row * cellSize
    heightValues.push(generatedHeight(x, z))
  }
  for (const stroke of definition.terrain.strokes) {
    const riverSamples = Math.max(1, Math.ceil(stroke.radius * 2 / cellSize))
    const overlapsRiver = Array.from({ length: riverSamples + 1 }, (_, index) => {
      const z = stroke.z - stroke.radius + stroke.radius * 2 * index / riverSamples
      const river = riverAt(z)
      const vertical = z - stroke.z
      const horizontalRadius = Math.sqrt(Math.max(0, stroke.radius * stroke.radius - vertical * vertical))
      return Math.abs(stroke.x - river.x) <= river.halfWidth + horizontalRadius
    }).some(Boolean)
    if (overlapsRiver
      || landforms.overlapsBarrierFootprint(stroke, stroke.radius)
      || definition.ridges.some((ridge) => distanceToPolyline(stroke, ridge.points) <= ridge.halfWidth * 1.8 + stroke.radius)) {
      throw new Error(`Invalid zone definition: terrain stroke ${stroke.id} overlaps protected water or mountain terrain or barrier terrain`)
    }
    const minColumn = Math.max(0, Math.floor((stroke.x - stroke.radius - bounds.minX) / cellSize))
    const maxColumn = Math.min(columns - 1, Math.ceil((stroke.x + stroke.radius - bounds.minX) / cellSize))
    const minRow = Math.max(0, Math.floor((stroke.z - stroke.radius - bounds.minZ) / cellSize))
    const maxRow = Math.min(rows - 1, Math.ceil((stroke.z + stroke.radius - bounds.minZ) / cellSize))
    if (stroke.mode !== 'smooth') {
      for (let row = minRow; row <= maxRow; row += 1) for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = bounds.minX + column * cellSize
        const z = bounds.minZ + row * cellSize
        const offset = row * columns + column
        heightValues[offset] = Math.max(-100, Math.min(500, heightValues[offset]! + strokeHeight(stroke, x, z)))
      }
      continue
    }
    const source = heightValues.slice()
    const strength = Math.min(1, stroke.amount / 100)
    for (let row = Math.max(1, minRow); row <= Math.min(rows - 2, maxRow); row += 1) for (let column = Math.max(1, minColumn); column <= Math.min(columns - 2, maxColumn); column += 1) {
      const x = bounds.minX + column * cellSize
      const z = bounds.minZ + row * cellSize
      const distance = Math.hypot(x - stroke.x, z - stroke.z)
      if (distance >= stroke.radius) continue
      let average = 0
      for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) average += source[(row + dz) * columns + column + dx]!
      average /= 9
      const falloff = (1 + Math.cos(Math.PI * distance / stroke.radius)) * 0.5
      const offset = row * columns + column
      heightValues[offset] = source[offset]! + (average - source[offset]!) * strength * falloff
    }
  }
  const vertices: TerrainVertex[] = heightValues.map((y, index) => Object.freeze({
    x: bounds.minX + index % columns * cellSize,
    y,
    z: bounds.minZ + Math.floor(index / columns) * cellSize,
  }))
  const indices: number[] = []
  for (let row = 0; row < rows - 1; row += 1) for (let column = 0; column < columns - 1; column += 1) {
    const a = row * columns + column
    const b = a + 1
    const c = a + columns
    const d = c + 1
    indices.push(a, c, b, d, b, c)
  }
  const barrierStoneWeights = vertices.map((vertex) => landforms.sample(vertex.x, vertex.z).stoneWeight)
  const mountainStoneWeights = vertices.map((vertex) => Math.max(
    ...definition.ridges.map((ridge) => Math.min(1, ridgeHeight(ridge, vertex.x, vertex.z) / Math.max(1, ridge.height * 0.6))),
  ))
  const stoneWeights = vertices.map((_vertex, index) => Math.max(barrierStoneWeights[index]!, mountainStoneWeights[index]!))
  const colors: [number, number, number][] = vertices.map((vertex, index) => {
    const river = riverAt(vertex.z)
    if (Math.abs(vertex.x - river.x) < river.halfWidth + 4) return [0.58, 0.7, 0.62]
    if (vertex.x > river.x) return [0.78, 0.8, 0.79]
    if (barrierStoneWeights[index]! > 0.1) return [0.7, 0.69, 0.64]
    if (mountainStoneWeights[index]! > 0.1) return [0.86, 0.85, 0.8]
    return [0.67, 0.84, 0.59]
  })
  const geometry: TerrainGeometryData = Object.freeze({
    vertices: Object.freeze(vertices), indices: Object.freeze(indices), colors: Object.freeze(colors),
    stoneWeights: Object.freeze(stoneWeights), columns,
  })

  function terrainTriangleAt(x: number, z: number): readonly WeightedTerrainVertex[] {
    const localX = Math.min(columns - 1 - Number.EPSILON, Math.max(0, (x - bounds.minX) / cellSize))
    const localZ = Math.min(rows - 1 - Number.EPSILON, Math.max(0, (z - bounds.minZ) / cellSize))
    const column = Math.min(columns - 2, Math.floor(localX))
    const row = Math.min(rows - 2, Math.floor(localZ))
    const tx = localX - column
    const tz = localZ - row
    const at = (columnOffset: number, rowOffset: number): TerrainVertex => vertices[(row + rowOffset) * columns + column + columnOffset]!
    if (tx + tz <= 1) return [
      { ...at(0, 0), weight: 1 - tx - tz }, { ...at(1, 0), weight: tx }, { ...at(0, 1), weight: tz },
    ]
    return [
      { ...at(1, 1), weight: tx + tz - 1 }, { ...at(0, 1), weight: 1 - tx }, { ...at(1, 0), weight: 1 - tz },
    ]
  }
  const heightAt = (x: number, z: number): number => terrainTriangleAt(x, z).reduce((sum, vertex) => sum + vertex.y * vertex.weight, 0)
  const riverCenterAt = (z: number): number => riverAt(z).x
  const riverHalfWidthAt = (z: number): number => riverAt(z).halfWidth
  const riverDepthAt = (z: number): number => riverAt(z).depth
  const isWaterAt = (x: number, z: number, radius = 0): boolean => Math.abs(x - riverCenterAt(z)) <= riverHalfWidthAt(z) + radius
  const insideBounds = (x: number, z: number, radius: number): boolean => x - radius >= bounds.minX && x + radius <= bounds.maxX
    && z - radius >= bounds.minZ && z + radius <= bounds.maxZ
  const inRidge = (x: number, z: number, radius: number): boolean => definition.ridges.some((ridge) =>
    distanceToPolyline({ x, z }, ridge.points) <= ridge.halfWidth + radius)
  const canOccupyPoint = (x: number, z: number, radius: number): boolean => insideBounds(x, z, radius)
    && !isWaterAt(x, z, radius) && !inRidge(x, z, radius) && !landforms.blocks(x, z, radius)
  const landmarkById = new Map(definition.landmarks.map((item) => [item.id, item]))
  const spawnLandmark = landmarkById.get(definition.spawn.landmarkId)!
  const spawn = Object.freeze({ x: spawnLandmark.x + definition.spawn.offset.x, z: spawnLandmark.z + definition.spawn.offset.z })
  if (!canOccupyPoint(spawn.x, spawn.z, 0.72)) throw new Error('Invalid zone definition: spawn is blocked')
  const projectedSolids = projectZoneSolids({ landmarks: definition.landmarks, paths: definition.paths, canOccupyPoint })
  const overlapsProjectedSolid = (x: number, z: number, radius: number) => projectedSolids.find((solid) =>
    Math.hypot(x - solid.x, z - solid.z) < radius + solid.radius)
  const spawnSolid = overlapsProjectedSolid(spawn.x, spawn.z, 0.72)
  if (spawnSolid) throw new Error(`Invalid zone definition: spawn overlaps projected solid ${spawnSolid.id}`)
  const pathById = new Map(definition.paths.map((path) => [path.id, path]))
  const mainLength = definition.mainRoute.reduce((sum, pathId) => sum + pathLength(pathById.get(pathId)!), 0)
  const maxSlope = 35 * Math.PI / 180
  for (const path of definition.paths) for (let segment = 1; segment < path.points.length; segment += 1) {
    const start = path.points[segment - 1]!
    const end = path.points[segment]!
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / Math.max(1, path.width * 0.5)))
    const segmentLength = Math.hypot(end.x - start.x, end.z - start.z)
    const normal = { x: -(end.z - start.z) / segmentLength, z: (end.x - start.x) / segmentLength }
    let prior = start
    for (let step = 0; step <= steps; step += 1) {
      const x = start.x + (end.x - start.x) * step / steps
      const z = start.z + (end.z - start.z) * step / steps
      for (const side of [-1, 0, 1]) {
        const sampleX = x + normal.x * path.width * 0.45 * side
        const sampleZ = z + normal.z * path.width * 0.45 * side
        if (!canOccupyPoint(sampleX, sampleZ, 0.72)) {
          throw new Error(`Invalid zone definition: required path ${path.id} is blocked`)
        }
      }
      const blockingSolid = overlapsProjectedSolid(x, z, 0.72)
      if (blockingSolid) {
        throw new Error(`Invalid zone definition: required path ${path.id} is blocked by projected solid ${blockingSolid.id}`)
      }
      if (step > 0) {
        const horizontal = Math.hypot(x - prior.x, z - prior.z)
        if (Math.atan2(Math.abs(heightAt(x, z) - heightAt(prior.x, prior.z)), horizontal) > maxSlope) {
          throw new Error(`Invalid zone definition: required path ${path.id} exceeds the movement slope`)
        }
      }
      prior = { x, z }
    }
  }
  const barrierNodes = definition.ridges.map((ridge) => ({ ridge, links: new Set<number>() }))
  const riverNode = barrierNodes.length
  for (let left = 0; left < barrierNodes.length; left += 1) {
    const node = barrierNodes[left]!
    for (let right = left + 1; right < barrierNodes.length; right += 1) {
      const other = barrierNodes[right]!
      const linked = [node.ridge.points[0]!, node.ridge.points.at(-1)!].some((a) =>
        [other.ridge.points[0]!, other.ridge.points.at(-1)!].some((b) =>
          Math.hypot(a.x - b.x, a.z - b.z) <= node.ridge.halfWidth + other.ridge.halfWidth + 1.5))
      if (linked) { node.links.add(right); other.links.add(left) }
    }
    const meetsRiver = [node.ridge.points[0]!, node.ridge.points.at(-1)!]
      .some((point) => isWaterAt(point.x, point.z, node.ridge.halfWidth + 1.5))
    if (meetsRiver) node.links.add(riverNode)
  }
  const riverLinks = barrierNodes.flatMap((node, index) => node.links.has(riverNode) ? [index] : [])
  if (barrierNodes.length < 3 || riverLinks.length < 2 || barrierNodes.some((node) => node.links.size < 2)) {
    throw new Error('Invalid zone definition: mountain and river boundary is not sealed')
  }
  const midX = (bounds.minX + bounds.maxX) * 0.5
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5
  for (const edge of [{ x: midX, z: bounds.maxZ }, { x: bounds.minX, z: midZ }, { x: midX, z: bounds.minZ }]) {
    if (!definition.ridges.some((ridge) => distanceToPolyline(edge, ridge.points) <= ridge.halfWidth * 2.5)) {
      throw new Error('Invalid zone definition: mountain boundary does not guard the north, east and south exits')
    }
  }
  if (definition.river.points[0]!.z > bounds.minZ || definition.river.points.at(-1)!.z < bounds.maxZ
    || spawn.x >= riverCenterAt(spawn.z) - riverHalfWidthAt(spawn.z)) {
    throw new Error('Invalid zone definition: river does not seal the western exit from the living bank')
  }
  const floodRadius = 0.72
  const floodStep = Math.min(20, Math.max(8, cellSize * 2))
  const floodColumns = Math.floor((bounds.maxX - bounds.minX - floodRadius * 2) / floodStep) + 1
  const floodRows = Math.floor((bounds.maxZ - bounds.minZ - floodRadius * 2) / floodStep) + 1
  const floodPoint = (column: number, row: number): WorldPoint => ({
    x: bounds.minX + floodRadius + column * floodStep,
    z: bounds.minZ + floodRadius + row * floodStep,
  })
  const startColumn = Math.max(0, Math.min(floodColumns - 1, Math.round((spawn.x - bounds.minX - floodRadius) / floodStep)))
  const startRow = Math.max(0, Math.min(floodRows - 1, Math.round((spawn.z - bounds.minZ - floodRadius) / floodStep)))
  const pending: [number, number][] = [[startColumn, startRow]]
  const visited = new Set([startRow * floodColumns + startColumn])
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const [column, row] = pending[cursor]!
    if (column === 0 || row === 0 || column === floodColumns - 1 || row === floodRows - 1) {
      throw new Error('Invalid zone definition: natural boundary leaves an outer-guard escape')
    }
    const from = floodPoint(column, row)
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue
      const nextColumn = column + dx
      const nextRow = row + dz
      if (nextColumn < 0 || nextColumn >= floodColumns || nextRow < 0 || nextRow >= floodRows) continue
      const key = nextRow * floodColumns + nextColumn
      if (visited.has(key)) continue
      const to = floodPoint(nextColumn, nextRow)
      if (!canOccupyPoint(to.x, to.z, floodRadius)
        || !canOccupyPoint((from.x + to.x) * 0.5, (from.z + to.z) * 0.5, floodRadius)) continue
      visited.add(key)
      pending.push([nextColumn, nextRow])
    }
  }
  return Object.freeze({
    definition, bounds, cellSize, landmarks: definition.landmarks, paths: definition.paths, ridges: definition.ridges,
    spawn, mainRoute: Object.freeze({ pathIds: definition.mainRoute, length: mainLength, runSeconds: mainLength / RUN_SPEED }),
    heightAt, terrainTriangleAt, geometry: () => geometry, riverCenterAt, riverHalfWidthAt, riverDepthAt,
    waterLevelAt: (x: number, z: number) => isWaterAt(x, z) ? definition.river.waterLevel : undefined,
    isWaterAt, canOccupyPoint,
  })
}
