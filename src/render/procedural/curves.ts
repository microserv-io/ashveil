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
