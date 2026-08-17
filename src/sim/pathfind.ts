import { isFloor, isWalkable, tileCenter, worldToTile } from './mapgen'
import { distance, vec2, type Vec2 } from './vec2'
import type { AreaMap } from './types'

/**
 * Passability depends on body radius, so it is cached per radius bucket and
 * rebuilt only when the area changes.
 */
export class NavGrid {
  private readonly cache = new Map<number, Uint8Array>()

  constructor(readonly map: AreaMap) {}

  private bucket(radius: number): number {
    return Math.min(3, Math.max(0, Math.round(radius * 4) - 1))
  }

  private maskFor(radius: number): Uint8Array {
    const bucket = this.bucket(radius)
    const existing = this.cache.get(bucket)
    if (existing) return existing
    const effectiveRadius = (bucket + 1) / 4
    const mask = new Uint8Array(this.map.width * this.map.height)
    for (let ty = 0; ty < this.map.height; ty++) {
      for (let tx = 0; tx < this.map.width; tx++) {
        mask[ty * this.map.width + tx] = isWalkable(this.map, tileCenter(tx, ty), effectiveRadius) ? 1 : 0
      }
    }
    this.cache.set(bucket, mask)
    return mask
  }

  passable(tx: number, ty: number, radius: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return false
    return this.maskFor(radius)[ty * this.map.width + tx] === 1
  }

  /** Nearest passable tile to a point, for targets that land inside geometry. */
  nearestPassable(pos: Vec2, radius: number, maxRings = 6): { tx: number; ty: number } | null {
    const { tx, ty } = worldToTile(pos)
    if (this.passable(tx, ty, radius)) return { tx, ty }
    for (let ring = 1; ring <= maxRings; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
          if (this.passable(tx + dx, ty + dy, radius)) return { tx: tx + dx, ty: ty + dy }
        }
      }
    }
    return null
  }
}

interface HeapNode {
  index: number
  priority: number
}

class MinHeap {
  private readonly items: HeapNode[] = []

  get size(): number {
    return this.items.length
  }

  push(node: HeapNode): void {
    this.items.push(node)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent]!.priority <= this.items[i]!.priority) break
      this.swap(parent, i)
      i = parent
    }
  }

  pop(): HeapNode | undefined {
    if (this.items.length === 0) return undefined
    const top = this.items[0]!
    const last = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let smallest = i
        if (left < this.items.length && this.items[left]!.priority < this.items[smallest]!.priority) smallest = left
        if (right < this.items.length && this.items[right]!.priority < this.items[smallest]!.priority) smallest = right
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a]!
    this.items[a] = this.items[b]!
    this.items[b] = tmp
  }
}

const STRAIGHT_COST = 1
const DIAGONAL_COST = Math.SQRT2
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, STRAIGHT_COST],
  [-1, 0, STRAIGHT_COST],
  [0, 1, STRAIGHT_COST],
  [0, -1, STRAIGHT_COST],
  [1, 1, DIAGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
]

export const MAX_PATH_NODES = 6000

/**
 * 8-directional A*. Diagonals are refused when either orthogonal neighbour is
 * blocked, so bodies never squeeze through a corner they visually cannot.
 */
export function findPath(nav: NavGrid, from: Vec2, to: Vec2, radius: number): Vec2[] | null {
  const map = nav.map
  const start = nav.nearestPassable(from, radius)
  const goal = nav.nearestPassable(to, radius)
  if (!start || !goal) return null

  const width = map.width
  const startIndex = start.ty * width + start.tx
  const goalIndex = goal.ty * width + goal.tx
  if (startIndex === goalIndex) return [clampToTile(to, goal.tx, goal.ty)]

  const cameFrom = new Int32Array(width * map.height).fill(-1)
  const gScore = new Float32Array(width * map.height).fill(Infinity)
  const closed = new Uint8Array(width * map.height)
  const open = new MinHeap()

  gScore[startIndex] = 0
  open.push({ index: startIndex, priority: heuristic(start.tx, start.ty, goal.tx, goal.ty) })

  let expanded = 0
  while (open.size > 0 && expanded < MAX_PATH_NODES) {
    const current = open.pop()!
    if (closed[current.index] === 1) continue
    closed[current.index] = 1
    expanded++

    if (current.index === goalIndex) {
      return smooth(nav, reconstruct(cameFrom, startIndex, goalIndex, width), radius, from, to)
    }

    const cx = current.index % width
    const cy = (current.index - cx) / width
    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!nav.passable(nx, ny, radius)) continue
      if (dx !== 0 && dy !== 0) {
        if (!nav.passable(cx + dx, cy, radius) || !nav.passable(cx, cy + dy, radius)) continue
      }
      const neighbourIndex = ny * width + nx
      if (closed[neighbourIndex] === 1) continue
      const tentative = gScore[current.index]! + cost
      if (tentative >= gScore[neighbourIndex]!) continue
      gScore[neighbourIndex] = tentative
      cameFrom[neighbourIndex] = current.index
      open.push({ index: neighbourIndex, priority: tentative + heuristic(nx, ny, goal.tx, goal.ty) })
    }
  }

  return null
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx)
  const dy = Math.abs(ay - by)
  return STRAIGHT_COST * (dx + dy) + (DIAGONAL_COST - 2 * STRAIGHT_COST) * Math.min(dx, dy)
}

function reconstruct(cameFrom: Int32Array, startIndex: number, goalIndex: number, width: number): Vec2[] {
  const tiles: Vec2[] = []
  let index = goalIndex
  while (index !== -1 && index !== startIndex) {
    const tx = index % width
    const ty = (index - tx) / width
    tiles.push(tileCenter(tx, ty))
    index = cameFrom[index]!
  }
  tiles.reverse()
  return tiles
}

/**
 * Drop waypoints the body can skip in a straight line — removes the staircase.
 * Anchored on the actor's real position for the first segment: anchoring on the
 * first tile centre instead can emit an opening waypoint the actor cannot reach,
 * which leaves it grinding against a wall.
 */
function smooth(nav: NavGrid, tiles: Vec2[], radius: number, from: Vec2, finalTarget: Vec2): Vec2[] {
  if (tiles.length === 0) return tiles
  const last = tiles[tiles.length - 1]!
  if (isWalkable(nav.map, finalTarget, radius) && distance(last, finalTarget) < 2) {
    tiles[tiles.length - 1] = finalTarget
  }

  const out: Vec2[] = []
  let anchorPoint = from
  let index = 0
  while (index < tiles.length) {
    let furthest = -1
    for (let probe = tiles.length - 1; probe >= index; probe--) {
      if (hasLineOfWalk(nav, anchorPoint, tiles[probe]!, radius)) {
        furthest = probe
        break
      }
    }
    // Nothing ahead is directly reachable: keep the next tile so the actor at
    // least steps onto the grid path instead of stalling.
    if (furthest === -1) furthest = index

    out.push(tiles[furthest]!)
    anchorPoint = tiles[furthest]!
    index = furthest + 1
  }
  return out
}

export function hasLineOfWalk(nav: NavGrid, from: Vec2, to: Vec2, radius: number): boolean {
  const steps = Math.ceil(distance(from, to) * 3)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const point = vec2(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    if (!isWalkable(nav.map, point, radius)) return false
  }
  return true
}

/** Cheap sight test used for aggro and ranged attacks: ignores body radius. */
export function hasLineOfSight(map: AreaMap, from: Vec2, to: Vec2): boolean {
  const steps = Math.ceil(distance(from, to) * 3)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = from.x + (to.x - from.x) * t
    const y = from.y + (to.y - from.y) * t
    if (!isFloor(map, Math.floor(x), Math.floor(y))) return false
  }
  return true
}

function clampToTile(pos: Vec2, tx: number, ty: number): Vec2 {
  return vec2(Math.min(Math.max(pos.x, tx + 0.05), tx + 0.95), Math.min(Math.max(pos.y, ty + 0.05), ty + 0.95))
}
