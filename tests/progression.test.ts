import { describe, expect, it } from 'vitest'
import { MAX_LEVEL, PASSIVES, XP_TABLE, canAllocate, levelForXp, xpIntoLevel, xpPenalty } from '../src/sim/progression'

describe('experience', () => {
  it('is strictly increasing and each level costs more than the last', () => {
    for (let i = 1; i < XP_TABLE.length; i++) {
      expect(XP_TABLE[i]!).toBeGreaterThan(XP_TABLE[i - 1]!)
      if (i > 1) {
        const thisLevel = XP_TABLE[i]! - XP_TABLE[i - 1]!
        const lastLevel = XP_TABLE[i - 1]! - XP_TABLE[i - 2]!
        expect(thisLevel).toBeGreaterThan(lastLevel)
      }
    }
  })

  it('maps xp back to the right level at every boundary', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(levelForXp(XP_TABLE[level]!)).toBe(level + 1)
      expect(levelForXp(XP_TABLE[level]! - 1)).toBe(level)
    }
  })

  it('caps at the maximum level', () => {
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL)
    expect(xpIntoLevel(Number.MAX_SAFE_INTEGER, MAX_LEVEL).needed).toBe(0)
  })

  it('reports progress within the current level', () => {
    const { into, needed } = xpIntoLevel(XP_TABLE[3]!, 4)
    expect(into).toBe(0)
    expect(needed).toBe(XP_TABLE[4]! - XP_TABLE[3]!)
  })

  it('pays full xp for on-level content and tails off for trivial content', () => {
    expect(xpPenalty(5, 5)).toBe(1)
    expect(xpPenalty(5, 3)).toBe(1)
    expect(xpPenalty(20, 1)).toBeLessThan(0.1)
    expect(xpPenalty(20, 1)).toBeGreaterThan(0)
  })
})

describe('passive tree', () => {
  it('every node except the root points at a real parent', () => {
    const ids = new Set(PASSIVES.map((p) => p.id))
    for (const node of PASSIVES) {
      if (node.requires === null) continue
      expect(ids.has(node.requires)).toBe(true)
    }
  })

  it('requires a point and a connected parent', () => {
    const allocated = new Set(['root'])
    expect(canAllocate('might_1', allocated, 0)).toBe(false)
    expect(canAllocate('might_1', allocated, 1)).toBe(true)
    expect(canAllocate('might_2', allocated, 1)).toBe(false)

    allocated.add('might_1')
    expect(canAllocate('might_2', allocated, 1)).toBe(true)
  })

  it('refuses to allocate the same node twice', () => {
    const allocated = new Set(['root', 'might_1'])
    expect(canAllocate('might_1', allocated, 5)).toBe(false)
  })

  it('is fully reachable from the root', () => {
    const allocated = new Set(['root'])
    let progressed = true
    while (progressed) {
      progressed = false
      for (const node of PASSIVES) {
        if (canAllocate(node.id, allocated, 99)) {
          allocated.add(node.id)
          progressed = true
        }
      }
    }
    expect(allocated.size).toBe(PASSIVES.length)
  })
})
