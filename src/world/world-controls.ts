import { keyboardSteeringActive, type InputFrame } from './input'
import { moveExplorer, type Explorer } from './movement'
import { steerExplorer } from './steering'
import type { WorldPoint } from './world-data'

export interface InjectedMovement extends WorldPoint {
  readonly sprint: boolean
  readonly walk?: boolean
}

export interface WorldControlResult {
  readonly explorer: Explorer
  readonly turnDelta: number
}

export function advanceExplorer(
  explorer: Explorer,
  controls: InputFrame,
  cameraForward: WorldPoint,
  injected: InjectedMovement,
  delta: number,
): WorldControlResult {
  if (keyboardSteeringActive(controls)) {
    return steerExplorer(explorer, {
      forward: controls.keyboardForward,
      strafe: controls.keyboardStrafe,
      turn: controls.keyboardTurn,
      sprint: controls.sprint,
      walk: controls.walk,
      jump: controls.jump,
    }, delta)
  }
  const right = { x: -cameraForward.z, z: cameraForward.x }
  const localRight = controls.touchRight + injected.x
  const localForward = controls.touchForward + injected.z
  return {
    explorer: moveExplorer(explorer, {
      x: right.x * localRight + cameraForward.x * localForward,
      z: right.z * localRight + cameraForward.z * localForward,
      sprint: controls.sprint || injected.sprint,
      walk: controls.walk || injected.walk,
      jump: controls.jump,
    }, delta),
    turnDelta: 0,
  }
}
