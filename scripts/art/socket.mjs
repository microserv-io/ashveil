#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * `npm run art:socket` - socket placement for a piece hung on one joint, on its own path.
 *
 * Thin like `ring.mjs` and for the same reason: the socket rule has no covers, no span
 * and no yaw search, so the wrapper validates the paths, the drape spelling and the
 * authored pose, and nothing else. A failing budget gate does not delete the GLB,
 * because full source detail is the thing the spike exists to look at.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const RUNNER = join(ROOT, 'scripts', 'art', 'gear', 'socket.py')
const BLENDER_CANDIDATES = ['/opt/homebrew/bin/blender', '/usr/local/bin/blender', 'blender']
const VALUES = new Set(['--input', '--slot', '--body', '--piece', '--under', '--weights', '--yaw',
  '--cap', '--size', '--anchor', '--seat', '--register', '--inner', '--seeds', '--scale-mode',
  '--orient', '--offset', '--orient-right', '--offset-right', '--outdir'])
/** The pose flags, each bounded the same way whichever shoulder it is spoken for. */
const POSES = [['orient', 'degrees'], ['offset', 'metres'], ['orient-right', 'degrees'],
  ['offset-right', 'metres']]
const REPEATED = new Set(['--drape'])
const NAME = /^[a-z0-9][a-z0-9-]*$/
const DRAPE = /^[a-z][a-z0-9_]*:[A-Za-z0-9_]+:[01](\.[0-9]+)?:[01](\.[0-9]+)?(:[1-6](:[0-9]+(\.[0-9]+)?)?)?$/
const TRIPLE = /^-?[0-9]+(\.[0-9]+)?(:-?[0-9]+(\.[0-9]+)?){2}$/
const NUMBER = /^[0-9]+(\.[0-9]+)?$/
/** A cap narrower than the muscle is a pip and one at twice its width is a tabletop. */
const MIN_SIZE_FACTOR = 0.75
const MAX_SIZE_FACTOR = 2.5
/** Past a quarter turn a flag is correcting a wrong source rather than authoring a pose. */
const MAX_ORIENT_DEGREES = 90
/** A cap ten centimetres off its own crest is no longer on the shoulder. */
const MAX_OFFSET_METRES = 0.1

export class SocketError extends Error {}

export function parseArgs(argv) {
  const parsed = { drapes: [] }
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at]
    const value = argv[++at]
    if (REPEATED.has(flag)) {
      if (value === undefined) throw new SocketError(`argument gate: ${flag} needs a value`)
      parsed.drapes.push(value)
    } else if (VALUES.has(flag)) {
      if (value === undefined) throw new SocketError(`argument gate: ${flag} needs a value`)
      parsed[flag.slice(2)] = value
    } else {
      throw new SocketError(`argument gate: unknown argument "${flag}"`)
    }
  }
  for (const required of ['input', 'body', 'piece']) {
    if (!parsed[required]) throw new SocketError(`argument gate: --${required} is required`)
  }
  for (const name of ['body', 'piece']) {
    if (!NAME.test(parsed[name])) {
      throw new SocketError(`argument gate: --${name} "${parsed[name]}" is not a lowercase name a path can carry`)
    }
  }
  if (parsed.anchor && !['crest', 'deltoid', 'apex'].includes(parsed.anchor)) {
    throw new SocketError(`anchor gate: "${parsed.anchor}" is not crest, deltoid or apex`)
  }
  if (parsed.register && !['crest', 'icp', 'push'].includes(parsed.register)) {
    throw new SocketError(`register gate: "${parsed.register}" is not crest, icp or push`)
  }
  if (parsed.inner && !['normals', 'nearest'].includes(parsed.inner)) {
    throw new SocketError(`inner gate: "${parsed.inner}" is not normals or nearest`)
  }
  if (parsed.seeds && !['grid', 'none'].includes(parsed.seeds)) {
    throw new SocketError(`seeds gate: "${parsed.seeds}" is not grid or none`)
  }
  if (parsed['scale-mode'] && !['side', 'pair'].includes(parsed['scale-mode'])) {
    throw new SocketError(`scale-mode gate: "${parsed['scale-mode']}" is not side or pair`)
  }
  if (parsed.size !== undefined) {
    if (!NUMBER.test(parsed.size)) {
      throw new SocketError(`size gate: "${parsed.size}" is not a number`)
    }
    if (Number(parsed.size) < MIN_SIZE_FACTOR || Number(parsed.size) > MAX_SIZE_FACTOR) {
      throw new SocketError(`size gate: ${parsed.size} is outside the ${MIN_SIZE_FACTOR} to`
        + ` ${MAX_SIZE_FACTOR} deltoid widths a cap may span`)
    }
  }
  if (parsed.seat && !['none', 'clear', 'p95'].includes(parsed.seat)) {
    throw new SocketError(`seat gate: "${parsed.seat}" is not none, clear or p95`)
  }
  if (parsed.yaw && !['0', '180'].includes(parsed.yaw)) {
    throw new SocketError(`yaw gate: "${parsed.yaw}" is not 0 or 180`)
  }
  for (const [flag, unit] of POSES) {
    bounded(parsed[flag], flag, unit, unit === 'degrees' ? MAX_ORIENT_DEGREES : MAX_OFFSET_METRES)
  }
  for (const drape of parsed.drapes) {
    if (!DRAPE.test(drape)) throw new SocketError(`drape gate: "${drape}" is not name:bone:from:to[:segments]`)
  }
  const named = parsed.drapes.map((drape) => drape.split(':')[0])
  if (new Set(named).size !== named.length) {
    throw new SocketError(`drape gate: two drapes share a name in ${named.join(', ')}`)
  }
  return parsed
}

/** An authored pose is three numbers within reach of a shoulder, or it is a typo. */
function bounded(value, flag, unit, limit) {
  if (value === undefined) return
  if (!TRIPLE.test(value)) {
    throw new SocketError(`${flag} gate: "${value}" is not three numbers separated by colons`)
  }
  for (const each of value.split(':')) {
    if (Math.abs(Number(each)) > limit) {
      throw new SocketError(`${flag} gate: ${each} is past the ${limit} ${unit} an authored ${flag} may carry`)
    }
  }
}

export function resolvePlan(parsed, { root = ROOT, exists = existsSync } = {}) {
  const input = resolve(root, parsed.input)
  if (!exists(input)) throw new SocketError(`input gate: no file at ${input}`)
  for (const suffix of ['glb', 'manifest.json', 'masks.json']) {
    const path = join(root, 'public', 'bodies', parsed.body, `${parsed.body}.${suffix}`)
    if (!exists(path)) throw new SocketError(`body gate: no file at ${path}`)
  }
  for (const name of (parsed.under ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    const path = join(root, 'public', 'gear', name, `${name}.glb`)
    if (!exists(path)) throw new SocketError(`under gate: no fitted piece at ${path}`)
  }
  const outdir = parsed.outdir ? resolve(root, parsed.outdir) : join(root, 'public', 'gear', parsed.piece)
  if (basename(outdir) !== parsed.piece) {
    throw new SocketError(`argument gate: --outdir "${outdir}" is not named after the piece "${parsed.piece}"`)
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
    ...(plan.cap ? ['--cap', plan.cap] : []),
    ...(plan.size ? ['--size', plan.size] : []),
    ...(plan.anchor ? ['--anchor', plan.anchor] : []),
    ...(plan.seat ? ['--seat', plan.seat] : []),
    ...(plan.register ? ['--register', plan.register] : []),
    ...(plan.inner ? ['--inner', plan.inner] : []),
    ...(plan.seeds ? ['--seeds', plan.seeds] : []),
    ...(plan['scale-mode'] ? ['--scale-mode', plan['scale-mode']] : []),
    ...POSES.flatMap(([flag]) => (plan[flag] ? [`--${flag}`, plan[flag]] : [])),
    ...plan.drapes.flatMap((drape) => ['--drape', drape])]
}

function findBlender(exists = existsSync) {
  const named = process.env.ASHVEIL_BLENDER
  if (named) {
    if (!exists(named)) throw new SocketError(`blender gate: ASHVEIL_BLENDER points at ${named}, which is not there`)
    return named
  }
  const found = BLENDER_CANDIDATES.find((candidate) => candidate === 'blender' || exists(candidate))
  if (!found) throw new SocketError('blender gate: no blender found; set ASHVEIL_BLENDER')
  return found
}

export function run(plan) {
  const fitted = spawnSync(findBlender(), blenderArgs(plan), { cwd: ROOT, encoding: 'utf8' })
  process.stdout.write(fitted.stdout ?? '')
  process.stderr.write(fitted.stderr ?? '')
  if (fitted.error) throw new SocketError(`blender gate: ${fitted.error.message}`)
  if (fitted.status === null) throw new SocketError(`blender gate: Blender terminated by ${fitted.signal ?? 'a signal'}`)
  return fitted.status
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = run(resolvePlan(parseArgs(process.argv.slice(2))))
  } catch (error) {
    if (!(error instanceof SocketError)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}
