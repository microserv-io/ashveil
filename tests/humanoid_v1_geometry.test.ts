import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRigGeometry } from '../src/render/procedural/geometry'

const ROOT = join(import.meta.dirname, '..')
const SCRIPT = join(ROOT, 'scripts', 'extract-rig-geometry.mjs')
const PLAYER = join(ROOT, 'public', 'models', 'player.glb')
const MASCULINE = join(ROOT, 'public', 'bodies', 'masculine-v1.glb')
const KAYKIT_FIXTURE = join(ROOT, 'src', 'render', 'procedural', 'fixtures', 'kaykit_knight.json')
const MASCULINE_FIXTURE = join(ROOT, 'src', 'render', 'procedural', 'fixtures', 'humanoid_v1_masculine.json')
const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function extract(...args: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'ashveil-rig-'))
  temporary.push(directory)
  const output = join(directory, 'geometry.json')
  const result = spawnSync(process.execPath, [SCRIPT, ...args, output], { cwd: ROOT, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return readFileSync(output, 'utf8')
}

describe('rig geometry extractor CLI', () => {
  it('keeps the KayKit fixture byte-identical through the general CLI', () => {
    const extracted = extract(PLAYER, 'kaykit', 'Running_A')
    expect(extracted).toBe(readFileSync(KAYKIT_FIXTURE, 'utf8'))
  })

  it('extracts humanoid.v1 without a carry clip and states no carry', () => {
    const extracted = JSON.parse(extract(MASCULINE, 'humanoid-v1'))
    expect(extracted.standingHeight).toBe(1.8)
    expect(extracted).not.toHaveProperty('carryClip')
    expect(extracted).not.toHaveProperty('armCarry')
  })
})

describe('humanoid.v1 masculine geometry fixture', () => {
  it('has human nominal and real leg proportions', () => {
    const fixture = JSON.parse(readFileSync(MASCULINE_FIXTURE, 'utf8'))
    const geometry = buildRigGeometry(fixture.joints, 1, fixture.standingHeight)
    const nominalHumanLeg = 0.48 * 1.8

    expect(Math.abs(geometry.nominalLegLength - nominalHumanLeg) / nominalHumanLeg).toBeLessThan(0.05)
    expect(geometry.legLength).toBeCloseTo(0.77, 2)
  })
})
