import type { WorldPoint, ZoneLandmark } from './zone-types'

export interface LandmarkPlacementSource { readonly landmarks: readonly ZoneLandmark[] }

export function placeAtLandmark(zone: LandmarkPlacementSource, homeLandmarkId: string, offset: WorldPoint): WorldPoint {
  const home = zone.landmarks.find((landmark) => landmark.id === homeLandmarkId)
  if (!home) throw new Error(`Unknown placement landmark ${homeLandmarkId}`)
  return { x: home.x + offset.x, z: home.z + offset.z }
}

export function projectLegacyPlacement(
  zone: LandmarkPlacementSource,
  homeLandmarkId: string,
  legacyHome: WorldPoint,
  legacyPoint: WorldPoint,
): WorldPoint {
  return placeAtLandmark(zone, homeLandmarkId, {
    x: legacyPoint.x - legacyHome.x,
    z: legacyPoint.z - legacyHome.z,
  })
}
