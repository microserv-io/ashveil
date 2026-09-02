import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validate } from '../scripts/art/schema.mjs'

const ROOT = join(import.meta.dirname, '..')
const CONTRACTS = join(ROOT, 'scripts', 'art', 'contracts')
const read = (...path: string[]) => JSON.parse(readFileSync(join(...path), 'utf8'))

const FAMILY_SCHEMA = read(CONTRACTS, 'family.schema.json')
const MANIFEST_SCHEMA = read(CONTRACTS, 'body-manifest.schema.json')
const HUMANOID = read(CONTRACTS, 'humanoid.v1.json')
const MANIFEST = read(ROOT, 'public', 'bodies', 'masculine-v2', 'masculine-v2.manifest.json')

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

  it('rejects a contract with a bone that plays no role and a hole where a role was', () => {
    const broken = { ...HUMANOID, bones: HUMANOID.bones.map((bone: { name: string }) => ({ ...bone, role: 7 })) }
    expect(validate(FAMILY_SCHEMA, broken).length).toBeGreaterThan(0)
  })
})

describe('the masculine-v2 manifest', () => {
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
