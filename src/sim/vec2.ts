/**
 * The sim is 2D on the ground plane: x east, y north. The renderer maps sim y
 * onto three.js z and keeps the height axis to itself.
 */
export interface Vec2 {
  x: number
  y: number
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k }
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y)
  return len < 1e-9 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len }
}

export function directionTo(from: Vec2, to: Vec2): Vec2 {
  return normalize(sub(to, from))
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x)
}

export function fromAngle(radians: number, magnitude = 1): Vec2 {
  return { x: Math.cos(radians) * magnitude, y: Math.sin(radians) * magnitude }
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** True when `point` lies inside the cone of half-width `halfAngle` around `facing`. */
export function withinArc(origin: Vec2, facing: number, halfAngle: number, point: Vec2): boolean {
  const to = sub(point, origin)
  if (length(to) < 1e-6) return true
  return Math.abs(angleDelta(facing, angleOf(to))) <= halfAngle
}
