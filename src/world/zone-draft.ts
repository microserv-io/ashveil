import { compileZone, parseZoneDefinitionJson } from './zone-compiler'
import type { CompiledZone, ZoneDefinition } from './zone-types'

export const ZONE_DRAFT_STORAGE_KEY = 'ashveil.zone-draft.v1'

export interface ZoneDraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type ZoneDraftLoadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly definition: ZoneDefinition; readonly compiled: CompiledZone }
  | { readonly kind: 'invalid'; readonly reason: string }

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function loadZoneDraft(storage: ZoneDraftStorage): ZoneDraftLoadResult {
  try {
    const text = storage.getItem(ZONE_DRAFT_STORAGE_KEY)
    if (text === null) return { kind: 'missing' }
    const definition = parseZoneDefinitionJson(text)
    return { kind: 'valid', definition, compiled: compileZone(definition) }
  } catch (error) {
    return { kind: 'invalid', reason: readableError(error) }
  }
}

export function saveZoneDraft(storage: ZoneDraftStorage, definition: ZoneDefinition): CompiledZone {
  const compiled = compileZone(definition)
  storage.setItem(ZONE_DRAFT_STORAGE_KEY, JSON.stringify(compiled.definition, null, 2))
  return compiled
}

export function clearZoneDraft(storage: ZoneDraftStorage): void {
  storage.removeItem(ZONE_DRAFT_STORAGE_KEY)
}
