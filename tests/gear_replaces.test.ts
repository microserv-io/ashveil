import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGlb } from '../scripts/art/glb'

/**
 * A glove replaces the hand, the way an armoured game does it, rather than covering
 * it: the skin it stands in for is hidden whether the garment reaches it or not, so
 * a fingertip the glove is a shade short of is a gloved finger and not a bare one.
 *
 * The assertion is made against the body's own skin weights rather than the report,
 * because the report is the fitter's word for it and this is the thing being checked.
 */

const ROOT = join(import.meta.dirname, '..')
const BODY = join(ROOT, 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb')
const CONTRACT = JSON.parse(readFileSync(join(ROOT, 'scripts', 'art', 'contracts', 'humanoid.v1.json'), 'utf8'))

interface Piece {
  readonly piece: string
  readonly slot: string
}
const PIECES: readonly Piece[] = [
  { piece: 'warden-gloves', slot: 'hands' },
  { piece: 'warden-boots', slot: 'feet' },
]

interface Rule {
  readonly bone: string
  readonly along?: readonly [number, number]
}

const LANDMARKS: Record<string, [number, number, number]> =
  JSON.parse(readFileSync(join(ROOT, 'public', 'bodies', 'masculine-v3', 'masculine-v3.manifest.json'), 'utf8'))
    .landmarks

/** The bone's own segment, from the contract's head and tail landmarks. */
function segmentOf(bone: string): [readonly number[], readonly number[]] {
  const spec = (CONTRACT.bones as { name: string; head: string; tail: string }[])
    .find((entry) => entry.name === bone)
  expect(spec, `the contract has no bone ${bone}`).toBeTruthy()
  return [LANDMARKS[spec!.head]!, LANDMARKS[spec!.tail]!]
}

/**
 * The same resolution `fit/masks.py` cuts a region with: the dominant bone, and the
 * fraction along that bone's own segment. Re-derived here rather than read out of the
 * report, because the report is the fitter's word for the thing being checked.
 */
function replacedBy(rules: readonly Rule[]): Map<string, Set<number>> {
  const glb = readGlb(BODY)
  const found = new Map<string, Set<number>>()
  for (const mesh of glb.meshes) found.set(mesh.name, new Set<number>())

  for (const rule of rules) {
    const joint = glb.skin.jointNames.indexOf(rule.bone)
    expect(joint, rule.bone).toBeGreaterThanOrEqual(0)
    const [head, tail] = segmentOf(rule.bone)
    const segment = [0, 1, 2].map((lane) => tail[lane]! - head[lane]!)
    const lengthSquared = segment.reduce((total, value) => total + value * value, 0)
    const [lower, upper] = rule.along ?? [0, 1]

    for (const mesh of glb.meshes) {
      const held = found.get(mesh.name)!
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
        let best = -1
        let weight = 0
        for (let lane = 0; lane < 4; lane++) {
          const value = mesh.weights[vertex * 4 + lane]!
          if (value > weight) {
            weight = value
            best = mesh.joints[vertex * 4 + lane]!
          }
        }
        if (weight <= 0 || best !== joint) continue
        const offset = [0, 1, 2].map((lane) => mesh.positions[vertex * 3 + lane]! - head[lane]!)
        const dot = offset[0]! * segment[0]! + offset[1]! * segment[1]! + offset[2]! * segment[2]!
        const along = Math.min(1, Math.max(0, dot / lengthSquared))
        if (along >= lower && along <= upper) held.add(vertex)
      }
    }
  }
  return found
}

describe('a piece that replaces the body under it', () => {
  for (const { piece, slot } of PIECES) {
    const manifestPath = join(ROOT, 'public', 'gear', piece, `${piece}.manifest.json`)

    it.skipIf(!existsSync(manifestPath))(`${piece} hides every vertex its slot replaces`, () => {
      const rules = CONTRACT.slots[slot].replaces as Rule[]
      expect(rules.length, `${slot} replaces nothing`).toBeGreaterThan(0)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { hides: Record<string, number[]> }

      for (const [mesh, replaced] of replacedBy(rules)) {
        if (replaced.size === 0) continue
        const hidden = new Set(manifest.hides[mesh] ?? [])
        const missed = [...replaced].filter((vertex) => !hidden.has(vertex))
        expect(missed.length, `${piece} leaves ${missed.length} of ${replaced.size} ${mesh} vertices bare`).toBe(0)
      }
    })
  }

  it('replaces only what the slot stands in for, and nothing elsewhere', () => {
    for (const [name, slot] of Object.entries(CONTRACT.slots) as [string, { replaces: unknown[] }][]) {
      expect(Array.isArray(slot.replaces), `${name} replaces`).toBe(true)
      if (name !== 'hands' && name !== 'feet') expect(slot.replaces, name).toEqual([])
    }
  })
})
