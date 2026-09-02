import { describe, expect, it } from 'vitest'
import { bodyTint } from '../src/render/actorview'
import { PALETTE } from '../src/render/palette'

describe('actor body tint', () => {
  it('keeps the fitted body materials on the player', () => {
    expect(bodyTint({ kind: 'player', archetype: null })).toBeNull()
  })

  it.each([
    ['swarm', PALETTE.swarm],
    ['ranged', PALETTE.ranged],
    ['brute', PALETTE.brute],
  ] as const)('uses the %s archetype colour for monsters', (archetype, colour) => {
    expect(bodyTint({ kind: 'monster', archetype })).toBe(colour)
  })
})
