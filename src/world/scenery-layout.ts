export interface SceneryPoint {
  readonly x: number
  readonly z: number
}

export interface SceneryLandmark extends SceneryPoint {
  readonly id: string
  readonly label: string
  readonly radius: number
}

export interface SceneryPath {
  readonly id: string
  readonly width: number
  readonly points: readonly SceneryPoint[]
}

export interface ScenerySolid extends SceneryPoint {
  readonly id: string
  readonly radius: number
}

export const BUILDING_STYLES = [
  { id: 'refuge-hall', kind: 'hall', yaw: Math.PI * 0.48 },
  { id: 'refuge-cottage-north', kind: 'cottage', yaw: Math.PI },
  { id: 'refuge-cottage-east', kind: 'cottage', yaw: -Math.PI * 0.48 },
  { id: 'refuge-workshop', kind: 'workshop', yaw: 0 },
  { id: 'farm-house', kind: 'farmhouse', yaw: Math.PI * 0.35 },
  { id: 'farm-barn', kind: 'barn', yaw: Math.PI * 0.8 },
] as const

export function routeIsClear(
  point: SceneryPoint,
  margin: number,
  paths: readonly SceneryPath[],
): boolean {
  for (const path of paths) {
    const clearance = path.width * 0.5 + margin
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1]
      const end = path.points[index]
      if (start && end && distanceToSegmentSquared(point, start, end) < clearance * clearance) {
        return false
      }
    }
  }
  return true
}

function distanceToSegmentSquared(point: SceneryPoint, start: SceneryPoint, end: SceneryPoint): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared === 0) return (point.x - start.x) ** 2 + (point.z - start.z) ** 2
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
  return (point.x - (start.x + dx * t)) ** 2 + (point.z - (start.z + dz * t)) ** 2
}
