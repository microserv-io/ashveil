import type { Character } from '../sim/character'
import type { InstanceSnapshot } from '../sim/snapshot'
import type { PlayerCommand, PlayerId, SimEvent } from '../sim/types'

/**
 * The wire. Everything here is already plain data because the sim's command and
 * event types were designed to be — there is no separate "network model" to keep
 * in step with the game one.
 */

export type ClientMessage =
  | { kind: 'join'; character: Character }
  | { kind: 'command'; command: PlayerCommand }
  | { kind: 'leave'; playerId: PlayerId }

export type ServerMessage =
  /** Your seat and the world as it stands. A late joiner needs nothing else. */
  | { kind: 'welcome'; playerId: PlayerId; snapshot: InstanceSnapshot }
  /**
   * Authoritative state. `acknowledged` is the last command sequence the server
   * processed per player, which is what a client rewinds and replays against.
   */
  | { kind: 'snapshot'; snapshot: InstanceSnapshot; acknowledged: [PlayerId, number][] }
  | { kind: 'events'; tick: number; events: SimEvent[] }
  | { kind: 'player_left'; playerId: PlayerId }

/**
 * Send and receive, and nothing else. Loopback for single-player and the listen
 * server, Steam sockets for the native build, WebSocket for a dedicated server —
 * the game never learns which it got.
 */
export interface Transport<Inbound, Outbound> {
  send(message: Outbound): void
  /** Returns an unsubscribe function. */
  receive(handler: (message: Inbound) => void): () => void
  close(): void
}

export type ClientTransport = Transport<ServerMessage, ClientMessage>
export type ServerTransport = Transport<ClientMessage, ServerMessage>

/**
 * Single-player is not a special case — it is a one-player session talking to a
 * server in the same process. Keeping even that on a transport is what stops a
 * separate single-player code path growing.
 */
export function createLoopback(): { client: ClientTransport; server: ServerTransport } {
  const toClient = new Set<(message: ServerMessage) => void>()
  const toServer = new Set<(message: ClientMessage) => void>()

  return {
    client: {
      send: (message) => toServer.forEach((handler) => handler(message)),
      receive: (handler) => {
        toClient.add(handler)
        return () => toClient.delete(handler)
      },
      close: () => toClient.clear(),
    },
    server: {
      send: (message) => toClient.forEach((handler) => handler(message)),
      receive: (handler) => {
        toServer.add(handler)
        return () => toServer.delete(handler)
      },
      close: () => toServer.clear(),
    },
  }
}
