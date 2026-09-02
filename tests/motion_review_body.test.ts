import { describe, expect, it } from 'vitest'
import { HEIGHT_PER_RADIUS } from '../src/render/actorview'
import {
  MASCULINE_V3_BODY,
  REVIEW_BODIES,
  reviewBodyScale,
} from '../spike/motion/body'

describe('motion review body selection', () => {
  it('offers masculine-v3 as the only body', () => {
    expect(REVIEW_BODIES.map((body) => body.id)).toEqual(['masculine-v3'])
    expect(MASCULINE_V3_BODY.path).toBe('/bodies/masculine-v3/masculine-v3.glb')
  })

  it('scales the review body exactly like the game', () => {
    const playerRadius = 0.44
    expect(MASCULINE_V3_BODY.profile.standingHeight).toBe(1.8)
    expect(reviewBodyScale(playerRadius)).toBeCloseTo(playerRadius * HEIGHT_PER_RADIUS, 8)
  })
})
