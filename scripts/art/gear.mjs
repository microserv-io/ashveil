#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const RUNNER = join(ROOT, 'scripts', 'art', 'gear', 'run.py')
const CLIP = join(ROOT, 'scripts', 'art', 'gear', 'clip.ts')
const CLIP_ARGUMENT = join('scripts', 'art', 'gear', 'clip.ts')
const BLENDER_CANDIDATES = ['/opt/homebrew/bin/blender', '/usr/local/bin/blender', 'blender']
const FLAGS = new Set(['--no-mask'])
const VALUES = new Set(['--input', '--slot', '--body', '--piece', '--weights', '--covers', '--span', '--yaw', '--under', '--outdir'])
const NAME = /^[a-z0-9][a-z0-9-]*$/
const SPAN = /^[XYZ]:[a-z0-9_]+:[a-z0-9_]+(:[0-9]+(\.[0-9]+)?)?$/

export class GearError extends Error {}

export function parseArgs(argv) {
  const parsed = { noMask: false }
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at]
    if (FLAGS.has(flag)) parsed.noMask = true
    else if (VALUES.has(flag)) {
      const value = argv[++at]
      if (value === undefined) throw new GearError(`argument gate: ${flag} needs a value`)
      parsed[flag.slice(2)] = value
    } else throw new GearError(`argument gate: unknown argument "${flag}"`)
  }
  for (const required of ['input', 'slot', 'body', 'piece']) {
    if (!parsed[required]) throw new GearError(`argument gate: --${required} is required`)
  }
  for (const name of ['body', 'piece']) {
    if (!NAME.test(parsed[name])) throw new GearError(`argument gate: --${name} "${parsed[name]}" is not a lowercase name a path can carry`)
  }
  if (parsed.weights && !['transfer', 'stiff', 'rigid'].includes(parsed.weights)) {
    throw new GearError(`weight gate: unknown mode "${parsed.weights}"`)
  }
  if (parsed.span && !SPAN.test(parsed.span)) {
    throw new GearError(`span gate: "${parsed.span}" is not AXIS:FROM:TO[:FACTOR]`)
  }
  // Sources face +Z by contract, so a turned piece is told, never guessed.
  if (parsed.yaw && !['0', '180'].includes(parsed.yaw)) {
    throw new GearError(`yaw gate: "${parsed.yaw}" is not 0 or 180`)
  }
  return parsed
}

export function resolvePlan(parsed, { root = ROOT, exists = existsSync } = {}) {
  const contract = JSON.parse(readFileSync(join(root, 'scripts', 'art', 'contracts', 'humanoid.v1.json'), 'utf8'))
  if (!contract.slots[parsed.slot]) throw new GearError(`slot gate: unknown slot "${parsed.slot}"`)
  const covers = parsed.noMask
    ? []
    : (parsed.covers?.split(',') ?? contract.slots[parsed.slot].defaultCovers).map((name) => name.trim())
  for (const name of covers) {
    if (!contract.slots[name]) throw new GearError(`slot gate: unknown covered slot "${name}"`)
  }
  const proxy = parsed.input.startsWith('proxy:')
  if (proxy) {
    const sourceSlot = parsed.input.slice('proxy:'.length)
    if (!contract.slots[sourceSlot]) throw new GearError(`slot gate: unknown proxy slot "${sourceSlot}"`)
    if (contract.slots[parsed.slot].pair && !contract.slots[sourceSlot].pair) {
      throw new GearError(`pair gate: ${parsed.input} is not a pair`)
    }
  } else {
    const input = resolve(root, parsed.input)
    if (!exists(input)) throw new GearError(`input gate: no file at ${input}`)
    parsed = { ...parsed, input }
  }
  const bodydir = join(root, 'public', 'bodies', parsed.body)
  for (const suffix of ['glb', 'manifest.json', 'masks.json']) {
    const path = join(bodydir, `${parsed.body}.${suffix}`)
    if (!exists(path)) throw new GearError(`body gate: no file at ${path}`)
  }
  // A piece worn over another is fitted against that piece as well as the skin, so
  // the one underneath has to be fitted and shipped before this one is.
  const under = parsed.under ? parsed.under.split(',').map((name) => name.trim()).filter(Boolean) : []
  for (const name of under) {
    if (!NAME.test(name)) throw new GearError(`under gate: "${name}" is not a lowercase name a path can carry`)
    if (name === parsed.piece) throw new GearError(`under gate: ${name} cannot be worn under itself`)
    for (const suffix of ['glb', 'manifest.json']) {
      const path = join(root, 'public', 'gear', name, `${name}.${suffix}`)
      if (!exists(path)) throw new GearError(`under gate: no fitted piece at ${path}`)
    }
  }
  const outdir = parsed.outdir ? resolve(root, parsed.outdir) : join(root, 'public', 'gear', parsed.piece)
  // The clip gate is handed the directory and reads the piece out of its name,
  // so a directory named after anything else is a piece nothing downstream finds.
  if (basename(outdir) !== parsed.piece) {
    throw new GearError(`argument gate: --outdir "${outdir}" is not named after the piece "${parsed.piece}"`)
  }
  return { ...parsed, covers, under, outdir }
}

export function blenderArgs(plan, runner = RUNNER) {
  return ['--background', '--factory-startup', '--python-exit-code', '1', '--python', runner, '--',
    '--input', plan.input, '--slot', plan.slot, '--body', plan.body, '--piece', plan.piece,
    '--outdir', plan.outdir,
    ...(plan.weights ? ['--weights', plan.weights] : []),
    ...(plan.covers.length > 0 ? ['--covers', plan.covers.join(',')] : []),
    ...(plan.span ? ['--span', plan.span] : []),
    ...(plan.yaw ? ['--yaw', plan.yaw] : []),
    ...(plan.under.length > 0 ? ['--under', plan.under.join(',')] : []),
    ...(plan.noMask ? ['--no-mask'] : [])]
}

function findBlender(exists = existsSync) {
  const named = process.env.ASHVEIL_BLENDER
  if (named) {
    if (!exists(named)) throw new GearError(`blender gate: ASHVEIL_BLENDER points at ${named}, which is not there`)
    return named
  }
  const found = BLENDER_CANDIDATES.find((candidate) => candidate === 'blender' || exists(candidate))
  if (!found) throw new GearError('blender gate: no blender found; set ASHVEIL_BLENDER')
  return found
}

function readClipGates(stdout) {
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object') return value.gates ?? value
    } catch {}
  }
  throw new GearError('clip gate: clip.ts did not print a JSON gate table')
}

export function mergeClip(plan, gates) {
  const manifestPath = join(plan.outdir, `${plan.piece}.manifest.json`)
  const reportPath = join(plan.outdir, `${plan.piece}.report.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  Object.assign(manifest.gates, gates)
  Object.assign(report.gates, gates)
  report.gatesPass = Object.values(report.gates).every(Boolean)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}

export function run(plan) {
  const fitted = spawnSync(findBlender(), blenderArgs(plan), { cwd: ROOT, encoding: 'utf8' })
  process.stdout.write(fitted.stdout ?? '')
  process.stderr.write(fitted.stderr ?? '')
  if (fitted.error) throw new GearError(`blender gate: ${fitted.error.message}`)
  if (fitted.status === null) throw new GearError(`blender gate: Blender terminated by ${fitted.signal ?? 'a signal'}`)
  if (fitted.status !== 0) return fitted.status

  if (!existsSync(CLIP)) {
    console.warn(`clip gate warning: ${CLIP} does not exist yet; skipping clip gates`)
    return 0
  }
  const clipped = spawnSync(process.execPath,
    ['--import', 'tsx', CLIP_ARGUMENT, '--piece', plan.outdir], { cwd: ROOT, encoding: 'utf8' })
  process.stdout.write(clipped.stdout ?? '')
  process.stderr.write(clipped.stderr ?? '')
  let gates
  try {
    gates = readClipGates(clipped.stdout ?? '')
  } catch (error) {
    if (clipped.status !== 0 || clipped.error) {
      rmSync(join(plan.outdir, `${plan.piece}.glb`), { force: true })
      throw new GearError(`clip gate: ${clipped.error?.message ?? `exit ${clipped.status}`}`)
    }
    throw error
  }
  mergeClip(plan, gates)
  const failed = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name).sort()
  if (clipped.error) throw new GearError(`clip gate: ${clipped.error.message}`)
  if (clipped.status !== 0 || failed.length) {
    rmSync(join(plan.outdir, `${plan.piece}.glb`), { force: true })
    throw new GearError(`clip gate failed: ${failed.join(', ') || `exit ${clipped.status}`}`)
  }
  return 0
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = run(resolvePlan(parseArgs(process.argv.slice(2))))
  } catch (error) {
    if (!(error instanceof GearError)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}
