import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const BODY = 'masculine-v3'
const COMMITTED = join(ROOT, 'public', 'bodies', BODY)
const MANIFEST = JSON.parse(readFileSync(join(COMMITTED, `${BODY}.manifest.json`), 'utf8'))
const SOURCE = join(ROOT, 'docs', 'art-pipeline', 'sources', MANIFEST.source.file)
const BLENDER = process.env.ASHVEIL_BLENDER ?? '/opt/homebrew/bin/blender'

const ARTEFACTS = ['glb', 'manifest.json', 'report.json', 'review.png'] as const
const runnable = existsSync(BLENDER) && existsSync(SOURCE)
const scratch: string[] = []

afterAll(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * The gates that need Blender, run against the body that is checked in.
 *
 * Refitting the committed body from its own raw source and comparing the bytes
 * asserts three things at once: the pipeline still passes every gate, it is
 * deterministic, and the body in the repository is the one this code produces
 * rather than one somebody once produced by hand.
 */
describe.skipIf(!runnable)('the fitter, end to end', () => {
  const out = mkdtempSync(join(tmpdir(), 'ashveil-fit-'))
  scratch.push(out)
  const result = spawnSync(process.execPath,
    [join(ROOT, 'scripts', 'art', 'fit.mjs'), '--input', SOURCE, '--family', 'humanoid',
      '--body', BODY, '--helpers', '--outdir', out],
    { cwd: ROOT, encoding: 'utf8' })

  it('passes every gate on the masculine body', () => {
    expect(result.status, result.stderr).toBe(0)
    const report = JSON.parse(readFileSync(join(out, `${BODY}.report.json`), 'utf8'))
    const failed = Object.entries(report.gates).filter(([, passed]) => !passed).map(([gate]) => gate)
    expect(failed).toEqual([])
    expect(report.gatesPass).toBe(true)
  })

  it.each(ARTEFACTS)('reproduces the committed %s byte for byte', (extension) => {
    expect(digest(join(out, `${BODY}.${extension}`))).toBe(digest(join(COMMITTED, `${BODY}.${extension}`)))
  })

  it('refuses a family it has no contract for, with a named gate', () => {
    const refused = spawnSync(process.execPath,
      [join(ROOT, 'scripts', 'art', 'fit.mjs'), '--input', SOURCE, '--family', 'lizard',
        '--body', 'nothing', '--outdir', join(out, 'refused')],
      { cwd: ROOT, encoding: 'utf8' })
    expect(refused.status).toBe(1)
    expect(refused.stderr + refused.stdout).toMatch(/family gate: no contract at/)
  })
})

describe.skipIf(runnable)('the fitter, end to end', () => {
  it('is skipped because Blender or the raw source is not on this machine', () => {
    expect(runnable).toBe(false)
  })
})
