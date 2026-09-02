export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Hermite ease between two edges, flat at both ends so a loop closes smoothly. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export const TAU = Math.PI * 2

/**
 * Eases into a keyframe. Both branches keep a bounded slope, which a power of a
 * smoothstep does not: `smoothstep(x) ** 0.4` is vertical at x = 0, so the first
 * frame after a key would jump further than the rest of the segment together.
 */
export function ease(raw: number, shape: number): number {
  const t = smoothstep(0, 1, raw)
  if (shape >= 1) return Math.pow(t, shape)
  return 1 - Math.pow(1 - t, 1 / shape)
}

/**
 * The larger of two values, with the corner where they cross rounded off over
 * `width`. A hard max between two smooth curves is a kink in the result, and a
 * kink in a hip height is a frame that moves twice as far as the ones either side
 * of it — a hitch, once a stride, in an otherwise flowing walk.
 */
export function softMax(a: number, b: number, width: number): number {
  return 0.5 * (a + b + Math.hypot(a - b, width)) - width * 0.5
}

/** The same, rounded from above: never below either value, which a limit must not be. */
export function softCeil(a: number, b: number, width: number): number {
  return 0.5 * (a + b + Math.hypot(a - b, width))
}

export function softMin(a: number, b: number, width: number): number {
  return -softMax(-a, -b, width)
}

/** Cubic through two points with a slope stated at each: the way to match a handover. */
export function hermite(from: number, to: number, fromSlope: number, toSlope: number, t: number): number {
  const square = t * t
  const cube = square * t
  return (2 * cube - 3 * square + 1) * from +
    (cube - 2 * square + t) * fromSlope +
    (-2 * cube + 3 * square) * to +
    (cube - square) * toSlope
}

/** Lerp between two lanes of the same array, which is how a compiled clip stores its keys. */
export function mix(values: Float32Array, from: number, to: number, t: number): number {
  return values[from]! + (values[to]! - values[from]!) * t
}
