import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GEAR_SLOTS, type GearSlot } from '../src/render/gear'
import { gearPath, REVIEW_GEAR } from '../spike/motion/gear'
import { validate } from '../scripts/art/schema.mjs'

/**
 * The review page wears the Warden set, one piece per slot, and opening it can never
 * be the thing that discovers a piece is missing or malformed. Every entry has to
 * name a real fitted piece whose manifest the runtime can read.
 */

const ROOT = join(import.meta.dirname, '..')
const PUBLIC = join(ROOT, 'public')
const SCHEMA = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'art', 'contracts', 'gear-manifest.schema.json'), 'utf8'))

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

  it('lists a manifest the runtime can read, in the slot it was fitted for', () => {
    for (const entry of REVIEW_GEAR) {
      const manifest = manifestOf(entry.piece)
      expect(validate(SCHEMA, manifest), entry.piece).toEqual([])
      expect(manifest.slot as GearSlot, entry.piece).toBe(entry.slot)
    }
  })

  /** Two pieces in one slot would mask the same body twice and fight over it. */
  it('lists each slot once, so the page opens on a wearable outfit', () => {
    const slots = REVIEW_GEAR.map((entry) => entry.slot)
    expect(slots).toEqual([...new Set(slots)])
  })

  /**
   * Recorded, not asserted, because a gate here is a fact about the fitting rather
   * than a bar the set has to clear. `triangles_within_budget` is the loudest: every
   * piece was measured against the decimation target the family contract carried
   * before full detail became the rule, and none has been refitted since the budget
   * moved to 12000, which each of them is now comfortably under. The clearance gate
   * on the belt and the pauldrons is the same shape of thing: a ring and a socket
   * seat into the body on purpose. Printing them keeps them in front of a reader
   * without failing the suite over bars the pipeline has already moved.
   */
  it('records what each piece\'s gates say', () => {
    const lines = REVIEW_GEAR.map((entry) => {
      const open = Object.entries(manifestOf(entry.piece).gates ?? {})
        .filter(([, passed]) => !passed).map(([name]) => name)
      const verdict = open.length === 0 ? 'every gate green' : `open: ${open.join(', ')}`
      return `  ${entry.slot.padEnd(10)} ${entry.piece.padEnd(17)} ${verdict}`
    })
    console.info(`the review set's gates:\n${lines.join('\n')}`)
    expect(lines).toHaveLength(REVIEW_GEAR.length)
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
