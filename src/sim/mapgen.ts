import type { Rng } from './rng'
import { vec2, type Vec2 } from './vec2'
import type { AreaMap, MonsterArchetype, MonsterRarity, Rect } from './types'

const WALL = 0
const FLOOR = 1

export interface PackMemberPlan {
  archetype: MonsterArchetype
  rarity: MonsterRarity
  pos: Vec2
}

export interface PackPlan {
  id: number
  center: Vec2
  members: PackMemberPlan[]
}

export interface GeneratedArea {
  map: AreaMap
  packs: PackPlan[]
}

const MAP_WIDTH = 76
const MAP_HEIGHT = 76
const ROOM_ATTEMPTS = 60
const ROOM_MIN = 8
const ROOM_MAX = 15
const CORRIDOR_HALF_WIDTH = 1

export function tileIndex(map: AreaMap, tx: number, ty: number): number {
  return ty * map.width + tx
}

export function isFloor(map: AreaMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  return map.tiles[tileIndex(map, tx, ty)] === FLOOR
}

export function worldToTile(pos: Vec2): { tx: number; ty: number } {
  return { tx: Math.floor(pos.x), ty: Math.floor(pos.y) }
}

export function tileCenter(tx: number, ty: number): Vec2 {
  return vec2(tx + 0.5, ty + 0.5)
}

/** True when a circular body of `radius` fits at `pos` without clipping a wall. */
export function isWalkable(map: AreaMap, pos: Vec2, radius: number): boolean {
  const minX = Math.floor(pos.x - radius)
  const maxX = Math.floor(pos.x + radius)
  const minY = Math.floor(pos.y - radius)
  const maxY = Math.floor(pos.y + radius)
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (!isFloor(map, tx, ty)) return false
    }
  }
  return true
}

/** The caller owns the rng stream so an area is reproducible from the run seed. */
export function generateArea(rng: Rng, depth: number): GeneratedArea {
  const tiles = new Uint8Array(MAP_WIDTH * MAP_HEIGHT).fill(WALL)
  const map: AreaMap = {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles,
    spawn: vec2(0, 0),
    portal: vec2(0, 0),
    rooms: [],
  }

  const rooms = placeRooms(rng)
  map.rooms = rooms
  for (const room of rooms) carveRect(map, room)
  for (let i = 1; i < rooms.length; i++) carveCorridor(map, rooms[i - 1]!, rooms[i]!, rng)

  const first = rooms[0]!
  const last = rooms[rooms.length - 1]!
  map.spawn = rectCenter(first)
  map.portal = rectCenter(last)

  return { map, packs: planPacks(map, rooms, depth, rng) }
}

function placeRooms(rng: Rng): Rect[] {
  const rooms: Rect[] = []
  for (let attempt = 0; attempt < ROOM_ATTEMPTS; attempt++) {
    const w = rng.int(ROOM_MIN, ROOM_MAX)
    const h = rng.int(ROOM_MIN, ROOM_MAX)
    const x = rng.int(2, MAP_WIDTH - w - 3)
    const y = rng.int(2, MAP_HEIGHT - h - 3)
    const candidate: Rect = { x, y, w, h }
    if (rooms.some((r) => rectsOverlap(inflate(r, 2), candidate))) continue
    rooms.push(candidate)
  }
  // Walk them in a rough chain so corridors do not criss-cross the whole map.
  rooms.sort((a, b) => a.x + a.y - (b.x + b.y))
  return rooms
}

function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function rectCenter(rect: Rect): Vec2 {
  return vec2(rect.x + rect.w / 2, rect.y + rect.h / 2)
}

function carveRect(map: AreaMap, rect: Rect): void {
  for (let ty = rect.y; ty < rect.y + rect.h; ty++) {
    for (let tx = rect.x; tx < rect.x + rect.w; tx++) {
      map.tiles[tileIndex(map, tx, ty)] = FLOOR
    }
  }
}

function carveCorridor(map: AreaMap, from: Rect, to: Rect, rng: Rng): void {
  const a = rectCenter(from)
  const b = rectCenter(to)
  const horizontalFirst = rng.chance(0.5)
  const corner = horizontalFirst ? vec2(b.x, a.y) : vec2(a.x, b.y)
  carveLine(map, a, corner)
  carveLine(map, corner, b)
}

function carveLine(map: AreaMap, from: Vec2, to: Vec2): void {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y))
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps
    const cx = Math.floor(from.x + (to.x - from.x) * t)
    const cy = Math.floor(from.y + (to.y - from.y) * t)
    for (let dy = -CORRIDOR_HALF_WIDTH; dy <= CORRIDOR_HALF_WIDTH; dy++) {
      for (let dx = -CORRIDOR_HALF_WIDTH; dx <= CORRIDOR_HALF_WIDTH; dx++) {
        const tx = cx + dx
        const ty = cy + dy
        if (tx <= 0 || ty <= 0 || tx >= map.width - 1 || ty >= map.height - 1) continue
        map.tiles[tileIndex(map, tx, ty)] = FLOOR
      }
    }
  }
}

/**
 * Early areas are mostly swarm so the opening reads as easy; brutes phase in with
 * depth, which is where packs start needing to be handled rather than walked into.
 */
function archetypeWeights(depth: number): readonly { weight: number; value: MonsterArchetype }[] {
  return [
    { weight: 62, value: 'swarm' },
    { weight: 26, value: 'ranged' },
    { weight: Math.min(18, 4 + depth * 2), value: 'brute' },
  ]
}

function planPacks(map: AreaMap, rooms: readonly Rect[], depth: number, rng: Rng): PackPlan[] {
  const packs: PackPlan[] = []
  const spawnRoom = rooms[0]
  // One room holds the pack leader — a rare worth crossing the level for.
  const leaderRoomIndex = rooms.length > 2 ? rng.int(2, rooms.length - 1) : rooms.length - 1
  let packId = 1

  rooms.forEach((room, index) => {
    if (room === spawnRoom) return
    const packCount = rng.int(1, room.w * room.h > 120 ? 2 : 1)
    for (let p = 0; p < packCount; p++) {
      const center = randomPointIn(room, rng, 2)
      const size = rng.int(3, 5) + Math.min(3, Math.floor(depth / 3))
      const members: PackMemberPlan[] = []
      const isLeaderPack = index === leaderRoomIndex && p === 0

      const weights = archetypeWeights(depth)
      for (let m = 0; m < size; m++) {
        const archetype = rng.weighted(weights)
        const rarity: MonsterRarity = rng.chance(0.12) ? 'magic' : 'normal'
        members.push({ archetype, rarity, pos: scatterAround(center, rng, 2.6, map) })
      }
      if (isLeaderPack) {
        members.push({
          archetype: rng.chance(0.55) ? 'brute' : 'ranged',
          rarity: 'rare',
          pos: scatterAround(center, rng, 1.2, map),
        })
      }
      packs.push({ id: packId++, center, members })
    }
  })

  return packs
}

function randomPointIn(rect: Rect, rng: Rng, inset: number): Vec2 {
  return vec2(
    rng.float(rect.x + inset, rect.x + rect.w - inset),
    rng.float(rect.y + inset, rect.y + rect.h - inset),
  )
}

function scatterAround(center: Vec2, rng: Rng, spread: number, map: AreaMap): Vec2 {
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = rng.float(0, Math.PI * 2)
    const distance = rng.float(0.4, spread)
    const candidate = vec2(center.x + Math.cos(angle) * distance, center.y + Math.sin(angle) * distance)
    if (isWalkable(map, candidate, 0.6)) return candidate
  }
  return center
}
