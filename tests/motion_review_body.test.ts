import { describe, expect, it } from 'vitest'
import { HEIGHT_PER_RADIUS } from '../src/render/actorview'
import {
  MASCULINE_V1_BODY,
  motionModeForBody,
  reviewBodyScale,
  supportsMotionMode,
} from '../spike/motion/body'

describe('motion review body selection', () => {
  it('loads masculine-v1 from the committed body path at player actor height', () => {
    const playerRadius = 0.44
    expect(MASCULINE_V1_BODY.id).toBe('masculine-v1')
    expect(MASCULINE_V1_BODY.path).toBe('/bodies/masculine-v1.glb')
    expect(reviewBodyScale(playerRadius, MASCULINE_V1_BODY)).toBeCloseTo(
      playerRadius * HEIGHT_PER_RADIUS / 1.8,
      8,
    )
  })

  it('disables clip motion and selects procedural motion for masculine-v1', () => {
    expect(supportsMotionMode(MASCULINE_V1_BODY, 'clip')).toBe(false)
    expect(supportsMotionMode(MASCULINE_V1_BODY, 'procedural')).toBe(true)
    expect(motionModeForBody(MASCULINE_V1_BODY, 'clip')).toBe('procedural')
  })
})
