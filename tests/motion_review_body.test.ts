import { describe, expect, it } from 'vitest'
import { HEIGHT_PER_RADIUS } from '../src/render/actorview'
import {
  MASCULINE_V1_BODY,
  MASCULINE_V2_BODY,
  motionModeForBody,
  REVIEW_BODIES,
  reviewBodyScale,
  supportsMotionMode,
} from '../spike/motion/body'

describe('motion review body selection', () => {
  it('offers the fitted body first and keeps the one it replaces beside it', () => {
    expect(REVIEW_BODIES.map((body) => body.id)).toEqual(['masculine-v2', 'masculine-v1'])
    expect(MASCULINE_V2_BODY.path).toBe('/bodies/masculine-v2/masculine-v2.glb')
    expect(MASCULINE_V1_BODY.path).toBe('/bodies/masculine-v1.glb')
    // Two bodies, two profiles: v1 names its bones with dots and v2 with underscores.
    expect(MASCULINE_V2_BODY.profile).not.toBe(MASCULINE_V1_BODY.profile)
  })

  it('scales every review body to the player actor height', () => {
    const playerRadius = 0.44
    for (const body of REVIEW_BODIES) {
      expect(body.profile.standingHeight).toBe(1.8)
      expect(reviewBodyScale(playerRadius, body)).toBeCloseTo(playerRadius * HEIGHT_PER_RADIUS / 1.8, 8)
    }
  })

  it('disables clip motion and selects procedural motion for every fitted body', () => {
    for (const body of REVIEW_BODIES) {
      expect(supportsMotionMode(body, 'clip')).toBe(false)
      expect(supportsMotionMode(body, 'procedural')).toBe(true)
      expect(motionModeForBody(body, 'clip')).toBe('procedural')
    }
  })
})
