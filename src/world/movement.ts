import { SOLIDS, type WorldPoint, type WorldSolid } from './world-data'
import { heightAt, riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from './terrain'

export const MAX_FRAME_DELTA = 0.1
const STEP_SECONDS = 1 / 60
export const WALK_SPEED = 2
export const RUN_SPEED = 5
export const SPRINT_SPEED = 7
export const GRAVITY = 9.81
export const JUMP_SPEED = 4.5
export const JUMP_PREPARATION_SECONDS = 0.18
const MAX_SLOPE_RADIANS = 35 * Math.PI / 180
const TIME_EPSILON = 1e-9

export type JumpPhase = 'grounded' | 'preparing' | 'ascending' | 'descending' | 'landing'

export interface Explorer extends WorldPoint {
  readonly y: number
  readonly groundY: number
  readonly radius: number
  readonly facing: number
  readonly grounded: boolean
  readonly verticalVelocity: number
  readonly jumpPhase: JumpPhase
  readonly jumpPreparationRemaining: number
}

export type Occupant = Pick<Explorer, 'x' | 'z' | 'radius'>

export interface MoveIntent extends WorldPoint {
  readonly sprint: boolean
  readonly walk?: boolean
  readonly jump?: boolean
}

export function createExplorer(at: WorldPoint): Explorer {
  const groundY = heightAt(at.x, at.z)
  return {
    ...at,
    y: groundY,
    groundY,
    radius: 0.72,
    facing: 0,
    grounded: true,
    verticalVelocity: 0,
    jumpPhase: 'grounded',
    jumpPreparationRemaining: 0,
  }
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

export function canOccupy(explorer: Occupant, x: number, z: number, solids = SOLIDS): boolean {
  if (!insideWorld(x, z, explorer.radius) || !outsideRiver(x, z, explorer.radius)) return false
  if (!outsideSolids(x, z, explorer.radius, solids)) return false
  const horizontal = Math.hypot(x - explorer.x, z - explorer.z)
  if (horizontal === 0) return true
  return Math.atan2(Math.abs(heightAt(x, z) - heightAt(explorer.x, explorer.z)), horizontal) <= MAX_SLOPE_RADIANS
}

function moveHorizontal(explorer: Explorer, intent: MoveIntent, seconds: number, solids: readonly WorldSolid[]): Explorer {
  const inputLength = Math.hypot(intent.x, intent.z)
  if (inputLength < 0.001) return explorer
  const speed = intent.sprint ? SPRINT_SPEED : intent.walk ? WALK_SPEED : RUN_SPEED
  const distance = speed * seconds
  const dx = intent.x / Math.max(1, inputLength) * distance
  const dz = intent.z / Math.max(1, inputLength) * distance
  let x = explorer.x
  let z = explorer.z
  if (canOccupy(explorer, x + dx, z + dz, solids)) {
    x += dx
    z += dz
  } else {
    if (canOccupy(explorer, x + dx, z, solids)) x += dx
    const xMoved = { ...explorer, x, groundY: heightAt(x, z) }
    if (canOccupy(xMoved, x, z + dz, solids)) z += dz
  }
  return { ...explorer, x, z, groundY: heightAt(x, z), facing: Math.atan2(dx, dz) }
}

function moveStep(
  explorer: Explorer,
  intent: MoveIntent,
  seconds: number,
  solids: readonly WorldSolid[],
  jump: boolean,
): Explorer {
  let next = moveHorizontal(explorer, intent, seconds, solids)
  let y = next.y
  let verticalVelocity = next.verticalVelocity
  let grounded = next.grounded
  let jumpPhase: JumpPhase = next.jumpPhase === 'landing' ? 'grounded' : next.jumpPhase
  let jumpPreparationRemaining = next.jumpPreparationRemaining
  let physicsSeconds = seconds

  if (jump && grounded && jumpPhase !== 'preparing') {
    jumpPhase = 'preparing'
    jumpPreparationRemaining = JUMP_PREPARATION_SECONDS
  }

  if (jumpPhase === 'preparing') {
    y = next.groundY
    verticalVelocity = 0
    grounded = true
    if (jumpPreparationRemaining - physicsSeconds > TIME_EPSILON) {
      jumpPreparationRemaining -= physicsSeconds
      physicsSeconds = 0
    } else {
      physicsSeconds = Math.max(0, physicsSeconds - jumpPreparationRemaining)
      jumpPreparationRemaining = 0
      grounded = false
      verticalVelocity = JUMP_SPEED
      jumpPhase = 'ascending'
    }
  }

  if (grounded) {
    y = next.groundY
    verticalVelocity = 0
  } else if (physicsSeconds > 0) {
    y += verticalVelocity * physicsSeconds - 0.5 * GRAVITY * physicsSeconds * physicsSeconds
    verticalVelocity -= GRAVITY * physicsSeconds
    if (y <= next.groundY) {
      y = next.groundY
      verticalVelocity = 0
      grounded = true
      jumpPhase = 'landing'
    } else {
      jumpPhase = verticalVelocity > 0 ? 'ascending' : 'descending'
    }
  }
  next = { ...next, y, verticalVelocity, grounded, jumpPhase, jumpPreparationRemaining }
  return next
}

export function moveExplorer(explorer: Explorer, intent: MoveIntent, delta: number, solids = SOLIDS): Explorer {
  let remaining = Math.min(Math.max(delta, 0), MAX_FRAME_DELTA)
  let next = explorer
  let jump = intent.jump === true
  let landed = false
  while (remaining > 0) {
    const step = Math.min(STEP_SECONDS, remaining)
    next = moveStep(next, intent, step, solids, jump)
    jump = false
    landed ||= next.jumpPhase === 'landing'
    remaining -= step
  }
  return landed ? { ...next, jumpPhase: 'landing' } : next
}
