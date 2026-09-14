import * as THREE from 'three'
import { createWorldMaterial } from './world-material'
import type { CompiledZone, TerrainGeometryData } from './zone-types'

export interface BuiltTerrainSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  dispose(): void
}

export function terrainStoneWeights(
  data: TerrainGeometryData,
  cellSize: number,
  _baseHeight: number,
): Float32Array {
  const weights = new Float32Array(data.vertices.length)
  const rows = Math.ceil(data.vertices.length / data.columns)
  const smoothstep = (low: number, high: number, value: number): number => {
    const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)
  }
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < data.columns; column += 1) {
    const index = row * data.columns + column
    const vertex = data.vertices[index]
    if (!vertex) continue
    let maximumRise = 0
    for (const neighbor of [index - 1, index + 1, index - data.columns, index + data.columns]) {
      const adjacent = data.vertices[neighbor]
      if (adjacent && Math.abs(adjacent.x - vertex.x) <= cellSize && Math.abs(adjacent.z - vertex.z) <= cellSize) {
        maximumRise = Math.max(maximumRise, Math.abs(adjacent.y - vertex.y))
      }
    }
    const steep = smoothstep(0.32, 0.78, maximumRise / cellSize)
    const authored = data.stoneWeights[index] ?? 0
    weights[index] = Math.max(steep, authored)
  }
  return weights
}

export function buildTerrainSurface(zone: CompiledZone): BuiltTerrainSurface {
  const data = zone.geometry()
  const positions = new Float32Array(data.vertices.length * 3)
  const colors = new Float32Array(data.vertices.length * 3)
  const uv = new Float32Array(data.vertices.length * 2)
  const paintUv = new Float32Array(data.vertices.length * 2)
  const spanX = zone.bounds.maxX - zone.bounds.minX
  const spanZ = zone.bounds.maxZ - zone.bounds.minZ
  data.vertices.forEach((vertex, index) => {
    positions.set([vertex.x, vertex.y, vertex.z], index * 3)
    colors.set(data.colors[index]!, index * 3)
    uv.set([vertex.x / 2, vertex.z / 2], index * 2)
    paintUv.set([(vertex.x - zone.bounds.minX) / spanX, (vertex.z - zone.bounds.minZ) / spanZ], index * 2)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('paintUv', new THREE.BufferAttribute(paintUv, 2))
  geometry.setAttribute('terrainStone', new THREE.BufferAttribute(
    terrainStoneWeights(data, zone.cellSize, zone.definition.terrain.baseHeight), 1,
  ))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = createWorldMaterial(zone)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'first-zone-terrain'
  mesh.receiveShadow = true
  return {
    mesh,
    dispose: () => {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
