import { SOLIDS, type WorldPoint, type WorldSolid } from './world-data'
import { heightAt, riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from './terrain'

export const MAX_FRAME_DELTA = 0.1
const STEP_SECONDS = 1 / 60
export const WALK_SPEED = 5.2
export const SPRINT_SPEED = 8
const MAX_SLOPE_RADIANS = 35 * Math.PI / 180

export interface Explorer extends WorldPoint {
  readonly y: number
  readonly radius: number
  readonly facing: number
}

export interface MoveIntent extends WorldPoint { readonly sprint: boolean }

export function createExplorer(at: WorldPoint): Explorer {
  return { ...at, y: heightAt(at.x, at.z), radius: 0.72, facing: 0 }
}

function insideWorld(x: number, z: number, radius: number): boolean {
  return x - radius >= WORLD_BOUNDS.minX && x + radius <= WORLD_BOUNDS.maxX
    && z - radius >= WORLD_BOUNDS.minZ && z + radius <= WORLD_BOUNDS.maxZ
}

function outsideRiver(x: number, z: number, radius: number): boolean {
  const center = riverCenterAt(z)
  const halfWidth = riverHalfWidthAt(z)
  return x + radius <= center - halfWidth || x - radius >= center + halfWidth
}

function outsideSolids(x: number, z: number, radius: number, solids: readonly WorldSolid[]): boolean {
  return solids.every((solid) => Math.hypot(x - solid.x, z - solid.z) >= radius + solid.radius)
}

export function canOccupy(explorer: Explorer, x: number, z: number, solids = SOLIDS): boolean {
  if (!insideWorld(x, z, explorer.radius) || !outsideRiver(x, z, explorer.radius)) return false
  if (!outsideSolids(x, z, explorer.radius, solids)) return false
  const horizontal = Math.hypot(x - explorer.x, z - explorer.z)
  if (horizontal === 0) return true
  return Math.atan2(Math.abs(heightAt(x, z) - explorer.y), horizontal) <= MAX_SLOPE_RADIANS
}

function moveStep(explorer: Explorer, intent: MoveIntent, seconds: number, solids: readonly WorldSolid[]): Explorer {
  const inputLength = Math.hypot(intent.x, intent.z)
  if (inputLength < 0.001) return explorer
  const distance = (intent.sprint ? SPRINT_SPEED : WALK_SPEED) * seconds
  const dx = intent.x / Math.max(1, inputLength) * distance
  const dz = intent.z / Math.max(1, inputLength) * distance
  let x = explorer.x
  let z = explorer.z
  if (canOccupy(explorer, x + dx, z + dz, solids)) {
    x += dx
    z += dz
  } else {
    if (canOccupy(explorer, x + dx, z, solids)) x += dx
    const xMoved = { ...explorer, x, y: heightAt(x, z) }
    if (canOccupy(xMoved, x, z + dz, solids)) z += dz
  }
  return { ...explorer, x, z, y: heightAt(x, z), facing: Math.atan2(dx, dz) }
}

export function moveExplorer(explorer: Explorer, intent: MoveIntent, delta: number, solids = SOLIDS): Explorer {
  let remaining = Math.min(Math.max(delta, 0), MAX_FRAME_DELTA)
  let next = explorer
  while (remaining > 0) {
    const step = Math.min(STEP_SECONDS, remaining)
    next = moveStep(next, intent, step, solids)
    remaining -= step
  }
  return next
}
