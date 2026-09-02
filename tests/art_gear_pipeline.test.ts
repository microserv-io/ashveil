import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mergeClip, parseArgs, resolvePlan } from '../scripts/art/gear.mjs'
import { validate } from '../scripts/art/schema.mjs'

const ROOT = join(import.meta.dirname, '..')
const WRAPPER = join(ROOT, 'scripts', 'art', 'gear.mjs')
const BLENDER = process.env.ASHVEIL_BLENDER ?? '/opt/homebrew/bin/blender'
const BODY = 'masculine-v3'
const BODY_DIR = join(ROOT, 'public', 'bodies', BODY)
const GEAR_SCHEMA = JSON.parse(readFileSync(join(ROOT, 'scripts', 'art', 'contracts', 'gear-manifest.schema.json'), 'utf8'))
const FIXTURES = [
  { piece: 'proxy-feet', slot: 'feet', pair: true, covers: undefined },
  // Trousers reach the natural waist, so the waistband sits in the waist region.
  { piece: 'proxy-legs', slot: 'legs', pair: false, covers: ['legs', 'waist'] },
] as const
const ARTEFACTS = ['glb', 'manifest.json', 'report.json', 'clip.json'] as const
const CLIP_GATES = ['clears_the_body_through_stress_poses', 'clears_the_body_through_motion_cycles'] as const
const runnable = existsSync(BLENDER)
  && existsSync(join(BODY_DIR, `${BODY}.glb`))
  && existsSync(join(BODY_DIR, `${BODY}.masks.json`))
const scratch: string[] = []

afterAll(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** The wrapper reads the piece name out of the directory, so a fit needs its own. */
function outdirFor(piece: string): string {
  const parent = mkdtempSync(join(tmpdir(), `ashveil-${piece}-`))
  scratch.push(parent)
  const outdir = join(parent, piece)
  mkdirSync(outdir)
  return outdir
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('the gear wrapper', () => {
  it('refuses an unknown slot with a named gate', () => {
    expect(() => resolvePlan(parseArgs([
      '--input', 'proxy:chest', '--slot', 'tail', '--body', BODY, '--piece', 'nothing',
    ]))).toThrow(/slot gate: unknown slot "tail"/)
  })

  it('refuses a one-piece proxy for a pair slot with a named gate', () => {
    expect(() => resolvePlan(parseArgs([
      '--input', 'proxy:chest', '--slot', 'feet', '--body', BODY, '--piece', 'nothing',
    ]))).toThrow(/pair gate: proxy:chest is not a pair/)
  })

  it('refuses a covered slot that is not a slot', () => {
    expect(() => resolvePlan(parseArgs([
      '--input', 'proxy:chest', '--slot', 'chest', '--body', BODY, '--piece', 'proxy-chest',
      '--covers', 'chest,sleeves',
    ]))).toThrow(/slot gate: unknown covered slot "sleeves"/)
  })

  it('covers its own slot unless told otherwise, and nothing at all with --no-mask', () => {
    const base = ['--input', 'proxy:chest', '--slot', 'chest', '--body', BODY, '--piece', 'proxy-chest']
    expect(resolvePlan(parseArgs(base)).covers).toEqual(['chest'])
    expect(resolvePlan(parseArgs([...base, '--covers', 'chest,shoulders'])).covers).toEqual(['chest', 'shoulders'])
    expect(resolvePlan(parseArgs([...base, '--no-mask'])).covers).toEqual([])
  })

  it('refuses an outdir the clip gate could not find the piece in', () => {
    expect(() => resolvePlan(parseArgs([
      '--input', 'proxy:chest', '--slot', 'chest', '--body', BODY, '--piece', 'proxy-chest',
      '--outdir', 'tests/fixtures/gear/somewhere-else',
    ]))).toThrow(/argument gate: --outdir .* is not named after the piece "proxy-chest"/)
  })

  it('merges the clip gates into the manifest and the report', () => {
    const outdir = outdirFor('proxy-chest')
    writeFileSync(join(outdir, 'proxy-chest.manifest.json'), JSON.stringify({ gates: { fitted: true } }))
    writeFileSync(join(outdir, 'proxy-chest.report.json'),
      JSON.stringify({ gates: { fitted: true }, gatesPass: true }))
    mergeClip({ piece: 'proxy-chest', outdir } as never, { clears_the_body_through_stress_poses: false })

    const manifest = JSON.parse(readFileSync(join(outdir, 'proxy-chest.manifest.json'), 'utf8'))
    const report = JSON.parse(readFileSync(join(outdir, 'proxy-chest.report.json'), 'utf8'))
    expect(manifest.gates).toEqual({ fitted: true, clears_the_body_through_stress_poses: false })
    expect(report.gates).toEqual(manifest.gates)
    expect(report.gatesPass).toBe(false)
  })
})

describe.skipIf(!runnable)('the gear fitter, end to end', () => {
  for (const fixture of FIXTURES) {
    it(`reproduces ${fixture.piece} byte for byte and passes every gate`, { timeout: 300_000 }, () => {
      const outdir = outdirFor(fixture.piece)
      const result = spawnSync(process.execPath, [WRAPPER,
        '--input', `proxy:${fixture.slot}`, '--slot', fixture.slot, '--body', BODY, '--piece', fixture.piece,
        ...(fixture.covers ? ['--covers', fixture.covers.join(',')] : []),
        '--outdir', outdir,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(result.status, result.stderr + result.stdout).toBe(0)

      const manifest = JSON.parse(readFileSync(join(outdir, `${fixture.piece}.manifest.json`), 'utf8'))
      expect(validate(GEAR_SCHEMA, manifest)).toEqual([])
      expect(manifest.slot).toBe(fixture.slot)
      expect(manifest.body).toBe(BODY)
      expect(manifest.covers).toEqual(fixture.covers ?? [fixture.slot])
      expect(manifest.gates[fixture.pair ? 'pair_has_two_islands' : 'piece_is_one_mesh']).toBe(true)
      for (const gate of CLIP_GATES) expect(manifest.gates[gate], gate).toBe(true)
      expect(Object.entries(manifest.gates).filter(([, passed]) => !passed)).toEqual([])
      expect(Object.keys(manifest.alignment).sort()).toEqual(
        fixture.pair ? ['L', 'R'] : ['scale', 'translation', 'yawDegrees'])

      for (const extension of ARTEFACTS) {
        const committed = join(ROOT, 'tests', 'fixtures', 'gear', fixture.piece, `${fixture.piece}.${extension}`)
        expect(digest(join(outdir, `${fixture.piece}.${extension}`)), extension).toBe(digest(committed))
      }
    })
  }
})

describe.skipIf(runnable)('the gear fitter, end to end', () => {
  it('is skipped because Blender or the fitted body is not on this machine', () => {
    expect(runnable).toBe(false)
  })
})
