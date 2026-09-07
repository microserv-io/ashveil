import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANDMARKS, PATHS } from '../src/world/world-data'
import {
  TERRAIN_CELL_SIZE,
  createTerrainGeometryData,
  heightAt,
  riverCenterAt,
  riverHalfWidthAt,
} from '../src/world/terrain'

describe('first-zone terrain', () => {
  it('uses the rendered triangles as the exact height query', () => {
    const geometry = createTerrainGeometryData()
    const samples: readonly (readonly [number, number])[] = [[-73.2, -31.6], [-39.1, 24.4], [-17.3, -78.2], [47.6, 11.9]]
    for (const [x, z] of samples) {
      expect(heightAt(x, z)).toBeCloseTo(renderedHeightAt(geometry, x, z), 10)
    }
    expect(TERRAIN_CELL_SIZE).toBeLessThanOrEqual(5)
  })

  it('keeps the authored route connected and comfortably walkable', () => {
    const landmarkIds = new Set(LANDMARKS.map((landmark) => landmark.id))
    const connections = new Map<string, Set<string>>()
    for (const id of landmarkIds) connections.set(id, new Set())
    for (const path of PATHS) {
      expect(landmarkIds.has(path.from)).toBe(true)
      expect(landmarkIds.has(path.to)).toBe(true)
      connections.get(path.from)!.add(path.to)
      connections.get(path.to)!.add(path.from)
      for (let segment = 1; segment < path.points.length; segment += 1) {
        const from = path.points[segment - 1]!
        const to = path.points[segment]!
        const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.5)
        let last = from
        for (let step = 1; step <= steps; step += 1) {
          const point = { x: from.x + (to.x - from.x) * step / steps, z: from.z + (to.z - from.z) * step / steps }
          const rise = Math.abs(heightAt(point.x, point.z) - heightAt(last.x, last.z))
          expect(Math.atan2(rise, Math.hypot(point.x - last.x, point.z - last.z)) * 180 / Math.PI).toBeLessThanOrEqual(35)
          last = point
        }
      }
    }
    const reached = new Set(['refuge'])
    const pending = ['refuge']
    while (pending.length) for (const next of connections.get(pending.shift()!)!) if (!reached.has(next)) { reached.add(next); pending.push(next) }
    expect(reached).toEqual(landmarkIds)
  })

  it('keeps every safe-bank landmark clear of the river', () => {
    for (const landmark of LANDMARKS) {
      expect(landmark.x + landmark.radius).toBeLessThan(
        riverCenterAt(landmark.z) - riverHalfWidthAt(landmark.z),
      )
    }
  })

  it('does not import the deprecated demo runtime', () => {
    const root = join(import.meta.dirname, '..')
    const worldRoot = join(root, 'src/world')
    const worldFiles = readdirSync(worldRoot).filter((file) => file.endsWith('.ts'))
    const ordinaryWorld = worldFiles.filter((file) => file !== 'character.ts')
      .map((file) => readFileSync(join(worldRoot, file), 'utf8')).join('\n')
    expect(ordinaryWorld).not.toMatch(/src\/main|\.\.\/(sim|render|ui|session|net)\//)

    const character = readFileSync(join(worldRoot, 'character.ts'), 'utf8')
    const renderReferences = [...character.matchAll(/['"](\.\.\/render\/[^'"]+)['"]/g)]
      .map((match) => match[1])
    expect(renderReferences).toEqual([
      '../render/proceduraldriver',
      '../render/profiles/masculine',
      '../render/riginput',
    ])
    const renderImports = [...character.matchAll(/^import( type)? .* from ['"](\.\.\/render\/[^'"]+)['"]/gm)]
      .map((match) => ({ typeOnly: match[1] !== undefined, path: match[2] }))
    expect(renderImports).toEqual([
      { typeOnly: false, path: '../render/proceduraldriver' },
      { typeOnly: false, path: '../render/profiles/masculine' },
      { typeOnly: true, path: '../render/riginput' },
    ])
    expect(character).not.toMatch(/src\/main|\.\.\/(sim|ui|session|net)\//)
    for (const file of ['terrain.ts', 'world-data.ts', 'movement.ts']) {
      expect(readFileSync(join(worldRoot, file), 'utf8')).not.toMatch(/from ['"]three['"]|\b(document|window|performance)\b/)
    }
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('/src/world/main.ts')
    expect(readFileSync(join(root, 'legacy.html'), 'utf8')).toContain('/src/main.ts')
  })
})

function renderedHeightAt(data: ReturnType<typeof createTerrainGeometryData>, x: number, z: number): number {
  for (let offset = 0; offset < data.indices.length; offset += 3) {
    const a = data.vertices[data.indices[offset]!]!
    const b = data.vertices[data.indices[offset + 1]!]!
    const c = data.vertices[data.indices[offset + 2]!]!
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
    const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator
    const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator
    const wc = 1 - wa - wb
    if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return wa * a.y + wb * b.y + wc * c.y
  }
  throw new Error(`No rendered terrain triangle contains ${x},${z}`)
}
