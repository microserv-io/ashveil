import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GEAR_SLOTS, type GearSlot } from '../src/render/gear'
import { gearPath, REVIEW_GEAR } from '../spike/motion/gear'

/**
 * The review page only lists pieces the pipeline has already passed, so opening it
 * can never be the thing that discovers a piece is broken. The list starts empty
 * and this holds every entry added to it to the same bar.
 */

const PUBLIC = join(import.meta.dirname, '..', 'public')

interface GearManifest {
  slot: string
  gates: Record<string, boolean>
  hides: Record<string, number[]>
}

function manifestOf(piece: string): GearManifest {
  return JSON.parse(readFileSync(join(PUBLIC, 'gear', piece, `${piece}.manifest.json`), 'utf8'))
}

describe('the motion review gear list', () => {
  it('names a fitted piece under public/gear, never a test fixture', () => {
    for (const entry of REVIEW_GEAR) {
      expect(entry.path, entry.piece).toBe(gearPath(entry.piece))
      expect(GEAR_SLOTS, entry.piece).toContain(entry.slot)
      expect(entry.piece, 'the proxy fixtures are test data').not.toMatch(/^proxy-/)
      expect(existsSync(join(PUBLIC, 'gear', entry.piece)), `public/gear/${entry.piece}`).toBe(true)
    }
  })

  it('lists only pieces whose every gate passed, in the slot they were fitted for', () => {
    for (const entry of REVIEW_GEAR.filter((piece) => !piece.compare)) {
      const manifest = manifestOf(entry.piece)
      expect(manifest.slot as GearSlot, entry.piece).toBe(entry.slot)
      const failed = Object.entries(manifest.gates ?? {}).filter(([, passed]) => !passed)
      expect(failed, `${entry.piece} failed ${failed.map(([name]) => name).join(', ')}`).toEqual([])
    }
  })

  /** Two pieces in one slot would mask the same body twice and fight over it. */
  it('lists a slot at most once, so "Wear all" is a wearable outfit', () => {
    const slots = REVIEW_GEAR.filter((entry) => !entry.compare).map((entry) => entry.slot)
    expect(slots).toEqual([...new Set(slots)])
  })

  /**
   * A comparison entry is a second fitting of a slot that already ships, put on the
   * page to be judged against it. It is off by default and out of "Wear all", and
   * its gates are what the comparison is about, so they are not the bar for listing
   * it - the eye is. It still has to be a real fitted piece in the right slot.
   */
  it('holds a comparison entry to the slot it claims, and to nothing else', () => {
    for (const entry of REVIEW_GEAR.filter((piece) => piece.compare)) {
      expect(manifestOf(entry.piece).slot as GearSlot, entry.piece).toBe(entry.slot)
      const shipping = REVIEW_GEAR.filter((piece) => !piece.compare && piece.slot === entry.slot)
      expect(shipping, `${entry.piece} compares against nothing`).not.toEqual([])
    }
  })

  /** Masking is per piece now, so a listed piece carries its own body vertices. */
  it('carries the body vertices each piece hides in its own manifest', () => {
    for (const entry of REVIEW_GEAR) {
      const hides = manifestOf(entry.piece).hides
      expect(hides, entry.piece).toBeTypeOf('object')
      for (const [mesh, indices] of Object.entries(hides)) {
        expect(Array.isArray(indices), `${entry.piece} hides ${mesh}`).toBe(true)
      }
    }
  })
})
