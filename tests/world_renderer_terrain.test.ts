import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { terrainPaintTextureData } from '../src/world/terrain-paint'
import { terrainStoneWeights } from '../src/world/terrain-surface'
import { buildWaterSurface } from '../src/world/water-surface'
import { bridgeDeckLayout } from '../src/world/scenery'
import { terrainCameraHitDistance } from '../src/world/terrain-camera-collision'
import { compileZone } from '../src/world/zone-compiler'
import { DEFAULT_ZONE } from '../src/world/zone-default'
import { BARRIER_CORE_RATIO } from '../src/world/zone-landforms'
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

  it('blends limestone onto steep and authored stone vertices', () => {
    const data: TerrainGeometryData = {
      columns: 2,
      vertices: [
        { x: 0, y: 4, z: 0 }, { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 5 }, { x: 5, y: 44, z: 5 },
      ],
      indices: [0, 2, 1, 3, 1, 2],
      colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
      stoneWeights: [0, 0, 0, 0],
    }
    const weights = terrainStoneWeights(data, 5, 4)
    expect(weights[0]).toBe(0)
    expect(weights[3]).toBeGreaterThan(0.7)
  })

  it('paints authored barrier cores as stone while broad hill crests stay grassy', () => {
    const data = zone.geometry()
    const weights = terrainStoneWeights(data, zone.cellSize, zone.definition.terrain.baseHeight)
    const nearestIndex = (point: { x: number; z: number }): number => data.vertices.reduce((nearest, vertex, index) =>
      Math.hypot(vertex.x - point.x, vertex.z - point.z)
        < Math.hypot(data.vertices[nearest]!.x - point.x, data.vertices[nearest]!.z - point.z) ? index : nearest, 0)
    const barrier = DEFAULT_ZONE.terrain.landforms!.find((landform) => landform.id === 'refuge-west-bluff')!
    const hill = DEFAULT_ZONE.terrain.landforms!.find((landform) => landform.id === 'farm-rolling-fields')!
    const barrierIndex = nearestIndex(barrier.points[2]!)
    const hillIndex = nearestIndex(hill.points[1]!)
    expect(data.stoneWeights[barrierIndex]).toBeGreaterThan(0.9)
    expect(weights[barrierIndex]).toBeGreaterThan(0.9)
    expect(data.colors[barrierIndex]).toEqual([0.7, 0.69, 0.64])
    expect(data.stoneWeights[hillIndex]).toBe(0)
    expect(weights[hillIndex]).toBeLessThan(0.2)
    expect(data.colors[hillIndex]).toEqual([0.67, 0.84, 0.59])
    expect(zone.canOccupyPoint(data.vertices[hillIndex]!.x, data.vertices[hillIndex]!.z, 0.72)).toBe(true)
  })

  it('keeps both interpolated faces of every barrier core visibly rocky and raised', () => {
    const data = zone.geometry()
    const stoneAt = (x: number, z: number): number => zone.terrainTriangleAt(x, z).reduce((sum, vertex) => {
      const column = Math.round((vertex.x - zone.bounds.minX) / zone.cellSize)
      const row = Math.round((vertex.z - zone.bounds.minZ) / zone.cellSize)
      return sum + data.stoneWeights[row * data.columns + column]! * vertex.weight
    }, 0)
    for (const barrier of DEFAULT_ZONE.terrain.landforms!.filter((landform) => landform.kind === 'barrier')) {
      for (let segment = 1; segment < barrier.points.length; segment += 1) {
        const from = barrier.points[segment - 1]!
        const to = barrier.points[segment]!
        const length = Math.hypot(to.x - from.x, to.z - from.z)
        const normal = { x: -(to.z - from.z) / length, z: (to.x - from.x) / length }
        for (let tenth = 1; tenth < 10; tenth += 1) for (const side of [-1, 1]) {
          const centre = { x: from.x + (to.x - from.x) * tenth / 10, z: from.z + (to.z - from.z) * tenth / 10 }
          const coreOffset = barrier.halfWidth * (BARRIER_CORE_RATIO - 0.001) * side
          const point = { x: centre.x + normal.x * coreOffset, z: centre.z + normal.z * coreOffset }
          const outside = { x: centre.x + normal.x * barrier.halfWidth * 1.05 * side,
            z: centre.z + normal.z * barrier.halfWidth * 1.05 * side }
          expect(zone.canOccupyPoint(point.x, point.z, 0.72), `${barrier.id} ${segment}:${tenth}:${side}`).toBe(false)
          expect(stoneAt(point.x, point.z), `${barrier.id} stone ${segment}:${tenth}:${side}`).toBeGreaterThan(0.7)
          expect(zone.heightAt(point.x, point.z) - zone.heightAt(outside.x, outside.z),
            `${barrier.id} relief ${segment}:${tenth}:${side}`).toBeGreaterThan(5)
        }
      }
    }
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
    const direction = new THREE.Vector3(0, 1, 0)
    const color = new THREE.Color(0xaabbff)
    const ambientColor = new THREE.Color(0x7788aa)
    water.update(12.5, { direction, color, intensity: 1.1, ambientColor })
    expect(water.mesh.material.uniforms.elapsedSeconds!.value).toBe(12.5)
    expect(water.mesh.material.uniforms.keyLightDirection!.value).toEqual(direction)
    expect(water.mesh.material.uniforms.keyLightColor!.value).toEqual(color)
    expect(water.mesh.material.uniforms.keyLightIntensity!.value).toBe(1.1)
    expect(water.mesh.material.uniforms.ambientLightColor!.value).toEqual(ambientColor)
    expect(water.mesh.material.fragmentShader).toMatch(/litFoamColor = foamColor \* ambientFactor/)
    expect(water.mesh.material.fragmentShader).toContain('mix(color, litFoamColor, foam * 0.68)')
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
