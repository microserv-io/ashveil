import type { ClientMessage, ServerTransport } from '../net/protocol'
import { type Character, type CharacterRealm, cloneCharacter } from '../sim/character'
import { Sim } from '../sim/sim'
import { ZONE_RULES, type PlayerId, type ZoneKind } from '../sim/types'

/**
 * Characters outlive instances, so they are stored rather than lived in. The web
 * build can back this with IndexedDB and the native build with the filesystem
 * without the session noticing the difference.
 */
export interface CharacterStore {
  /** Which characters this store is allowed to hold. */
  readonly realm: CharacterRealm
  load(id: string): Promise<Character | null>
  save(character: Character): Promise<void>
  list(): Promise<Character[]>
}

export class MemoryCharacterStore implements CharacterStore {
  private readonly characters = new Map<string, Character>()

  constructor(readonly realm: CharacterRealm = 'offline') {}

  async load(id: string): Promise<Character | null> {
    const found = this.characters.get(id)
    return found ? cloneCharacter(found) : null
  }

  async save(character: Character): Promise<void> {
    if (character.realm !== this.realm) {
      throw new Error(`refusing to store a ${character.realm} character in the ${this.realm} store`)
    }
    this.characters.set(character.id, cloneCharacter(character))
  }

  async list(): Promise<Character[]> {
    return [...this.characters.values()].map(cloneCharacter)
  }
}

export interface SessionOptions {
  seed: number
  /** Defaults to a dungeon; a hub or overworld session passes its own. */
  zone?: ZoneKind
  store?: CharacterStore
  /** Ticks between snapshots. Events go out every tick regardless. */
  snapshotInterval?: number
}

/**
 * The authoritative side. It owns the instance, seats characters into it, applies
 * commands and broadcasts what happened. Single-player runs this in-process over a
 * loopback transport; co-op runs the same class with a real one.
 *
 * Instance transitions still happen inside the instance today. When parties exist,
 * moving them between instances belongs here — that is why characters already live
 * at this level rather than inside the instance they happen to be standing in.
 */
export class GameSession {
  readonly instance: Sim
  readonly store: CharacterStore

  private readonly transports = new Map<ServerTransport, Set<PlayerId>>()
  private readonly snapshotInterval: number

  constructor(options: SessionOptions) {
    this.instance = new Sim({ seed: options.seed, characters: [], zone: options.zone ?? 'dungeon' })
    this.store = options.store ?? new MemoryCharacterStore()
    this.snapshotInterval = options.snapshotInterval ?? 6
  }

  /** Wire a connection in. Returns an unsubscribe for when it drops. */
  connect(transport: ServerTransport): () => void {
    this.transports.set(transport, new Set())
    const stop = transport.receive((message) => this.handle(transport, message))
    return () => {
      for (const playerId of this.transports.get(transport) ?? []) this.leave(playerId)
      this.transports.delete(transport)
      stop()
    }
  }

  private handle(transport: ServerTransport, message: ClientMessage): void {
    switch (message.kind) {
      case 'join': {
        const playerId = this.join(message.character)
        this.transports.get(transport)?.add(playerId)
        transport.send({ kind: 'welcome', playerId, snapshot: this.instance.snapshot() })
        break
      }
      case 'command':
        // Commands are trusted only as intent, never as outcome: the instance
        // decides whether the cast is affordable, in range, or off cooldown.
        this.instance.submit(message.command)
        break
      case 'leave':
        this.leave(message.playerId)
        this.transports.get(transport)?.delete(message.playerId)
        break
    }
  }

  join(character: Character): PlayerId {
    const limit = ZONE_RULES[this.instance.zone].maxPlayers
    if (this.instance.players.size >= limit) {
      throw new Error(`${this.instance.zone} is full (${limit} players)`)
    }
    const playerId = this.instance.addPlayer(character)
    if (this.instance.players.size === 1) this.instance.localPlayerId = playerId
    return playerId
  }

  leave(playerId: PlayerId): void {
    const character = this.instance.removePlayer(playerId)
    if (character) void this.store.save(character)
    this.broadcast({ kind: 'player_left', playerId })
  }

  tick(): void {
    this.instance.tick('authoritative')

    if (this.instance.events.length > 0) {
      this.broadcast({ kind: 'events', tick: this.instance.tickCount, events: [...this.instance.events] })
    }
    if (this.instance.tickCount % this.snapshotInterval === 0) {
      this.broadcast({
        kind: 'snapshot',
        snapshot: this.instance.snapshot(),
        acknowledged: [...this.instance.players.values()].map((slot) => [slot.id, slot.lastSequence]),
      })
    }
  }

  /** Persist every seated character; the native build calls this on quit. */
  async persist(): Promise<void> {
    for (const slot of this.instance.players.values()) await this.store.save(slot.character)
  }

  private broadcast(message: Parameters<ServerTransport['send']>[0]): void {
    for (const transport of this.transports.keys()) transport.send(message)
  }
}
