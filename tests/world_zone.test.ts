import { describe, expect, it } from 'vitest'
import { DEFAULT_ZONE } from '../src/world/zone-default'
import { compileZone, parseZoneDefinitionJson, validateZoneDefinition } from '../src/world/zone-compiler'
import { CompiledLandforms } from '../src/world/zone-landforms'

describe('versioned zone terrain', () => {
  it('compiles the default map deterministically and preserves exact triangle grounding', () => {
    const first = compileZone(DEFAULT_ZONE)
    const second = compileZone(JSON.parse(JSON.stringify(DEFAULT_ZONE)))
    expect(first.definition).toEqual(second.definition)
    expect(first.geometry()).toEqual(second.geometry())
    expect(Object.isFrozen(first.definition)).toBe(true)
    expect(Object.isFrozen(first.definition.paths)).toBe(true)
    for (const point of DEFAULT_ZONE.paths.flatMap((path) => path.points)) {
      const triangleHeight = first.terrainTriangleAt(point.x, point.z)
        .reduce((sum, vertex) => sum + vertex.y * vertex.weight, 0)
      expect(first.heightAt(point.x, point.z)).toBeCloseTo(triangleHeight, 10)
    }
  })

  it('calibrates the authored main route to five minutes at normal run speed', () => {
    const zone = compileZone(DEFAULT_ZONE)
    expect(zone.mainRoute.length).toBeCloseTo(1_500, 6)
    expect(zone.mainRoute.runSeconds).toBeGreaterThanOrEqual(285)
    expect(zone.mainRoute.runSeconds).toBeLessThanOrEqual(315)
  })

  it('keeps schema-v1 drafts without landforms loadable while compiling the v3 default', () => {
    const legacy = structuredClone(DEFAULT_ZONE) as typeof DEFAULT_ZONE & { terrain: { landforms?: unknown } }
    delete legacy.terrain.landforms
    expect(compileZone(legacy).mainRoute.length).toBeCloseTo(1_500, 6)
    expect(DEFAULT_ZONE.terrain.landforms?.map((landform) => landform.kind)).toContain('hill')
    expect(DEFAULT_ZONE.terrain.landforms?.map((landform) => landform.kind)).toContain('barrier')
  })

  it('rejects malformed and oversized definitions before terrain allocation', () => {
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, cellSize: 2 }).join('\n')).toContain('cellSize')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, bounds: { ...DEFAULT_ZONE.bounds, maxX: 6_000 } }).join('\n')).toContain('bounds')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, paths: [{ ...DEFAULT_ZONE.paths[0]!, to: 'missing' }] }).join('\n')).toContain('unknown landmark')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, river: { ...DEFAULT_ZONE.river, points: [
      DEFAULT_ZONE.river.points[1]!, DEFAULT_ZONE.river.points[0]!,
    ] } }).join('\n')).toContain('strictly ordered')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, ridges: [{ ...DEFAULT_ZONE.ridges[0]!, height: 0 }] }).join('\n')).toContain('ridge')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [
      { id: 'bad-stroke', mode: 'raise', x: 0, z: 0, radius: 10, amount: -1 },
    ] } }).join('\n')).toContain('stroke')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, mainRoute: ['lower-road', 'refuge-road'] }).join('\n')).toContain('connect in order')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, bounds: { minX: -2_500, maxX: 2_500, minZ: -2_500, maxZ: 2_500 }, cellSize: 4 }).join('\n'))
      .toContain('300000 vertices')
    expect(() => parseZoneDefinitionJson(' '.repeat(512 * 1024 + 1))).toThrow('512 KiB')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, landforms: [
      { kind: 'barrier', id: 'too-thin', points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], halfWidth: 10, height: 20 },
    ] } }).join('\n')).toContain('barrier')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, landforms: [
      { kind: 'hill', id: 'too-steep', points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], halfWidth: 30, height: 20 },
    ] } }).join('\n')).toContain('walkable')
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain,
      landforms: Array.from({ length: 17 }, (_, index) => ({
        kind: 'hill', id: `hill-${index}`, points: [{ x: index * 2, z: 0 }, { x: index * 2 + 1, z: 0 }], halfWidth: 50, height: 10,
      })) } }).join('\n')).toContain('at most 16')
  })

  it('rejects a visible mountain range that no longer seals to the river', () => {
    const north = DEFAULT_ZONE.ridges[0]!
    const moved = { ...north, points: north.points.map((point, index) => index === north.points.length - 1
      ? { x: point.x - 500, z: point.z } : point) }
    expect(() => compileZone({ ...DEFAULT_ZONE, ridges: [moved, ...DEFAULT_ZONE.ridges.slice(1)] })).toThrow('not sealed')
  })

  it('seals water and mountain boundaries while required roads stay traversable', () => {
    const zone = compileZone(DEFAULT_ZONE)
    for (const riverPoint of DEFAULT_ZONE.river.points) {
      expect(zone.canOccupyPoint(riverPoint.x, riverPoint.z, 0.72)).toBe(false)
    }
    for (const ridge of DEFAULT_ZONE.ridges) {
      for (const point of ridge.points) expect(zone.canOccupyPoint(point.x, point.z, 0.72)).toBe(false)
    }
    for (const path of DEFAULT_ZONE.paths) {
      for (const point of path.points) expect(zone.canOccupyPoint(point.x, point.z, 0.72), path.id).toBe(true)
    }
  })

  it('derives visible refuge-bluff relief and collision from the same resolved profile', () => {
    const zone = compileZone(DEFAULT_ZONE)
    const bluff = DEFAULT_ZONE.terrain.landforms?.find((landform) => landform.id === 'refuge-west-bluff')
    expect(bluff?.kind).toBe('barrier')
    const start = bluff!.points[1]!
    const end = bluff!.points[2]!
    const length = Math.hypot(end.x - start.x, end.z - start.z)
    const centre = { x: (start.x + end.x) * 0.5, z: (start.z + end.z) * 0.5 }
    const normal = { x: -(end.z - start.z) / length, z: (end.x - start.x) / length }
    for (const offset of [-10, -5, 0, 5, 10]) {
      const point = { x: centre.x + normal.x * offset, z: centre.z + normal.z * offset }
      expect(zone.canOccupyPoint(point.x, point.z, 0), `core offset ${offset}`).toBe(false)
      expect(zone.heightAt(point.x, point.z) - zone.heightAt(
        centre.x + normal.x * bluff!.halfWidth * 1.1,
        centre.z + normal.z * bluff!.halfWidth * 1.1,
      )).toBeGreaterThan(8)
    }
    const north = DEFAULT_ZONE.ridges.find((ridge) => ridge.id === 'north-ridge')!
    expect(Math.min(...north.points.map((point) => Math.hypot(
      point.x - bluff!.points[0]!.x, point.z - bluff!.points[0]!.z,
    )))).toBeLessThan(0.001)
    expect(zone.canOccupyPoint(bluff!.points[0]!.x, bluff!.points[0]!.z, 0.72)).toBe(false)
    const resolved = new CompiledLandforms([bluff!]).sample(centre.x, centre.z)
    expect(resolved.barrierHeight / bluff!.height).toBeGreaterThanOrEqual(0.9)
    expect(resolved.barrierHeight / bluff!.height).toBeLessThanOrEqual(1.02)
  })

  it('applies raise, lower, then true local smoothing deterministically', () => {
    const centre = { x: 0, z: 100 }
    const raised = compileZone({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [
      { id: 'raise-test', mode: 'raise', x: centre.x, z: centre.z, radius: 40, amount: 40 },
    ] } })
    const smoothed = compileZone({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [
      { id: 'raise-test', mode: 'raise', x: centre.x, z: centre.z, radius: 40, amount: 40 },
      { id: 'smooth-test', mode: 'smooth', x: centre.x, z: centre.z, radius: 40, amount: 100 },
    ] } })
    const neighbour = { x: centre.x + DEFAULT_ZONE.cellSize, z: centre.z }
    expect(Math.abs(smoothed.heightAt(centre.x, centre.z) - smoothed.heightAt(neighbour.x, neighbour.z)))
      .toBeLessThan(Math.abs(raised.heightAt(centre.x, centre.z) - raised.heightAt(neighbour.x, neighbour.z)))
  })

  it('applies non-commutative terrain strokes in authored order and protects boundary relief', () => {
    const centre = { x: 0, z: 100 }
    const raise = { id: 'raise-first', mode: 'raise' as const, ...centre, radius: 40, amount: 40 }
    const smooth = { id: 'smooth-middle', mode: 'smooth' as const, ...centre, radius: 40, amount: 100 }
    const lastRaise = { id: 'raise-last', mode: 'raise' as const, ...centre, radius: 8, amount: 20 }
    const ordered = compileZone({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [raise, smooth, lastRaise] } })
    const regrouped = compileZone({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [raise, lastRaise, smooth] } })
    expect(ordered.heightAt(centre.x, centre.z)).toBeGreaterThan(regrouped.heightAt(centre.x, centre.z))

    const ridgePoint = DEFAULT_ZONE.ridges[0]!.points[1]!
    expect(() => compileZone({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [
      { id: 'erase-ridge', mode: 'lower', ...ridgePoint, radius: 20, amount: 100 },
    ] } })).toThrow('protected water or mountain')
    expect(() => compileZone({ ...DEFAULT_ZONE, terrain: { ...DEFAULT_ZONE.terrain, strokes: [
      { id: 'bend', mode: 'raise', x: 797.5, z: -492.5, radius: 20, amount: 100 },
    ] } })).toThrow('protected water or mountain')
  })

  it('rejects physically disconnected path endpoints even when IDs claim a connection', () => {
    const path = DEFAULT_ZONE.paths[0]!
    const disconnected = { ...path, points: [{ ...path.points[0]!, x: path.points[0]!.x + 1 }, ...path.points.slice(1)] }
    expect(validateZoneDefinition({ ...DEFAULT_ZONE, paths: [disconnected, ...DEFAULT_ZONE.paths.slice(1)] }).join('\n'))
      .toContain('does not match from landmark')
  })

  it('rejects imported spawns trapped by landmark-anchored scene solids', () => {
    expect(() => compileZone({ ...structuredClone(DEFAULT_ZONE),
      spawn: { landmarkId: 'refuge', offset: { x: 0, z: 14 } } }))
      .toThrow('spawn overlaps projected solid refuge-cottage-north')

    const draft = structuredClone(DEFAULT_ZONE)
    const landing = draft.landmarks.find((landmark) => landmark.id === 'safe-landing')!
    const relocatedFarm = { ...draft.landmarks.find((landmark) => landmark.id === 'farm')!,
      x: landing.x + draft.spawn.offset.x + 6, z: landing.z + draft.spawn.offset.z - 3 }
    const landmarks = draft.landmarks.map((landmark) => landmark.id === 'farm' ? relocatedFarm : landmark)
    const paths = draft.paths.map((path) => path.id === 'farm-loop-a'
      ? { ...path, points: [...path.points.slice(0, -1), relocatedFarm] }
      : path.id === 'farm-loop-b' ? { ...path, points: [relocatedFarm, ...path.points.slice(1)] } : path)
    expect(() => compileZone({ ...draft, landmarks, paths }))
      .toThrow('spawn overlaps projected solid farm-house')
  })
})
