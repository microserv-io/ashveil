export interface Direction3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

const MAX_LOOK_ELEVATION = 1.45
const HORIZONTAL_EPSILON = 1e-8

export function elevateLookDirection(towardTarget: Direction3, upwardRadians: number, fallbackYaw: number): Direction3 {
  const horizontalLength = Math.hypot(towardTarget.x, towardTarget.z)
  const horizontalX = horizontalLength > HORIZONTAL_EPSILON
    ? towardTarget.x / horizontalLength
    : -Math.sin(fallbackYaw)
  const horizontalZ = horizontalLength > HORIZONTAL_EPSILON
    ? towardTarget.z / horizontalLength
    : -Math.cos(fallbackYaw)
  const elevation = Math.min(
    MAX_LOOK_ELEVATION,
    Math.atan2(towardTarget.y, horizontalLength) + Math.max(0, upwardRadians),
  )
  const horizontalScale = Math.cos(elevation)
  return {
    x: horizontalX * horizontalScale,
    y: Math.sin(elevation),
    z: horizontalZ * horizontalScale,
  }
}
