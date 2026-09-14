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

const NEUTRAL_INJECTED_MOVEMENT: InjectedMovement = { x: 0, z: 0, sprint: false }

export function suspendInjectedMovement(current: InjectedMovement, suspended: boolean): InjectedMovement {
  return suspended ? NEUTRAL_INJECTED_MOVEMENT : current
}

export function advanceExplorer(
  explorer: Explorer,
  controls: InputFrame,
  cameraForward: WorldPoint,
  intendedCameraFacing: number,
  injected: InjectedMovement,
  delta: number,
): WorldControlResult {
  if (keyboardSteeringActive(controls)) {
    const mouseSteering = controls.mouseSteering === true
    const freeLook = controls.freeLook === true
    const alignToCamera = mouseSteering || controls.mouseSteeringPending === true
    const steering = steerExplorer(alignToCamera ? { ...explorer, facing: intendedCameraFacing } : explorer, {
      forward: controls.mouseForward ? 1 : controls.keyboardForward,
      strafe: controls.keyboardStrafe - (mouseSteering ? controls.keyboardTurn : 0),
      turn: mouseSteering ? 0 : controls.keyboardTurn,
      sprint: controls.sprint,
      walk: controls.walk,
      jump: controls.jump,
    }, delta)
    return { explorer: steering.explorer, turnDelta: mouseSteering || freeLook ? 0 : steering.turnDelta }
  }
  if (controls.mouseSteering || controls.mouseSteeringPending) {
    const steering = steerExplorer({ ...explorer, facing: intendedCameraFacing }, {
      forward: controls.mouseForward ? 1 : 0,
      strafe: 0,
      turn: 0,
      sprint: controls.sprint,
      walk: controls.walk,
      jump: controls.jump,
    }, delta)
    return { explorer: steering.explorer, turnDelta: 0 }
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
