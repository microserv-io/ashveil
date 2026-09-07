import { MAX_FRAME_DELTA, moveExplorer, type Explorer } from './movement'
import type { WorldSolid } from './world-data'

export const TURN_SPEED = 2 * Math.PI / 3

export interface KeyboardSteering {
  readonly forward: number
  readonly strafe: number
  readonly turn: number
  readonly sprint: boolean
}

export interface SteeringResult {
  readonly explorer: Explorer
  readonly turnDelta: number
}

export function steerExplorer(
  explorer: Explorer,
  input: KeyboardSteering,
  delta: number,
  solids?: readonly WorldSolid[],
): SteeringResult {
  const seconds = Math.min(Math.max(delta, 0), MAX_FRAME_DELTA)
  const turnDelta = input.turn * TURN_SPEED * seconds
  const facing = wrapAngle(explorer.facing + turnDelta)
  const sin = Math.sin(facing)
  const cos = Math.cos(facing)
  const moved = moveExplorer(
    { ...explorer, facing },
    {
      x: sin * input.forward - cos * input.strafe,
      z: cos * input.forward + sin * input.strafe,
      sprint: input.sprint,
    },
    seconds,
    solids,
  )
  return { explorer: { ...moved, facing }, turnDelta }
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function explorerFacingFromCamera(cameraYaw: number): number {
  return wrapAngle(cameraYaw + Math.PI)
}
