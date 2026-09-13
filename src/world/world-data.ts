import { getActiveZone } from './zone-active'
import { projectZoneSolids, type ProjectedWorldSolid } from './zone-placements'
import type { ZoneLandmark, ZonePath } from './zone-types'

export type { WorldPoint } from './zone-types'
export type Landmark = ZoneLandmark
export type WorldPath = ZonePath
export type WorldSolid = ProjectedWorldSolid

const zone = getActiveZone()

export const SPAWN = zone.spawn
export const LANDMARKS: readonly Landmark[] = zone.landmarks
export const PATHS: readonly WorldPath[] = zone.paths
export const SOLIDS: readonly WorldSolid[] = projectZoneSolids(zone)

export function nearestLandmark(x: number, z: number): Landmark {
  return LANDMARKS.reduce((nearest, landmark) =>
    Math.hypot(landmark.x - x, landmark.z - z) < Math.hypot(nearest.x - x, nearest.z - z) ? landmark : nearest)
}
