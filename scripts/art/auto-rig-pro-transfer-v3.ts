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
import { assertTransferV2Source } from './auto-rig-pro-transfer-v2'

type TransferV3Args = { source: string; target: string; output: string }

type TransferV3Report = {
  schemaVersion?: string
  objectiveAcceptance?: { pass?: boolean }
  inheritedV2?: { pass?: boolean }
  groundContact?: { pass?: boolean }
  legKinematics?: { pass?: boolean }
  loopContinuity?: { pass?: boolean }
  renderReview?: { pass?: boolean }
  meshDeformation?: { pass?: boolean }
  exportParity?: { clipTimingPass?: boolean; pass?: boolean }
  humanReview?: { pass?: boolean }
  productionPass?: boolean
  canonicalViewerPromoted?: boolean
}

const usage =
  'Usage: tsx scripts/art/auto-rig-pro-transfer-v3.ts --source <MoMask-source-directory> --target <accepted-ARP.blend> --output <transfer-v3-output-directory>'
const canonicalOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro',
)

export const autoRigProTransferV3ArtifactNames = [
  'masculine-auto-rig-pro-transfer-v3.blend',
  'masculine-auto-rig-pro-transfer-v3-diagnostic.glb',
  'report.json',
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

export function parseAutoRigProTransferV3Args(args: string[]): TransferV3Args {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(usage)
    values.set(key, value)
  }
  const source = values.get('--source')
  const target = values.get('--target')
  const output = values.get('--output')
  if (!source || !target || !output || values.size !== 3) throw new Error(usage)
  return { source, target, output }
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

function assertGeneratedReport(path: string): void {
  const report = JSON.parse(readFileSync(path, 'utf8')) as TransferV3Report
  const objectiveGates = [
    report.objectiveAcceptance?.pass,
    report.inheritedV2?.pass,
    report.groundContact?.pass,
    report.legKinematics?.pass,
    report.loopContinuity?.pass,
    report.renderReview?.pass,
    report.exportParity?.clipTimingPass,
  ]
  if (report.schemaVersion !== 'ashveil.auto-rig-pro-transfer-v3' || objectiveGates.some((pass) => pass !== true)) {
    throw new Error('Transfer v3 completed without every objective diagnostic gate passing.')
  }
  if (
    report.meshDeformation?.pass !== false ||
    report.exportParity?.pass !== false ||
    report.humanReview?.pass !== false ||
    report.productionPass !== false ||
    report.canonicalViewerPromoted !== false
  ) {
    throw new Error('Transfer v3 must remain fail-closed for unmeasured production gates.')
  }
}

function run(): void {
  const args = parseAutoRigProTransferV3Args(process.argv.slice(2))
  const source = assertTransferV2Source(args.source)
  const target = realpathSync(resolve(args.target))
  const output = resolve(args.output)
  if (output === parse(output).root || output === canonicalOutput || isPathInside(canonicalOutput, output)) {
    throw new Error('Transfer v3 diagnostics cannot replace or write inside the canonical ARP viewer directory.')
  }
  if (isPathInside(source.directory, output) || isPathInside(output, source.directory)) {
    throw new Error('Transfer v3 output and MoMask source directories cannot contain one another.')
  }
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) throw new Error('Blender was not found. Set BLENDER_BIN to its executable.')

  mkdirSync(dirname(output), { recursive: true })
  const stagingOutput = mkdtempSync(join(dirname(output), '.auto-rig-pro-transfer-v3-'))
  const targetHash = sha256(target)
  const result = spawnSync(
    blender,
    [
      '--background',
      target,
      '--python-exit-code',
      '1',
      '--python',
      resolve(dirname(fileURLToPath(import.meta.url)), 'auto-rig-pro-transfer-v3.py'),
      '--',
      '--source',
      source.directory,
      '--source-report',
      source.reportPath,
      '--map',
      resolve(dirname(fileURLToPath(import.meta.url)), 'contracts/momask-to-auto-rig-pro.transfer-v2.bmap'),
      '--output',
      stagingOutput,
    ],
    { stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) {
    rmSync(stagingOutput, { recursive: true, force: true })
    if (result.error) throw result.error
    throw new Error(`Auto-Rig Pro transfer v3 failed with exit code ${result.status ?? 'unknown'}.`)
  }
  if (sha256(target) !== targetHash) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error('The accepted ARP target blend changed during transfer v3.')
  }
  const missing = autoRigProTransferV3ArtifactNames.find((name) => !existsSync(resolve(stagingOutput, name)))
  if (missing) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error(`Transfer v3 completed without required artifact: ${missing}`)
  }
  try {
    assertGeneratedReport(resolve(stagingOutput, 'report.json'))
  } catch (error) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw error
  }

  const previousOutput = `${output}.previous-${process.pid}`
  if (existsSync(output)) renameSync(output, previousOutput)
  try {
    renameSync(stagingOutput, output)
    rmSync(previousOutput, { recursive: true, force: true })
  } catch (error) {
    if (existsSync(previousOutput) && !existsSync(output)) renameSync(previousOutput, output)
    rmSync(stagingOutput, { recursive: true, force: true })
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
