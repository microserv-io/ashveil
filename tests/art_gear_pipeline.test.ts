import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { blenderArgs, mergeClip, parseArgs, resolvePlan } from '../scripts/art/gear.mjs'
import { readGlb } from '../scripts/art/glb'
import { validate } from '../scripts/art/schema.mjs'

const ROOT = join(import.meta.dirname, '..')
const WRAPPER = join(ROOT, 'scripts', 'art', 'gear.mjs')
const BLENDER = process.env.ASHVEIL_BLENDER ?? '/opt/homebrew/bin/blender'
const BODY = 'masculine-v3'
const BODY_DIR = join(ROOT, 'public', 'bodies', BODY)
const GEAR_SCHEMA = JSON.parse(readFileSync(join(ROOT, 'scripts', 'art', 'contracts', 'gear-manifest.schema.json'), 'utf8'))
interface Fixture {
  readonly piece: string
  readonly slot: string
  readonly pair: boolean
  readonly covers?: readonly string[]
  /** Whether the slot wears feet, and so is held to the toe check. */
  readonly toes?: boolean
  /** `name:bone:from:to[:segments]`, for a piece whose cloth hangs and swings. */
  readonly drape?: string
  readonly source?: string
}
const FIXTURES: readonly Fixture[] = [
  { piece: 'proxy-feet', slot: 'feet', pair: true, toes: true },
  // A hood eats six body meshes, so it is the one that proves `hides` is per mesh.
  { piece: 'proxy-head', slot: 'head', pair: false },
  // A body shell has no tail to hang, so the drape fixture is a sheet the fitter builds.
  { piece: 'proxy-cape', slot: 'back', pair: false, source: 'cape', drape: 'cape:chest:0.0:0.95:3' },
]
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

  it('takes the slot’s defaultCovers unless told otherwise, and nothing at all with --no-mask', () => {
    const base = ['--input', 'proxy:chest', '--slot', 'chest', '--body', BODY, '--piece', 'proxy-chest']
    // A tunic has sleeves, so the chest slot spans the shoulders without a flag.
    expect(resolvePlan(parseArgs(base)).covers).toEqual(['chest', 'shoulders'])
    expect(resolvePlan(parseArgs([...base, '--covers', 'chest'])).covers).toEqual(['chest'])
    expect(resolvePlan(parseArgs([...base, '--no-mask'])).covers).toEqual([])
    const feet = ['--input', 'proxy:feet', '--slot', 'feet', '--body', BODY, '--piece', 'proxy-feet']
    expect(resolvePlan(parseArgs(feet)).covers).toEqual(['feet'])
  })

  /** A source faces +Z by contract; a turned piece is told, and the fitter never votes. */
  it('takes only a yaw the contract can mean, and passes it on when given', () => {
    const base = ['--input', 'proxy:feet', '--slot', 'feet', '--body', BODY, '--piece', 'proxy-feet']
    expect(() => resolvePlan(parseArgs([...base, '--yaw', '90'])))
      .toThrow(/yaw gate: "90" is not 0 or 180/)
    expect(blenderArgs(resolvePlan(parseArgs(base)))).not.toContain('--yaw')
    expect(blenderArgs(resolvePlan(parseArgs([...base, '--yaw', '180'])))).toContain('180')
  })

  it('refuses a drape that is not name:bone:from:to[:segments], and takes repeats', () => {
    const base = ['--input', 'proxy:cape', '--slot', 'back', '--body', BODY, '--piece', 'proxy-cape']
    expect(() => parseArgs([...base, '--drape', 'sash:pelvis:0.0']))
      .toThrow(/drape gate: "sash:pelvis:0.0" is not name:bone:from:to\[:segments\]/)
    expect(() => parseArgs([...base, '--drape', 'sash:pelvis:0.0:0.8:9']))
      .toThrow(/drape gate/)
    expect(() => parseArgs([...base, '--drape', 'sash:pelvis:0.0:0.8', '--drape', 'sash:chest:0.0:0.8']))
      .toThrow(/drape gate: two drapes share a name/)
    const plan = resolvePlan(parseArgs([...base,
      '--drape', 'cape:chest:0.0:0.95:3', '--drape', 'hem:pelvis:0.0:0.4']))
    expect(plan.drapes).toEqual(['cape:chest:0.0:0.95:3', 'hem:pelvis:0.0:0.4'])
    expect(blenderArgs(plan).join(' ')).toContain('--drape cape:chest:0.0:0.95:3 --drape hem:pelvis:0.0:0.4')
  })

  it('refuses an outdir the clip gate could not find the piece in', () => {
    expect(() => resolvePlan(parseArgs([
      '--input', 'proxy:chest', '--slot', 'chest', '--body', BODY, '--piece', 'proxy-chest',
      '--outdir', 'tests/fixtures/gear/somewhere-else',
    ]))).toThrow(/argument gate: --outdir .* is not named after the piece "proxy-chest"/)
  })

  it('fits a new shoulder piece only over a lower layer on the same body', () => {
    const base = [
      '--input', 'proxy:shoulders', '--slot', 'shoulders', '--body', BODY,
      '--piece', 'new-shoulders',
    ]
    expect(resolvePlan(parseArgs([...base, '--under', 'warden-tunic'])).under).toEqual(['warden-tunic'])
    expect(() => resolvePlan(parseArgs([...base, '--under', 'warden-pauldrons'])))
      .toThrow(/warden-pauldrons \(shoulders, layer 6\) is not below shoulders \(layer 6\)/)
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

  it('validates the shipped paired layer-seat manifest', () => {
    const manifest = JSON.parse(readFileSync(
      join(ROOT, 'public', 'gear', 'warden-pauldrons', 'warden-pauldrons.manifest.json'), 'utf8'))
    expect(validate(GEAR_SCHEMA, manifest)).toEqual([])
  })
})

describe.skipIf(!runnable)('the gear fitter, end to end', () => {
  for (const fixture of FIXTURES) {
    it(`reproduces ${fixture.piece} byte for byte and passes every gate`, { timeout: 300_000 }, () => {
      const outdir = outdirFor(fixture.piece)
      const result = spawnSync(process.execPath, [WRAPPER,
        '--input', `proxy:${fixture.source ?? fixture.slot}`, '--slot', fixture.slot,
        '--body', BODY, '--piece', fixture.piece,
        ...(fixture.covers ? ['--covers', fixture.covers.join(',')] : []),
        ...(fixture.drape ? ['--drape', fixture.drape] : []),
        '--outdir', outdir,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(result.status, result.stderr + result.stdout).toBe(0)

      const manifest = JSON.parse(readFileSync(join(outdir, `${fixture.piece}.manifest.json`), 'utf8'))
      expect(validate(GEAR_SCHEMA, manifest)).toEqual([])
      expect(manifest.slot).toBe(fixture.slot)
      expect(manifest.body).toBe(BODY)
      expect(manifest.covers).toEqual(fixture.covers ?? [fixture.slot])
      const hidden = Object.values(manifest.hides).flat().length
      if (fixture.drape) expect(hidden, 'hides').toBe(0)
      else expect(hidden, 'hides').toBeGreaterThan(0)
      expect(manifest.gates[fixture.pair ? 'pair_has_both_sides' : 'piece_is_one_mesh']).toBe(true)
      expect(manifest.gates.toes_point_forward, 'toes').toBe(fixture.toes ? true : undefined)
      for (const gate of CLIP_GATES) expect(manifest.gates[gate], gate).toBe(true)
      expect(Object.entries(manifest.gates).filter(([, passed]) => !passed)).toEqual([])
      expect(Object.keys(manifest.alignment).sort()).toEqual(
        fixture.pair ? ['L', 'R'] : ['scale', 'translation', 'yawDegrees'])
      // A drape ships its own bones, appended to the body's list in the body's order,
      // each parented where the declaration said and none of them weighted to nothing.
      const body = JSON.parse(readFileSync(join(BODY_DIR, `${BODY}.manifest.json`), 'utf8'))
      if (!fixture.drape) {
        expect(manifest.drapes, 'drapes').toBe(undefined)
        expect(manifest.bones).toEqual(body.bones)
      } else {
        const [name, attachBone, , , segments] = fixture.drape.split(':')
        expect(manifest.drapes).toHaveLength(1)
        expect(manifest.drapes[0].name).toBe(name)
        expect(manifest.drapes[0].attachBone).toBe(attachBone)
        expect(manifest.drapes[0].bones).toEqual(
          Array.from({ length: Number(segments) }, (_, at) => `drape_${name}_${at + 1}`))
        expect(manifest.drapes[0].segmentLength).toBeGreaterThan(0)
        expect(manifest.drapes[0].supports.length).toBeGreaterThan(0)
        expect(manifest.drapes[0].supports.every((support: { terms: unknown[] }) => support.terms.length <= 12)).toBe(true)
        expect(manifest.drapes[0].colliders.some((collider: { from: string; to: string }) =>
          collider.from === 'chest' && collider.to === 'neck')).toBe(true)
        expect(manifest.drapes[0].colliders.some((collider: { from: string }) =>
          collider.from === 'clavicle_L')).toBe(true)
        expect(manifest.bones.slice(0, body.bones.length)).toEqual(body.bones)
        expect(manifest.bones.slice(body.bones.length)).toEqual(manifest.drapes[0].bones)
      }

      for (const extension of ARTEFACTS) {
        const committed = join(ROOT, 'tests', 'fixtures', 'gear', fixture.piece, `${fixture.piece}.${extension}`)
        expect(digest(join(outdir, `${fixture.piece}.${extension}`)), extension).toBe(digest(committed))
      }
    })
  }

  it('partitions one overlapping cloth band into deterministic independent chains', { timeout: 600_000 }, () => {
    const panels = [
      'cape_r:upper_arm_R:0.0:0.95:3',
      'cape:chest:0.0:0.95:3',
      'cape_l:upper_arm_L:0.0:0.95:3',
    ]
    const fit = (piece: string, drapes = panels) => {
      const outdir = outdirFor(piece)
      const result = spawnSync(process.execPath, [WRAPPER,
        '--input', 'proxy:cape', '--slot', 'back', '--body', BODY, '--piece', piece,
        ...drapes.flatMap((drape) => ['--drape', drape]),
        '--outdir', outdir,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(result.status, result.stderr + result.stdout).toBe(0)
      return outdir
    }
    const first = fit('proxy-wrap')
    const second = fit('proxy-wrap')
    const readOutput = (directory: string, piece: string, suffix: string) =>
      JSON.parse(readFileSync(join(directory, `${piece}.${suffix}`), 'utf8'))
    const firstManifest = readOutput(first, 'proxy-wrap', 'manifest.json')
    const firstReport = readOutput(first, 'proxy-wrap', 'report.json')
    const singleReport = JSON.parse(readFileSync(
      join(ROOT, 'tests', 'fixtures', 'gear', 'proxy-cape', 'proxy-cape.report.json'), 'utf8'))

    expect(firstReport.drapes.map((entry: { attachBone: string }) => entry.attachBone)).toEqual([
      'upper_arm_R', 'chest', 'upper_arm_L',
    ])
    expect(firstReport.drapes.reduce((total: number, entry: { bandVertices: number }) =>
      total + entry.bandVertices, 0)).toBe(singleReport.drapes[0].bandVertices)
    const chains = firstManifest.drapes.map((entry: { bones: string[] }) => new Set(entry.bones))
    firstManifest.drapes.forEach((entry: { supports: { terms: { joint: string; weight: number }[] }[] }, owner: number) => {
      for (const support of entry.supports) {
        const totals = chains.map((bones: Set<string>) => support.terms.reduce(
          (total, term) => total + (bones.has(term.joint) ? term.weight : 0), 0))
        expect(totals[owner]).toBe(Math.max(...totals))
      }
    })
    for (const suffix of ['glb', 'manifest.json', 'report.json', 'clip.json']) {
      const firstBytes = readFileSync(join(first, `proxy-wrap.${suffix}`))
      const secondBytes = readFileSync(join(second, `proxy-wrap.${suffix}`))
      expect(firstBytes.equals(secondBytes), suffix).toBe(true)
    }

    const tilted = panels.map((drape) => `${drape}:3`)
    const fitTilted = (drapes: string[]) => {
      const outdir = outdirFor('proxy-wrap-tilted')
      const plan = resolvePlan(parseArgs([
        '--input', 'proxy:cape', '--slot', 'back', '--body', BODY, '--piece', 'proxy-wrap-tilted',
        ...drapes.flatMap((drape) => ['--drape', drape]), '--outdir', outdir,
      ]))
      const result = spawnSync(BLENDER, blenderArgs(plan), { cwd: ROOT, encoding: 'utf8' })
      expect(result.status, result.stderr + result.stdout).toBe(0)
      return outdir
    }
    const forward = fitTilted(tilted)
    const reversed = fitTilted([...tilted].reverse())
    const positions = (directory: string) =>
      [...readGlb(join(directory, 'proxy-wrap-tilted.glb')).meshes[0]!.positions]
    expect(positions(forward)).toEqual(positions(reversed))
    const drapeMeasurements = (directory: string) => Object.fromEntries(
      readOutput(directory, 'proxy-wrap-tilted', 'report.json').drapes
        .map((entry: { name: string; bandVertices: number; root: number[]; axis: number[]; toLineY: number }) =>
          [entry.name, {
            bandVertices: entry.bandVertices, root: entry.root, axis: entry.axis, toLineY: entry.toLineY,
          }]),
    )
    expect(drapeMeasurements(forward)).toEqual(drapeMeasurements(reversed))
  })

  it('fits nested bands independently of declaration order', { timeout: 600_000 }, () => {
    const fit = (drapes: string[]) => {
      const outdir = outdirFor('proxy-stack')
      const plan = resolvePlan(parseArgs([
        '--input', 'proxy:cape', '--slot', 'back', '--body', BODY, '--piece', 'proxy-stack',
        ...drapes.flatMap((drape) => ['--drape', drape]), '--outdir', outdir,
      ]))
      const result = spawnSync(BLENDER, blenderArgs(plan), { cwd: ROOT, encoding: 'utf8' })
      expect(result.status, result.stderr + result.stdout).toBe(0)
      return outdir
    }
    const cape = 'cape:chest:0.0:0.95:3'
    const hem = 'hem:pelvis:0.0:0.4:2'
    const forward = fit([cape, hem])
    const reversed = fit([hem, cape])
    for (const suffix of ['glb', 'manifest.json', 'report.json']) {
      expect(readFileSync(join(forward, `proxy-stack.${suffix}`))
        .equals(readFileSync(join(reversed, `proxy-stack.${suffix}`))), suffix).toBe(true)
    }
    const manifest = JSON.parse(readFileSync(join(forward, 'proxy-stack.manifest.json'), 'utf8'))
    expect(manifest.drapes.map((drape: { name: string; supports: unknown[] }) =>
      [drape.name, drape.supports.length])).toEqual([['cape', 72], ['hem', 48]])
  })

  it('names a drape starved of surface supports', () => {
    const result = spawnSync(BLENDER, [
      '--background', '--factory-startup', '--python-exit-code', '1', '--python-expr',
      'import sys; sys.path.insert(0, "scripts/art"); from gear.drape import require_surface_supports; require_surface_supports("empty", [])',
    ], { cwd: ROOT, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toMatch(/drape gate: empty has no surface supports after chain ownership/)
  })

  it('keeps the legacy layer-seat candidate ladder when optional controls are absent', () => {
    const expression = `
import json, sys
sys.path.insert(0, "scripts/art")
import bpy
from gear.geometry import layer_seat

mesh = bpy.data.meshes.new("legacy")
mesh.from_pydata([(0.0, 0.0, 0.0)], [], [])
obj = bpy.data.objects.new("legacy", mesh)

class Surface:
    def __init__(self):
        self.samples = []
    def penetration(self, point):
        self.samples.append(round(float(point[0]), 6))
        return 0.0 if point[0] >= 0.029 else 0.1
    def nearest(self, point):
        return point.copy()

surface = Surface()
report = layer_seat(obj, surface, {
    "axis": "X", "direction": 1, "step": 0.01, "maximum": 0.03,
    "depth": 0.0, "band": [0.0, 1.0],
}, 0.0)
assert surface.samples == [0.0, 0.01, 0.02, 0.03], surface.samples
assert report["bandAxis"] == "X", report
assert report["minimumMetres"] == 0.01, report
assert report["translationMetres"] == [0.03, 0.0, 0.0], report
print(json.dumps(report))
`
    const result = spawnSync(BLENDER, [
      '--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', expression,
    ], { cwd: ROOT, encoding: 'utf8' })
    expect(result.status, result.stderr + result.stdout).toBe(0)
  })

  it('rejects a mirrored layer seat without a paired side', () => {
    const expression = `
import sys
from types import SimpleNamespace
sys.path.insert(0, "scripts/art")
from gear.geometry import layer_seat
layer_seat(SimpleNamespace(name="solo"), None, {
    "axis": "X", "direction": 1, "mirror": True, "step": 0.01,
    "maximum": 0.03, "depth": 0.0, "band": [0.0, 1.0],
}, 0.0, "all")
`
    const result = spawnSync(BLENDER, [
      '--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', expression,
    ], { cwd: ROOT, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toMatch(
      /layer seat gate: solo cannot mirror a seat without paired side L or R/,
    )
  })
})

describe.skipIf(runnable)('the gear fitter, end to end', () => {
  it('is skipped because Blender or the fitted body is not on this machine', () => {
    expect(runnable).toBe(false)
  })
})
