import { describe, expect, it } from 'vitest'
import { MAX_ASH_MOTES, ashMotesAround } from '../src/world/ash-environment'
import { ashInfluenceAt } from '../src/world/terrain-paint'
import { compileZone } from '../src/world/zone-compiler'
import { DEFAULT_ZONE } from '../src/world/zone-default'

describe('ash environment', () => {
  const zone = compileZone(DEFAULT_ZONE)

  it('anchors a bounded deterministic patch to ash-affected dry ground', () => {
    const z = zone.spawn.z
    const x = zone.riverCenterAt(z) + zone.riverHalfWidthAt(z) + 30
    const first = ashMotesAround(zone, x, z)
    const second = ashMotesAround(zone, x, z)

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThanOrEqual(MAX_ASH_MOTES)
    for (const mote of first) {
      expect(zone.isWaterAt(mote.x, mote.z)).toBe(false)
      expect(mote.y).toBeGreaterThan(zone.heightAt(mote.x, mote.z))
      expect(mote.influence).toBe(ashInfluenceAt(zone, mote.x, mote.z))
      expect(mote.influence).toBeGreaterThanOrEqual(0.08)
    }
  })

  it('does not place a blanket particle patch over living ground', () => {
    const z = zone.spawn.z
    const livingX = zone.riverCenterAt(z) - zone.riverHalfWidthAt(z) - 80
    expect(ashMotesAround(zone, livingX, z)).toHaveLength(0)
  })

  it('keeps overlapping motes fixed in world cells as the local patch advances', () => {
    const z = zone.spawn.z
    const x = zone.riverCenterAt(z) + zone.riverHalfWidthAt(z) + 80
    const first = ashMotesAround(zone, x, z)
    const shifted = ashMotesAround(zone, x + 6, z)
    const overlap = first.filter((mote) => shifted.some((candidate) => candidate.x === mote.x && candidate.z === mote.z))

    expect(overlap.length).toBeGreaterThan(0)
    for (const mote of overlap) {
      expect(shifted.find((candidate) => candidate.x === mote.x && candidate.z === mote.z)).toEqual(mote)
    }
  })
})
