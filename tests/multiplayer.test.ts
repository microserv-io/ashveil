import { describe, expect, it } from 'vitest'
import { createLoopback, type ServerMessage } from '../src/net/protocol'
import { GameSession, MemoryCharacterStore } from '../src/session/session'
import { createCharacter } from '../src/sim/character'
import { startingGear } from '../src/sim/loot'
import { Rng } from '../src/sim/rng'
import { Sim } from '../src/sim/sim'
import { decodeSnapshot, encodeSnapshot } from '../src/sim/snapshot'
import { TICK_RATE } from '../src/sim/types'

function character(id: string, seed = 1) {
  return createCharacter(id, id, startingGear(new Rng(seed)))
}

describe('an instance holds more than one player', () => {
  it('seats several characters, each with their own actor', () => {
    const sim = new Sim({ seed: 3, characters: [character('a'), character('b')] })
    expect(sim.players.size).toBe(2)
    const [first, second] = [...sim.players.values()]
    expect(first!.actorId).not.toBe(second!.actorId)
    expect(sim.playerActors()).toHaveLength(2)
  })

  it('routes each player\'s commands to their own actor', () => {
    const sim = new Sim({ seed: 3, characters: [character('a'), character('b')] })
    const [a, b] = [...sim.players.keys()]
    const actorA = sim.actorOf(a!)!
    const actorB = sim.actorOf(b!)!
    const startB = { ...actorB.pos }

    for (let i = 0; i < 30; i++) {
      sim.submit({ playerId: a!, sequence: i, intent: { kind: 'move_direction', direction: { x: 1, y: 0 } } })
      sim.tick()
    }
    expect(actorA.pos.x).toBeGreaterThan(startB.x - 100)
    // B was never commanded, so B never moved.
    expect(actorB.pos).toEqual(startB)
  })

  it('records the last sequence per player, which is what prediction reconciles to', () => {
    const sim = new Sim({ seed: 3, characters: [character('a')] })
    const id = [...sim.players.keys()][0]!
    sim.submit({ playerId: id, sequence: 41, intent: { kind: 'stop' } })
    sim.tick()
    expect(sim.slot(id)!.lastSequence).toBe(41)
  })

  it('pays experience to whoever landed the killing blow', () => {
    const sim = new Sim({ seed: 3, characters: [character('a'), character('b')] })
    const [a, b] = [...sim.players.keys()]
    const monster = sim.monsters()[0]!

    monster.lastDamageFrom = b!
    monster.life = -1
    sim.tick()

    expect(sim.characterOf(b!)!.xp).toBeGreaterThan(0)
    expect(sim.characterOf(a!)!.xp).toBe(0)
  })

  it('names the player an event concerns', () => {
    const sim = new Sim({ seed: 3, characters: [character('a'), character('b')] })
    const b = [...sim.players.keys()][1]!
    const monster = sim.monsters()[0]!
    monster.lastDamageFrom = b
    monster.life = -1
    sim.tick()

    const xp = sim.events.find((event) => event.kind === 'xp_gained')
    expect(xp?.subject).toBe(b)
  })

  it('lets a player leave without disturbing the rest', () => {
    const sim = new Sim({ seed: 3, characters: [character('a'), character('b')] })
    const [a, b] = [...sim.players.keys()]
    const returned = sim.removePlayer(a!)

    expect(returned?.id).toBe('a')
    expect(sim.players.size).toBe(1)
    expect(sim.actorOf(b!)).toBeDefined()
    expect(() => sim.tick()).not.toThrow()
  })
})

describe('snapshots', () => {
  it('round-trip through JSON, so nothing unserialisable is in replicated state', () => {
    const sim = new Sim({ seed: 9, characters: [character('a')] })
    for (let i = 0; i < 200; i++) sim.tick()

    const encoded = encodeSnapshot(sim.snapshot())
    const restored = Sim.restore(decodeSnapshot(encoded))

    expect(restored.tickCount).toBe(sim.tickCount)
    expect(restored.monstersKilled).toBe(sim.monstersKilled)
    expect(restored.players.size).toBe(sim.players.size)
    expect(restored.actors.length).toBe(sim.actors.length)
    expect(restored.player.pos).toEqual(sim.player.pos)
  })

  it('carry a seed rather than a map, and regenerate identical geometry', () => {
    const sim = new Sim({ seed: 11, characters: [character('a')] })
    const snapshot = sim.snapshot()
    expect('map' in snapshot).toBe(false)
    expect('tiles' in snapshot).toBe(false)

    const restored = Sim.restore(snapshot)
    expect(restored.map.tiles).toEqual(sim.map.tiles)
    expect(restored.map.portal).toEqual(sim.map.portal)
  })

  it('continue deterministically from the restored point', () => {
    const sim = new Sim({ seed: 21, characters: [character('a')] })
    for (let i = 0; i < 120; i++) sim.tick()

    const restored = Sim.restore(decodeSnapshot(encodeSnapshot(sim.snapshot())))
    for (let i = 0; i < 120; i++) {
      sim.tick()
      restored.tick()
    }
    expect(restored.player.pos).toEqual(sim.player.pos)
    expect(restored.rng.state).toBe(sim.rng.state)
    expect(restored.monstersKilled).toBe(sim.monstersKilled)
  })

  it('refuse a snapshot from a different version', () => {
    const sim = new Sim({ seed: 1, characters: [character('a')] })
    const snapshot = { ...sim.snapshot(), version: 999 }
    expect(() => Sim.restore(snapshot)).toThrow(/version/)
  })
})

describe('prediction stays deterministic', () => {
  it('a predicted tick never draws from the RNG', () => {
    const sim = new Sim({ seed: 5, characters: [character('a')] })
    const before = sim.rng.state
    for (let i = 0; i < 60; i++) {
      sim.queue({ kind: 'move_direction', direction: { x: 1, y: 0 } })
      sim.queue({ kind: 'use_skill', skill: 'cleave', aim: { x: 5, y: 5 } })
      // Throws rather than desyncs if any predicted system rolls.
      expect(() => sim.tick('predicted')).not.toThrow()
    }
    expect(sim.rng.state).toBe(before)
  })

  it('still moves the player, which is the whole point of predicting', () => {
    const sim = new Sim({ seed: 5, characters: [character('a')] })
    const start = { ...sim.player.pos }
    for (let i = 0; i < 40; i++) {
      sim.queue({ kind: 'move_direction', direction: { x: 1, y: 0 } })
      sim.tick('predicted')
    }
    expect(sim.player.pos.x).toBeGreaterThan(start.x)
  })

  it('leaves outcomes to the server: no damage, deaths or loot are predicted', () => {
    const sim = new Sim({ seed: 5, characters: [character('a')] })
    const monster = sim.monsters()[0]!
    sim.player.pos = { x: monster.pos.x - 1, y: monster.pos.y }
    const life = monster.life

    for (let i = 0; i < 60; i++) {
      sim.queue({ kind: 'use_skill', skill: 'cleave', aim: monster.pos })
      sim.tick('predicted')
    }
    expect(monster.life).toBe(life)
    expect(sim.groundItems).toHaveLength(0)
  })
})

describe('session over a transport', () => {
  it('seats a joining client and hands it the world', async () => {
    const session = new GameSession({ seed: 4, store: new MemoryCharacterStore() })
    const { client, server } = createLoopback()
    session.connect(server)

    const received: ServerMessage[] = []
    client.receive((message) => received.push(message))
    client.send({ kind: 'join', character: character('a') })

    const welcome = received.find((message) => message.kind === 'welcome')
    expect(welcome).toBeDefined()
    expect(session.instance.players.size).toBe(1)
    expect(welcome?.kind === 'welcome' && welcome.snapshot.seed).toBe(4)
  })

  it('applies commands that arrive over the wire', () => {
    const session = new GameSession({ seed: 4 })
    const { client, server } = createLoopback()
    session.connect(server)

    const received: ServerMessage[] = []
    client.receive((message) => received.push(message))
    client.send({ kind: 'join', character: character('a') })

    const welcome = received.find((m) => m.kind === 'welcome')!
    const playerId = welcome.kind === 'welcome' ? welcome.playerId : 0
    const start = { ...session.instance.actorOf(playerId)!.pos }

    for (let i = 0; i < 40; i++) {
      client.send({
        kind: 'command',
        command: { playerId, sequence: i, intent: { kind: 'move_direction', direction: { x: 1, y: 0 } } },
      })
      session.tick()
    }
    expect(session.instance.actorOf(playerId)!.pos.x).toBeGreaterThan(start.x)
  })

  it('broadcasts snapshots with the last sequence it acknowledged', () => {
    const session = new GameSession({ seed: 4, snapshotInterval: 1 })
    const { client, server } = createLoopback()
    session.connect(server)

    const received: ServerMessage[] = []
    client.receive((message) => received.push(message))
    client.send({ kind: 'join', character: character('a') })
    const welcome = received.find((m) => m.kind === 'welcome')!
    const playerId = welcome.kind === 'welcome' ? welcome.playerId : 0

    client.send({ kind: 'command', command: { playerId, sequence: 7, intent: { kind: 'stop' } } })
    session.tick()

    const snapshot = received.filter((message) => message.kind === 'snapshot').at(-1)
    expect(snapshot?.kind === 'snapshot' && snapshot.acknowledged).toContainEqual([playerId, 7])
  })

  it('saves a character when its player leaves', async () => {
    const store = new MemoryCharacterStore()
    const session = new GameSession({ seed: 4, store })
    const playerId = session.join(character('keeper'))
    session.instance.characterOf(playerId)!.xp = 4242

    session.leave(playerId)
    await Promise.resolve()

    expect((await store.load('keeper'))?.xp).toBe(4242)
  })

  it('runs a full loop end to end and makes progress', () => {
    const session = new GameSession({ seed: 8 })
    session.join(character('a'))
    for (let i = 0; i < 20 * TICK_RATE; i++) session.tick()
    expect(session.instance.tickCount).toBe(20 * TICK_RATE)
    expect(session.instance.player.dead).toBe(false)
  })
})
