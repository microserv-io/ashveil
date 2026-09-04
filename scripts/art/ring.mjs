#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * `npm run art:ring` - ring placement for a loop piece, on its own path.
 *
 * Deliberately thin next to `gear.mjs`: the ring rule has no covers, no span, no
 * yaw search and no drapes, so the wrapper has nothing to validate but the paths.
 * A failing budget gate does not delete the GLB here, because the point of the
 * spike is to look at what full source detail costs and see it on the body.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const RUNNER = join(ROOT, 'scripts', 'art', 'gear', 'ring.py')
const BLENDER_CANDIDATES = ['/opt/homebrew/bin/blender', '/usr/local/bin/blender', 'blender']
const VALUES = new Set(['--input', '--slot', '--body', '--piece', '--under', '--weights', '--yaw',
  '--bins', '--passes', '--seat', '--outdir'])
const SWITCHES = new Set(['--no-conform'])
const NAME = /^[a-z0-9][a-z0-9-]*$/

export class RingError extends Error {}

export function parseArgs(argv) {
  const parsed = {}
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at]
    if (SWITCHES.has(flag)) {
      parsed[flag.slice(2)] = true
      continue
    }
    if (!VALUES.has(flag)) throw new RingError(`argument gate: unknown argument "${flag}"`)
    const value = argv[++at]
    if (value === undefined) throw new RingError(`argument gate: ${flag} needs a value`)
    parsed[flag.slice(2)] = value
  }
  for (const required of ['input', 'body', 'piece']) {
    if (!parsed[required]) throw new RingError(`argument gate: --${required} is required`)
  }
  for (const name of ['body', 'piece']) {
    if (!NAME.test(parsed[name])) {
      throw new RingError(`argument gate: --${name} "${parsed[name]}" is not a lowercase name a path can carry`)
    }
  }
  if (parsed.yaw && !['0', '180'].includes(parsed.yaw)) {
    throw new RingError(`yaw gate: "${parsed.yaw}" is not 0 or 180`)
  }
  if (parsed.seat && !['strap', 'merged', 'layers'].includes(parsed.seat)) {
    throw new RingError(`seat gate: "${parsed.seat}" is not strap, merged or layers`)
  }
  return parsed
}

export function resolvePlan(parsed, { root = ROOT, exists = existsSync } = {}) {
  const input = resolve(root, parsed.input)
  if (!exists(input)) throw new RingError(`input gate: no file at ${input}`)
  for (const suffix of ['glb', 'manifest.json', 'masks.json']) {
    const path = join(root, 'public', 'bodies', parsed.body, `${parsed.body}.${suffix}`)
    if (!exists(path)) throw new RingError(`body gate: no file at ${path}`)
  }
  for (const name of (parsed.under ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    const path = join(root, 'public', 'gear', name, `${name}.glb`)
    if (!exists(path)) throw new RingError(`under gate: no fitted piece at ${path}`)
  }
  const outdir = parsed.outdir ? resolve(root, parsed.outdir) : join(root, 'public', 'gear', parsed.piece)
  if (basename(outdir) !== parsed.piece) {
    throw new RingError(`argument gate: --outdir "${outdir}" is not named after the piece "${parsed.piece}"`)
  }
  return { ...parsed, input, outdir }
}

export function blenderArgs(plan, runner = RUNNER) {
  return ['--background', '--factory-startup', '--python-exit-code', '1', '--python', runner, '--',
    '--input', plan.input, '--body', plan.body, '--piece', plan.piece, '--outdir', plan.outdir,
    ...(plan.slot ? ['--slot', plan.slot] : []),
    ...(plan.under ? ['--under', plan.under] : []),
    ...(plan.weights ? ['--weights', plan.weights] : []),
    ...(plan.yaw ? ['--yaw', plan.yaw] : []),
    ...(plan.bins ? ['--bins', plan.bins] : []),
    ...(plan.passes ? ['--passes', plan.passes] : []),
    ...(plan.seat ? ['--seat', plan.seat] : []),
    ...(plan['no-conform'] ? ['--no-conform'] : [])]
}

function findBlender(exists = existsSync) {
  const named = process.env.ASHVEIL_BLENDER
  if (named) {
    if (!exists(named)) throw new RingError(`blender gate: ASHVEIL_BLENDER points at ${named}, which is not there`)
    return named
  }
  const found = BLENDER_CANDIDATES.find((candidate) => candidate === 'blender' || exists(candidate))
  if (!found) throw new RingError('blender gate: no blender found; set ASHVEIL_BLENDER')
  return found
}

export function run(plan) {
  const fitted = spawnSync(findBlender(), blenderArgs(plan), { cwd: ROOT, encoding: 'utf8' })
  process.stdout.write(fitted.stdout ?? '')
  process.stderr.write(fitted.stderr ?? '')
  if (fitted.error) throw new RingError(`blender gate: ${fitted.error.message}`)
  if (fitted.status === null) throw new RingError(`blender gate: Blender terminated by ${fitted.signal ?? 'a signal'}`)
  return fitted.status
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = run(resolvePlan(parseArgs(process.argv.slice(2))))
  } catch (error) {
    if (!(error instanceof RingError)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}
