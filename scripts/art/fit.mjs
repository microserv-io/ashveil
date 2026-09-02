#!/usr/bin/env node
/**
 * `npm run art:fit -- --input <tripo.glb|fbx> --family humanoid --body <name> [--helpers]`
 *
 * One command per body, and no judgment in it. The wrapper only checks that the
 * arguments name real things and that Blender is here, then hands over to
 * `scripts/art/fit/run.py`; every gate lives in the pipeline, where it can see
 * what it is gating. A non-zero exit means a named gate refused the body.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const RUNNER = join(ROOT, 'scripts', 'art', 'fit', 'run.py')
const BODIES = join(ROOT, 'public', 'bodies')
const BLENDER_CANDIDATES = ['/opt/homebrew/bin/blender', '/usr/local/bin/blender', 'blender']
const FLAGS = new Set(['--helpers'])
const VALUES = new Set(['--input', '--family', '--body', '--outdir'])
const NAME = /^[a-z0-9][a-z0-9-]*$/

export class FitError extends Error {}

export function parseArgs(argv) {
  const parsed = { helpers: false }
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at]
    if (FLAGS.has(flag)) parsed[flag.slice(2)] = true
    else if (VALUES.has(flag)) {
      const value = argv[++at]
      if (value === undefined) throw new FitError(`argument gate: ${flag} needs a value`)
      parsed[flag.slice(2)] = value
    } else throw new FitError(`argument gate: unknown argument "${flag}"`)
  }
  for (const required of ['input', 'family', 'body']) {
    if (!parsed[required]) throw new FitError(`argument gate: --${required} is required`)
  }
  if (!NAME.test(parsed.body)) {
    throw new FitError(`argument gate: --body "${parsed.body}" is not a lowercase name a path can carry`)
  }
  if (!NAME.test(parsed.family)) throw new FitError(`argument gate: --family "${parsed.family}" is not a family name`)
  return parsed
}

export function resolvePlan(parsed, { root = ROOT, exists = existsSync } = {}) {
  const input = resolve(root, parsed.input)
  if (!exists(input)) throw new FitError(`input gate: no file at ${input}`)
  const contract = join(root, 'scripts', 'art', 'contracts', `${familyContract(parsed.family)}.json`)
  if (!exists(contract)) throw new FitError(`family gate: no contract at ${contract}`)
  return {
    input,
    family: familyContract(parsed.family),
    body: parsed.body,
    helpers: parsed.helpers === true,
    outdir: parsed.outdir ? resolve(root, parsed.outdir) : join(BODIES, parsed.body),
  }
}

/** A family is named on the command line without its version; the contract carries it. */
export function familyContract(family) {
  return family.includes('.') ? family : `${family}.v1`
}

export function blenderArgs(plan, runner = RUNNER) {
  return ['--background', '--factory-startup', '--python-exit-code', '1', '--python', runner, '--',
    '--input', plan.input, '--family', plan.family, '--body', plan.body, '--outdir', plan.outdir,
    ...(plan.helpers ? ['--helpers'] : [])]
}

function findBlender(exists = existsSync) {
  const named = process.env.ASHVEIL_BLENDER
  if (named) {
    if (!exists(named)) throw new FitError(`blender gate: ASHVEIL_BLENDER points at ${named}, which is not there`)
    return named
  }
  const found = BLENDER_CANDIDATES.find((candidate) => candidate === 'blender' || exists(candidate))
  if (!found) throw new FitError('blender gate: no blender found; set ASHVEIL_BLENDER')
  return found
}

if (process.argv[1] === import.meta.filename) {
  try {
    const plan = resolvePlan(parseArgs(process.argv.slice(2)))
    const result = spawnSync(findBlender(), blenderArgs(plan), { stdio: 'inherit', cwd: ROOT })
    if (result.error) throw new FitError(`blender gate: ${result.error.message}`)
    process.exit(result.status ?? 1)
  } catch (error) {
    if (!(error instanceof FitError)) throw error
    console.error(error.message)
    process.exit(1)
  }
}
