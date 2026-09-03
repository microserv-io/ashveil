import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAPE_LIMBS } from '../src/render/drapecollide'
import { GEAR_SLOTS, SLOT_CLEARANCES, SLOT_LAYERS } from '../src/render/gear'
import { validate } from '../scripts/art/schema.mjs'

const ROOT = join(import.meta.dirname, '..')
const CONTRACTS = join(ROOT, 'scripts', 'art', 'contracts')
const read = (...path: string[]) => JSON.parse(readFileSync(join(...path), 'utf8'))

const FAMILY_SCHEMA = read(CONTRACTS, 'family.schema.json')
const MANIFEST_SCHEMA = read(CONTRACTS, 'body-manifest.schema.json')
const HUMANOID = read(CONTRACTS, 'humanoid.v1.json')
const MANIFEST = read(ROOT, 'public', 'bodies', 'masculine-v3', 'masculine-v3.manifest.json')

/**
 * The family contract says what a humanoid is; the manifest says what one body
 * measured. Both are read by scripts and by the renderer, so both are checked
 * against a schema rather than trusted to stay the shape they were written in.
 */
describe('the family contract', () => {
  it('matches the family schema', () => {
    expect(validate(FAMILY_SCHEMA, HUMANOID)).toEqual([])
  })

  it('names a bone for every landmark a bone hangs off', () => {
    const landmarks = new Set(HUMANOID.landmarks)
    for (const bone of HUMANOID.bones) {
      expect(landmarks, `bone ${bone.name} heads at an unlisted landmark`).toContain(bone.head)
      expect(landmarks, `bone ${bone.name} tails at an unlisted landmark`).toContain(bone.tail)
    }
  })

  it('parents every bone to one that comes before it', () => {
    const seen = new Set<string>()
    for (const bone of [...HUMANOID.bones, ...HUMANOID.helpers]) {
      if (bone.parent !== null) expect(seen).toContain(bone.parent)
      seen.add(bone.name)
    }
  })

  /**
   * Every piece is fitted against the bare body, so what keeps a cloak off a tunic
   * and a tunic out of a waistband is the clearance each slot stands off the skin
   * by. Layering is that ordering made explicit: an outer layer never sits closer
   * to the skin than something it is worn over.
   */
  it('layering_orders_clearances', () => {
    const slots = Object.entries(HUMANOID.slots) as [string, { layer: number; clearance: number }][]
    for (const [outer, over] of slots) {
      for (const [inner, under] of slots) {
        if (over.layer <= under.layer) continue
        expect(over.clearance, `${outer} (layer ${over.layer}) sits under ${inner} (layer ${under.layer})`)
          .toBeGreaterThan(under.clearance)
      }
    }
  })

  /** The renderer hides one piece under another by layer, so its table is the contract's. */
  it('is the layer table the renderer hides gear by', () => {
    expect(Object.keys(HUMANOID.slots).sort()).toEqual([...GEAR_SLOTS].sort())
    for (const [slot, rule] of Object.entries(HUMANOID.slots) as [string, { layer: number }][]) {
      expect(SLOT_LAYERS[slot as keyof typeof SLOT_LAYERS], slot).toBe(rule.layer)
    }
  })

  it('is the clearance table a drape holds itself off a limb by', () => {
    for (const [slot, rule] of Object.entries(HUMANOID.slots) as [string, { clearance: number }][]) {
      expect(SLOT_CLEARANCES[slot as keyof typeof SLOT_CLEARANCES], slot).toBe(rule.clearance)
    }
  })

  /** A capsule named after a bone the family has not is a capsule that never forms. */
  it('names only bones the family has for the limbs a drape is pushed off', () => {
    const bones = new Set((HUMANOID.bones as { name: string }[]).map((bone) => bone.name))
    for (const limb of DRAPE_LIMBS) {
      expect(bones, `${limb.from} -> ${limb.to}`).toContain(limb.from)
      expect(bones).toContain(limb.to)
      expect(limb.radius).toBeGreaterThan(0)
    }
  })

  it('rejects a contract with a bone that plays no role and a hole where a role was', () => {
    const broken = { ...HUMANOID, bones: HUMANOID.bones.map((bone: { name: string }) => ({ ...bone, role: 7 })) }
    expect(validate(FAMILY_SCHEMA, broken).length).toBeGreaterThan(0)
  })
})

describe('the masculine-v3 manifest', () => {
  it('matches the body manifest schema', () => {
    expect(validate(MANIFEST_SCHEMA, MANIFEST)).toEqual([])
  })

  it('was fitted against the contract version that is checked in', () => {
    expect(MANIFEST.contractVersion).toBe(HUMANOID.version)
    expect(MANIFEST.family).toBe(HUMANOID.family)
  })

  it('carries every bone the family requires and every helper it asked for', () => {
    for (const bone of HUMANOID.bones) expect(MANIFEST.bones).toContain(bone.name)
    for (const helper of HUMANOID.helpers) expect(MANIFEST.bones).toContain(helper.name)
  })

  it('reports every gate as passed, because a body only ships when they do', () => {
    expect(Object.values(MANIFEST.gates).every(Boolean)).toBe(true)
  })

  it('names a missing required field rather than passing a half manifest', () => {
    const { restSignatureSha256: _dropped, ...half } = MANIFEST
    expect(validate(MANIFEST_SCHEMA, half)).toEqual(['/: missing required property "restSignatureSha256"'])
  })
})
