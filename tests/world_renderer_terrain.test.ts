import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { terrainPaintTextureData } from '../src/world/terrain-paint'
import { terrainStoneWeights } from '../src/world/terrain-surface'
import { buildWaterSurface } from '../src/world/water-surface'
import { bridgeDeckLayout } from '../src/world/scenery'
import { terrainCameraHitDistance } from '../src/world/terrain-camera-collision'
import { compileZone } from '../src/world/zone-compiler'
import { DEFAULT_ZONE } from '../src/world/zone-default'
import type { TerrainGeometryData } from '../src/world/zone-types'

describe('compiled-zone terrain presentation', () => {
  const zone = compileZone(DEFAULT_ZONE)

  it('keeps human-scale road paint at one world unit per texel within the allocation cap', () => {
    const paint = terrainPaintTextureData(zone)
    expect(paint.worldUnitsPerTexel).toBeLessThanOrEqual(1.001)
    expect(paint.width).toBeLessThanOrEqual(4_096)
    expect(paint.height).toBeLessThanOrEqual(4_096)
    expect(paint.width * paint.height).toBeLessThanOrEqual(16_000_000)
    const point = zone.paths[0]!.points[1]!
    const column = Math.floor((point.x - zone.bounds.minX) / (zone.bounds.maxX - zone.bounds.minX) * paint.width)
    const row = Math.floor((point.z - zone.bounds.minZ) / (zone.bounds.maxZ - zone.bounds.minZ) * paint.height)
    expect(paint.data[(row * paint.width + column) * 4]).toBeGreaterThan(240)
  })

  it('blends limestone onto steep and high vertices', () => {
    const data: TerrainGeometryData = {
      columns: 2,
      vertices: [
        { x: 0, y: 4, z: 0 }, { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 5 }, { x: 5, y: 44, z: 5 },
      ],
      indices: [0, 2, 1, 3, 1, 2],
      colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
    }
    const weights = terrainStoneWeights(data, 5, 4)
    expect(weights[0]).toBe(0)
    expect(weights[3]).toBeGreaterThan(0.7)
  })

  it('builds animated transparent water from compiled river queries and disposes it', () => {
    const water = buildWaterSurface(zone, new THREE.Vector3(-60, 85, 25))
    const positions = water.mesh.geometry.getAttribute('position')
    const shore = water.mesh.geometry.getAttribute('shore')
    expect(positions.count).toBeGreaterThan(zone.definition.river.points.length * 5)
    expect(Math.min(...Array.from({ length: positions.count }, (_, index) => positions.getZ(index)))).toBeCloseTo(zone.bounds.minZ)
    expect(Math.max(...Array.from({ length: positions.count }, (_, index) => positions.getZ(index)))).toBeCloseTo(zone.bounds.maxZ)
    expect([shore.getX(0), shore.getX(2), shore.getX(4)]).toEqual([1, 0, 1])
    expect(water.mesh.material).toMatchObject({ transparent: true, depthWrite: false })
    water.update(12.5)
    expect(water.mesh.material.uniforms.elapsedSeconds!.value).toBe(12.5)
    let geometryDisposed = false
    let materialDisposed = false
    water.mesh.geometry.addEventListener('dispose', () => { geometryDisposed = true })
    water.mesh.material.addEventListener('dispose', () => { materialDisposed = true })
    water.dispose()
    expect({ geometryDisposed, materialDisposed }).toEqual({ geometryDisposed: true, materialDisposed: true })
  })

  it('extends the broken bridge over the compiled shore while retaining a wide river gap', () => {
    const gate = zone.landmarks.find((landmark) => landmark.id === 'waystation')!
    const abutment = zone.landmarks.find((landmark) => landmark.id === 'bridge-abutment')!
    const layout = bridgeDeckLayout(gate, abutment, zone.isWaterAt)
    const lastDeck = layout.centers.at(-1)!
    expect(zone.isWaterAt(lastDeck.x, lastDeck.z)).toBe(true)

    let oppositeBankForward = layout.shoreForward
    for (; oppositeBankForward < 400; oppositeBankForward += 1) {
      const x = abutment.x + layout.direction.x * oppositeBankForward
      const z = abutment.z + layout.direction.z * oppositeBankForward
      if (oppositeBankForward > layout.shoreForward + 1 && !zone.isWaterAt(x, z)) break
    }
    const lastForward = Math.hypot(lastDeck.x - abutment.x, lastDeck.z - abutment.z)
    expect(oppositeBankForward - lastForward).toBeGreaterThan(100)
  })

  it('tests only camera-segment grid triangles and matches the rendered mesh intersection', () => {
    const origin = new THREE.Vector3(zone.spawn.x, zone.heightAt(zone.spawn.x, zone.spawn.z) + 2, zone.spawn.z)
    const direction = new THREE.Vector3(0.82, -0.4, 0.3).normalize()
    const distance = 18
    const stats = { trianglesExamined: 0 }
    const boundedHit = terrainCameraHitDistance(zone, origin, direction, distance, stats)
    const terrain = zone.geometry()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(
      terrain.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]), 3,
    ))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(terrain.indices), 1))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const exactHit = new THREE.Raycaster(origin, direction, 0, distance).intersectObject(mesh)[0]?.distance
    expect(boundedHit).toBeCloseTo(exactHit!, 5)
    expect(stats.trianglesExamined).toBeLessThanOrEqual(50)
    geometry.dispose()
    mesh.material.dispose()
  })
})
