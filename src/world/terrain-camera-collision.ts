import * as THREE from 'three'
import type { CompiledZone } from './zone-types'

export function terrainCameraHitDistance(
  zone: CompiledZone,
  origin: THREE.Vector3,
  normalizedDirection: THREE.Vector3,
  distance: number,
  stats?: { trianglesExamined: number },
): number | undefined {
  const data = zone.geometry()
  const rows = data.vertices.length / data.columns
  const endX = origin.x + normalizedDirection.x * distance
  const endZ = origin.z + normalizedDirection.z * distance
  const cell = (value: number, minimum: number, count: number): number => Math.min(
    count - 1,
    Math.max(0, Math.floor((value - minimum) / zone.cellSize)),
  )
  const minColumn = cell(Math.min(origin.x, endX), zone.bounds.minX, data.columns - 1)
  const maxColumn = cell(Math.max(origin.x, endX), zone.bounds.minX, data.columns - 1)
  const minRow = cell(Math.min(origin.z, endZ), zone.bounds.minZ, rows - 1)
  const maxRow = cell(Math.max(origin.z, endZ), zone.bounds.minZ, rows - 1)
  const ray = new THREE.Ray(origin, normalizedDirection)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const intersection = new THREE.Vector3()
  let nearest: number | undefined
  if (stats) stats.trianglesExamined = 0
  for (let row = minRow; row <= maxRow; row += 1) for (let column = minColumn; column <= maxColumn; column += 1) {
    const cellIndex = row * (data.columns - 1) + column
    for (let triangle = 0; triangle < 2; triangle += 1) {
      const offset = cellIndex * 6 + triangle * 3
      const first = data.vertices[data.indices[offset]!]!
      const second = data.vertices[data.indices[offset + 1]!]!
      const third = data.vertices[data.indices[offset + 2]!]!
      a.set(first.x, first.y, first.z)
      b.set(second.x, second.y, second.z)
      c.set(third.x, third.y, third.z)
      if (stats) stats.trianglesExamined += 1
      if (!ray.intersectTriangle(a, b, c, false, intersection)) continue
      const hitDistance = intersection.distanceTo(origin)
      if (hitDistance <= distance + 1e-6 && (nearest === undefined || hitDistance < nearest)) nearest = hitDistance
    }
  }
  return nearest
}
