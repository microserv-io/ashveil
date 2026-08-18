import * as THREE from 'three'
import { isFloor } from '../sim/mapgen'
import type { AreaMap } from '../sim/types'
import { instancedModel } from './models'

/**
 * Turns an `AreaMap` into dungeon geometry.
 *
 * The sim's grid is a collision grid, so walls follow it tile by tile or the world
 * lies about where you can walk. The floor has no such duty and is laid on a coarser
 * grid: one model per sim tile costs 16x the triangles for nothing anyone can see.
 */

/** Floor models span this many sim tiles. Walls hide the overhang at room edges. */
const FLOOR_SPAN = 2
/** The kit's models are built on a 4-unit tile. */
const MODEL_SPAN = 4
const WALL_HEIGHT = 2.4
/** Longest wall model run, in sim tiles, before a new segment starts. */
const MAX_RUN = MODEL_SPAN

type Facing = 'north' | 'south' | 'east' | 'west'

/** Rotation that turns the model's carved face toward the floor it borders. */
const FACE_ROTATION: Record<Facing, number> = {
  north: 0,
  south: Math.PI,
  west: -Math.PI / 2,
  east: Math.PI / 2,
}

const NEIGHBOUR: Record<Facing, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
}

export function buildTerrain(map: AreaMap): THREE.Group {
  const group = new THREE.Group()
  group.add(buildFloor(map))
  group.add(buildWalls(map))
  return group
}

function buildFloor(map: AreaMap): THREE.Group {
  const plain: THREE.Matrix4[] = []
  const rocky: THREE.Matrix4[] = []
  const scale = FLOOR_SPAN / MODEL_SPAN

  for (let by = 0; by < map.height; by += FLOOR_SPAN) {
    for (let bx = 0; bx < map.width; bx += FLOOR_SPAN) {
      if (!blockHasFloor(map, bx, by)) continue
      const placement = new THREE.Matrix4().compose(
        new THREE.Vector3(bx + FLOOR_SPAN / 2, 0, by + FLOOR_SPAN / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      )
      // A scatter of the rocky variant stops a large room reading as graph paper.
      ;(hash2(bx, by) > 0.86 ? rocky : plain).push(placement)
    }
  }

  const group = new THREE.Group()
  // A flat floor casts no shadow worth seeing, and casting doubles what it costs.
  group.add(instancedModel('floor', plain, false))
  group.add(instancedModel('floor_rocks', rocky, false))
  return group
}

/**
 * Walls are emitted as runs rather than per tile: the model carries four tiles of
 * carved detail, so stamping it on every tile repeats that detail four times over
 * and reads as corrugation.
 */
function buildWalls(map: AreaMap): THREE.Group {
  const placements: THREE.Matrix4[] = []
  for (const facing of ['north', 'south', 'east', 'west'] as const) {
    placements.push(...runsFacing(map, facing))
  }
  return instancedModel('wall', placements, true)
}

function runsFacing(map: AreaMap, facing: Facing): THREE.Matrix4[] {
  const along: Facing[] = facing === 'north' || facing === 'south' ? ['east', 'west'] : ['north', 'south']
  const [stepX, stepY] = NEIGHBOUR[along[0]!]!
  const placements: THREE.Matrix4[] = []
  const claimed = new Set<string>()

  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (!facesFloor(map, tx, ty, facing) || claimed.has(`${tx},${ty}`)) continue

      let length = 0
      while (
        length < MAX_RUN &&
        facesFloor(map, tx + stepX * length, ty + stepY * length, facing) &&
        !claimed.has(`${tx + stepX * length},${ty + stepY * length}`)
      ) {
        claimed.add(`${tx + stepX * length},${ty + stepY * length}`)
        length++
      }

      const centreX = tx + 0.5 + (stepX * (length - 1)) / 2
      const centreY = ty + 0.5 + (stepY * (length - 1)) / 2
      placements.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(centreX, 0, centreY),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACE_ROTATION[facing]),
          // X spans the run, Z fills one tile of depth, Y is the game's wall height.
          new THREE.Vector3(length / MODEL_SPAN, WALL_HEIGHT / MODEL_SPAN, 1),
        ),
      )
    }
  }
  return placements
}

/** A wall tile whose neighbour on `facing` is walkable, so this side is seen. */
function facesFloor(map: AreaMap, tx: number, ty: number, facing: Facing): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  if (isFloor(map, tx, ty)) return false
  const [dx, dy] = NEIGHBOUR[facing]
  return isFloor(map, tx + dx, ty + dy)
}

function blockHasFloor(map: AreaMap, bx: number, by: number): boolean {
  for (let dy = 0; dy < FLOOR_SPAN; dy++) {
    for (let dx = 0; dx < FLOOR_SPAN; dx++) if (isFloor(map, bx + dx, by + dy)) return true
  }
  return false
}

/** Stable 0..1 value per tile, so terrain looks the same on every replay. */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}
