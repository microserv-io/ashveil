import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { blenderCandidates, isPathInside } from './character-spike'

type ProceduralArgs = { target: string; output: string }

const usage =
  'Usage: tsx scripts/art/auto-rig-pro-procedural-v1.ts --target <accepted-ARP.blend> --output <procedural-output-directory>'
const canonicalOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro',
)

export const autoRigProProceduralV1ArtifactNames = [
  'masculine-auto-rig-pro-procedural-v1.blend',
  'masculine-auto-rig-pro-procedural-v1-diagnostic.glb',
  'report.json',
  'renders/idle-front.png',
  'renders/idle-right.png',
  'renders/idle-back.png',
  'renders/walk-front.png',
  'renders/walk-right.png',
  'renders/walk-back.png',
  'renders/sprint-front.png',
  'renders/sprint-right.png',
  'renders/sprint-back.png',
] as const

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function parseAutoRigProProceduralV1Args(args: string[]): ProceduralArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(usage)
    values.set(key, value)
  }
  const target = values.get('--target')
  const output = values.get('--output')
  if (!target || !output || values.size !== 2) throw new Error(usage)
  return { target, output }
}

function canExecute(candidate: string): boolean {
  if (!candidate.includes('/')) return spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function run(): void {
  const args = parseAutoRigProProceduralV1Args(process.argv.slice(2))
  const target = realpathSync(resolve(args.target))
  const output = resolve(args.output)
  if (output === parse(output).root || output === canonicalOutput || isPathInside(canonicalOutput, output)) {
    throw new Error('Procedural v1 cannot replace or write inside the canonical ARP viewer directory.')
  }
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) throw new Error('Blender was not found. Set BLENDER_BIN to its executable.')
  mkdirSync(dirname(output), { recursive: true })
  const staging = mkdtempSync(join(dirname(output), '.auto-rig-pro-procedural-v1-'))
  const targetHash = sha256(target)
  const result = spawnSync(
    blender,
    [
      '--background',
      target,
      '--python-exit-code',
      '1',
      '--python',
      resolve(dirname(fileURLToPath(import.meta.url)), 'auto-rig-pro-procedural-v1.py'),
      '--',
      '--output',
      staging,
    ],
    { stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) {
    rmSync(staging, { recursive: true, force: true })
    if (result.error) throw result.error
    throw new Error(`Auto-Rig Pro procedural v1 failed with exit code ${result.status ?? 'unknown'}.`)
  }
  if (sha256(target) !== targetHash) {
    rmSync(staging, { recursive: true, force: true })
    throw new Error('The accepted ARP target changed during procedural v1.')
  }
  const missing = autoRigProProceduralV1ArtifactNames.find((name) => !existsSync(resolve(staging, name)))
  if (missing) {
    rmSync(staging, { recursive: true, force: true })
    throw new Error(`Procedural v1 completed without required artifact: ${missing}`)
  }
  const report = JSON.parse(readFileSync(resolve(staging, 'report.json'), 'utf8'))
  if (
    report.schemaVersion !== 'ashveil.auto-rig-pro-procedural-v1' ||
    report.objectiveAcceptance?.pass !== true ||
    report.humanReview?.pass !== false ||
    report.productionPass !== false ||
    report.canonicalViewerPromoted !== false
  ) {
    rmSync(staging, { recursive: true, force: true })
    throw new Error('Procedural v1 did not satisfy its fail-closed artifact contract.')
  }
  const previous = `${output}.previous-${process.pid}`
  if (existsSync(output)) renameSync(output, previous)
  try {
    renameSync(staging, output)
    rmSync(previous, { recursive: true, force: true })
  } catch (error) {
    if (existsSync(previous) && !existsSync(output)) renameSync(previous, output)
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
