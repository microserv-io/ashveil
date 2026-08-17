import { describe, expect, it } from 'vitest'
import { GameSession, MemoryCharacterStore } from '../src/session/session'
import { canExchangeItems, createCharacter, isBound } from '../src/sim/character'
import { Sim } from '../src/sim/sim'
import { ZONE_RULES, type ZoneKind } from '../src/sim/types'

/**
 * The structural half of an economy. Trade does not exist yet and none of this
 * makes it exist — these are the things that cannot be added afterwards, because
 * by then there are already items in circulation whose history nobody recorded.
 */

describe('item identity', () => {
  it('is unique per instance and never collides across instances in one process', () => {
    // Regression: a module-global counter used to hand out ids, so two instances
    // in the same process shared a sequence and ids depended on construction order.
    const a = new Sim({ seed: 1 })
    const b = new Sim({ seed: 1 })

    const aIds = a.progress.inventory.concat(Object.values(a.progress.equipment)).map((item) => item.id)
    const bIds = b.progress.inventory.concat(Object.values(b.progress.equipment)).map((item) => item.id)

    expect(aIds.length).toBeGreaterThan(0)
    // Same seed, same instance id, so the same run reproduces the same ids.
    expect(aIds).toEqual(bIds)
    expect(new Set(aIds).size).toBe(aIds.length)
  })

  it('distinguishes items minted by different instances', () => {
    const a = new Sim({ seed: 1, instanceId: 'shard-a' })
    const b = new Sim({ seed: 1, instanceId: 'shard-b' })
    const first = Object.values(a.progress.equipment)[0]!
    const second = Object.values(b.progress.equipment)[0]!
    expect(first.id).not.toBe(second.id)
  })

  it('records where every item came from', () => {
    const sim = new Sim({ seed: 3 })
    const starting = Object.values(sim.progress.equipment)[0]!
    expect(starting.origin.source).toBe('starting-gear')
    expect(starting.origin.instanceId).toBe(sim.instanceId)

    const monster = sim.monsters()[0]!
    monster.lastDamageFrom = sim.localPlayerId
    monster.life = -1
    // Kill things until something drops, then check it can be traced to the kill.
    for (let i = 0; i < 400 && sim.groundItems.length === 0; i++) {
      const next = sim.monsters().find((m) => !m.dead)
      if (next) {
        next.lastDamageFrom = sim.localPlayerId
        next.life = -1
      }
      sim.tick()
    }
    const dropped = sim.groundItems[0]
    expect(dropped).toBeDefined()
    expect(dropped!.item.origin.source).toMatch(/^drop:/)
    expect(dropped!.item.origin.tick).toBeGreaterThan(0)
  })
})

describe('binding', () => {
  it('leaves items unbound while nothing trades', () => {
    const sim = new Sim({ seed: 3 })
    const item = Object.values(sim.progress.equipment)[0]!
    expect(item.binding).toBe('none')
    expect(isBound(item)).toBe(false)
  })

  it('recognises a bound item once one exists', () => {
    const sim = new Sim({ seed: 3 })
    const item = Object.values(sim.progress.equipment)[0]!
    expect(isBound({ ...item, binding: 'account' })).toBe(true)
  })
})

describe('character realms', () => {
  it('defaults to offline, which never touches an economy', () => {
    expect(createCharacter('a', 'A').realm).toBe('offline')
  })

  it('refuses to exchange items unless both sides are online', () => {
    const online = createCharacter('a', 'A', [], 'online')
    const offline = createCharacter('b', 'B', [], 'offline')

    expect(canExchangeItems(online, createCharacter('c', 'C', [], 'online'))).toBe(true)
    // The simplest dupe there is: items minted on a machine the player controls.
    expect(canExchangeItems(offline, online)).toBe(false)
    expect(canExchangeItems(online, offline)).toBe(false)
  })

  it('refuses to store a character in the wrong realm', async () => {
    const store = new MemoryCharacterStore('offline')
    await expect(store.save(createCharacter('a', 'A', [], 'online'))).rejects.toThrow(/refusing/)
    await expect(store.save(createCharacter('b', 'B', [], 'offline'))).resolves.toBeUndefined()
  })
})

describe('zones', () => {
  it('puts strangers in hubs and nowhere else', () => {
    expect(ZONE_RULES.hub.population).toBe('shared')
    expect(ZONE_RULES.overworld.population).toBe('party')
    expect(ZONE_RULES.dungeon.population).toBe('party')
  })

  it('keeps every fight at a known party size', () => {
    for (const kind of ['overworld', 'dungeon'] as ZoneKind[]) {
      expect(ZONE_RULES[kind].combat).toBe(true)
      expect(ZONE_RULES[kind].maxPlayers).toBeLessThanOrEqual(4)
    }
  })

  it('crosses into hub and overworld seamlessly, and gates dungeons', () => {
    expect(ZONE_RULES.hub.entry).toBe('seamless')
    expect(ZONE_RULES.overworld.entry).toBe('seamless')
    expect(ZONE_RULES.dungeon.entry).toBe('portal')
  })

  it('spawns no monsters in a hub', () => {
    const hub = new Sim({ seed: 3, zone: 'hub' })
    expect(hub.monsters()).toHaveLength(0)
    expect(hub.areaMonsterCount).toBe(0)
  })

  it('never reports a hub as cleared, however long it runs', () => {
    const hub = new Sim({ seed: 3, zone: 'hub' })
    for (let i = 0; i < 300; i++) hub.tick()
    expect(hub.areaCleared).toBe(false)
    expect(hub.events.some((event) => event.kind === 'area_cleared')).toBe(false)
  })

  it('refuses to descend from a zone that leads nowhere', () => {
    const hub = new Sim({ seed: 3, zone: 'hub' })
    hub.player.pos = { ...hub.map.portal }
    hub.queue({ kind: 'enter_portal' })
    hub.tick()
    expect(hub.depth).toBe(1)
  })

  it('still fights and clears in a dungeon', () => {
    const dungeon = new Sim({ seed: 3, zone: 'dungeon' })
    expect(dungeon.monsters().length).toBeGreaterThan(0)
    expect(dungeon.rules.clearable).toBe(true)
  })

  it('seats strangers in a hub up to its limit', () => {
    const session = new GameSession({ seed: 3, zone: 'hub' })
    for (let i = 0; i < ZONE_RULES.hub.maxPlayers; i++) {
      session.join(createCharacter(`p${i}`, `P${i}`))
    }
    expect(session.instance.players.size).toBe(ZONE_RULES.hub.maxPlayers)
    expect(() => session.join(createCharacter('overflow', 'Overflow'))).toThrow(/full/)
  })

  it('holds a dungeon to a party', () => {
    const session = new GameSession({ seed: 3, zone: 'dungeon' })
    for (let i = 0; i < ZONE_RULES.dungeon.maxPlayers; i++) {
      session.join(createCharacter(`p${i}`, `P${i}`))
    }
    expect(() => session.join(createCharacter('fifth', 'Fifth'))).toThrow(/full/)
  })

  it('carries the zone through a snapshot', () => {
    const hub = new Sim({ seed: 3, zone: 'hub' })
    const restored = Sim.restore(hub.snapshot())
    expect(restored.zone).toBe('hub')
    expect(restored.monsters()).toHaveLength(0)
  })
})
