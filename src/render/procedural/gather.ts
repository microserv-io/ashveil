import { smoothstep, TAU } from './curves'

/** A roll of both hands about a point between them through the wind-up, at a rate that does not stretch with the cast. */
export interface Gather {
  /** Orbit radius in arm lengths. */
  readonly radius: number
  /** Seconds per revolution. */
  readonly period: number
  /** Phase by which the roll has faded out, before the strike at 0.5. */
  readonly until: number
}

export function gatherOffset(gather: Gather, phase: number, time: number, side: number, out: Float32Array): void {
  out[0] = 0
  out[1] = 0
  if (phase >= gather.until) return
  const weight = smoothstep(0, 0.08, phase) * (1 - smoothstep(gather.until - 0.1, gather.until, phase))
  const angle = TAU * time / gather.period
  out[0] = side * Math.sin(angle) * gather.radius * weight
  out[1] = side * Math.cos(angle) * gather.radius * weight
}
