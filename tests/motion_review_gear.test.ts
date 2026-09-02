import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GEAR_SLOTS, type GearSlot } from '../src/render/gear'
import { gearPath, loadReviewMasks, MASCULINE_V3_MASKS, REVIEW_GEAR } from '../spike/motion/gear'

/**
 * The review page only lists pieces the pipeline has already passed, so opening it
 * can never be the thing that discovers a piece is broken. The list starts empty
 * and this holds every entry added to it to the same bar.
 */

const PUBLIC = join(import.meta.dirname, '..', 'public')

interface GearManifest {
  slot: string
  gates: Record<string, boolean>
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
    for (const entry of REVIEW_GEAR) {
      const manifest = manifestOf(entry.piece)
      expect(manifest.slot as GearSlot, entry.piece).toBe(entry.slot)
      const failed = Object.entries(manifest.gates ?? {}).filter(([, passed]) => !passed)
      expect(failed, `${entry.piece} failed ${failed.map(([name]) => name).join(', ')}`).toEqual([])
    }
  })

  /** Two pieces in one slot would mask the same body twice and fight over it. */
  it('lists a slot at most once, so "Wear all" is a wearable outfit', () => {
    const slots = REVIEW_GEAR.map((entry) => entry.slot)
    expect(slots).toEqual([...new Set(slots)])
  })

  it('serves the body masks from the body’s own directory', () => {
    expect(MASCULINE_V3_MASKS).toBe('/bodies/masculine-v3/masculine-v3.masks.json')
  })

  it('leaves the page usable when the masks sidecar is not there yet', async () => {
    await expect(loadReviewMasks('/bodies/nothing-here.masks.json')).resolves.toBeNull()
  })
})
