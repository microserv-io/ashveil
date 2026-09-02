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

/** Lerp between two lanes of the same array, which is how a compiled clip stores its keys. */
export function mix(values: Float32Array, from: number, to: number, t: number): number {
  return values[from]! + (values[to]! - values[from]!) * t
}
