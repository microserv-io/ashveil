import type { CompiledZone } from './zone-types'

export interface WorldStartPresentation {
  readonly locationLabel: string
  readonly resetLabel: string
}

export function worldStartPresentation(zone: CompiledZone): WorldStartPresentation {
  const spawnLandmarkId = zone.definition.spawn.landmarkId
  const landmark = zone.landmarks.find((candidate) => candidate.id === spawnLandmarkId)
  if (!landmark) throw new Error(`Spawn landmark is missing: ${spawnLandmarkId}`)
  return {
    locationLabel: landmark.label,
    resetLabel: spawnLandmarkId === 'safe-landing' ? 'Return to landing' : 'Return to start',
  }
}
