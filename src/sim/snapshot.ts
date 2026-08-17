import type { PlayerSlot } from './sim'
import type { Actor, GroundItem, Orb, PlayerId, Projectile, ZoneKind } from './types'

/**
 * Bumped whenever the shape below changes. A snapshot that does not match is
 * rejected rather than half-read, because a save game or a joining client that
 * silently loads the wrong shape fails somewhere far away from the cause.
 */
export const SNAPSHOT_VERSION = 1

/**
 * `authoritative` is the full tick and only a server runs it. `predicted` is the
 * RNG-free subset a client may run ahead for its own responsiveness.
 */
export type TickMode = 'authoritative' | 'predicted'

/**
 * A complete instance, minus anything derivable. The map is omitted deliberately:
 * geometry is a pure function of `(seed, depth)`, so it regenerates on arrival
 * instead of crossing the wire.
 */
export interface InstanceSnapshot {
  version: number
  seed: number
  depth: number
  zone: ZoneKind
  time: number
  tickCount: number
  rngState: number
  nextEntityId: number
  nextItemSerial: number
  nextPlayerId: number
  actors: Actor[]
  projectiles: Projectile[]
  groundItems: GroundItem[]
  orbs: Orb[]
  players: PlayerSlot[]
  respawnAt: [PlayerId, number][]
  monstersKilled: number
  areaMonsterCount: number
  areaStartTime: number
  areaCleared: boolean
  areasCleared: number
}

/**
 * Round-trips through JSON. If this throws, something non-serialisable has crept
 * into replicated state — a Map, a Set, a class instance — and late join, saves
 * and reconciliation would all break on it.
 */
export function encodeSnapshot(snapshot: InstanceSnapshot): string {
  return JSON.stringify(snapshot)
}

export function decodeSnapshot(encoded: string): InstanceSnapshot {
  return JSON.parse(encoded) as InstanceSnapshot
}
