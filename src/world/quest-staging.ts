import type { CompiledZone, WorldPoint } from './zone-types'

export type QuestStagingContext =
  | 'landing-camp'
  | 'living-bank'
  | 'refuge-awning'
  | 'refuge-drying-yard'
  | 'refuge-cookfire'
  | 'refuge-commons'

export interface QuestStagingDefinition {
  readonly id: string
  readonly landmarkId: 'safe-landing' | 'refuge'
  readonly context: QuestStagingContext
  readonly offset: WorldPoint
}

export interface ResolvedQuestStaging extends QuestStagingDefinition, WorldPoint {}

export function resolveQuestStaging(zone: CompiledZone, staging: QuestStagingDefinition): ResolvedQuestStaging {
  const landmark = zone.landmarks.find((candidate) => candidate.id === staging.landmarkId)
  if (!landmark) throw new Error(`Quest staging landmark is missing: ${staging.landmarkId}`)
  return {
    ...staging,
    x: landmark.x + staging.offset.x,
    z: landmark.z + staging.offset.z,
  }
}
