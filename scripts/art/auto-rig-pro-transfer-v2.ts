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

type TransferV2Args = { source: string; target: string; output: string }

type SourceMotion = {
  pass?: boolean
  path?: string
  sha256?: string
  frames?: number
  fps?: number
  sampleSpanSeconds?: number
}

type SourceClip = { id?: string; sourceMotion?: SourceMotion }

type SourceReport = {
  schemaVersion?: string
  retargetReady?: boolean
  fps?: number
  terminalPalmRollObservable?: boolean
  clips?: SourceClip[]
}

type TransferV2Report = {
  schemaVersion?: string
  objectiveAcceptance?: { pass?: boolean }
  sourceConvention?: { pass?: boolean }
  sourceVerticalNormalization?: { pass?: boolean }
  restFrameAlignment?: { pass?: boolean }
  target?: { unchanged?: boolean }
  retargetSkeletal?: { pass?: boolean }
  exportParity?: { clipTimingPass?: boolean; pass?: boolean }
  meshDeformation?: { pass?: boolean }
  humanReview?: { pass?: boolean }
  canonicalViewerPromoted?: boolean
}

export type TransferV2Source = {
  directory: string
  reportPath: string
  report: SourceReport
  clips: Array<{
    id: 'walk' | 'sprint'
    path: string
    sha256: string
    frames: number
    sampleSpanSeconds: number
  }>
}

const usage =
  'Usage: tsx scripts/art/auto-rig-pro-transfer-v2.ts --source <MoMask-source-directory> --target <accepted-ARP.blend> --output <transfer-v2-output-directory>'
const clipIds = ['walk', 'sprint'] as const
const contractPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'contracts/momask-to-auto-rig-pro.transfer-v2.bmap',
)
const canonicalOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro',
)

export const momaskAutoRigProTransferV2MapSha256 =
  'a0704448ac716e98875b05773e98071e8813c9c1a83cecab73c9db167848047a'

export const autoRigProTransferV2ArtifactNames = [
  'masculine-auto-rig-pro-transfer-v2.blend',
  'masculine-auto-rig-pro-transfer-v2-diagnostic.glb',
  'report.json',
] as const

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function parseAutoRigProTransferV2Args(args: string[]): TransferV2Args {
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

function requireInteger(value: unknown, message: string): number {
  if (!Number.isInteger(value)) throw new Error(message)
  return value as number
}

export function assertTransferV2Source(sourceArgument: string): TransferV2Source {
  const directory = realpathSync(resolve(sourceArgument))
  const reportPath = resolve(directory, 'report.json')
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SourceReport
  if (report.schemaVersion !== 'ashveil.momask-source.v1') {
    throw new Error('MoMask source report must use ashveil.momask-source.v1.')
  }
  if (report.retargetReady !== true) {
    throw new Error('MoMask source report must explicitly mark retargetReady=true.')
  }
  if (report.fps !== 20) throw new Error('MoMask source report must retain native 20 fps timing.')
  if (report.terminalPalmRollObservable !== false) {
    throw new Error('MoMask source report must declare terminal palm roll unobservable.')
  }
  if (!Array.isArray(report.clips)) throw new Error('MoMask source report has no clips.')

  const clips = clipIds.map((id) => {
    const sourceMotion = report.clips!.find((candidate) => candidate.id === id)?.sourceMotion
    if (sourceMotion?.pass !== true) {
      throw new Error(`${id} must explicitly mark sourceMotion.pass=true before transfer.`)
    }
    const relativePath = `${id}/game_loop_basic_ik.bvh`
    if (sourceMotion.path !== relativePath) {
      throw new Error(`${id} sourceMotion.path must be ${relativePath}.`)
    }
    if (!/^[a-f0-9]{64}$/.test(sourceMotion.sha256 ?? '')) {
      throw new Error(`${id} sourceMotion.sha256 is missing or invalid.`)
    }
    const frames = requireInteger(sourceMotion.frames, `${id} sourceMotion.frames must be an integer.`)
    if (frames < 3 || frames % 2 !== 1) {
      throw new Error(`${id} must have an odd frame count for exact 20-to-30 fps retiming.`)
    }
    if (sourceMotion.fps !== 20) throw new Error(`${id} sourceMotion must retain native 20 fps timing.`)
    const sampleSpanSeconds = sourceMotion.sampleSpanSeconds
    if (typeof sampleSpanSeconds !== 'number') {
      throw new Error(`${id} sourceMotion.sampleSpanSeconds is missing.`)
    }
    if (Math.abs(sampleSpanSeconds - (frames - 1) / 20) > 1e-8) {
      throw new Error(`${id} sourceMotion duration does not match its frame count.`)
    }
    const path = resolve(directory, relativePath)
    if (!existsSync(path)) throw new Error(`${id} is missing source BVH: ${relativePath}`)
    const realPath = realpathSync(path)
    if (!isPathInside(directory, realPath)) throw new Error(`${id} source BVH escapes its source directory.`)
    if (sha256(realPath) !== sourceMotion.sha256) throw new Error(`${id} source BVH hash changed.`)
    return { id, path: realPath, sha256: sourceMotion.sha256, frames, sampleSpanSeconds }
  })

  return { directory, reportPath, report, clips }
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
  const report = JSON.parse(readFileSync(path, 'utf8')) as TransferV2Report
  const objectiveGates = [
    report.objectiveAcceptance?.pass,
    report.sourceConvention?.pass,
    report.sourceVerticalNormalization?.pass,
    report.restFrameAlignment?.pass,
    report.target?.unchanged,
    report.retargetSkeletal?.pass,
    report.exportParity?.clipTimingPass,
  ]
  if (report.schemaVersion !== 'ashveil.auto-rig-pro-transfer-v2' || objectiveGates.some((pass) => pass !== true)) {
    throw new Error('Transfer v2 completed without every objective diagnostic gate passing.')
  }
  if (
    report.meshDeformation?.pass !== false ||
    report.exportParity?.pass !== false ||
    report.humanReview?.pass !== false ||
    report.canonicalViewerPromoted !== false
  ) {
    throw new Error('Transfer v2 must remain fail-closed for unmeasured production gates.')
  }
}

function run(): void {
  const args = parseAutoRigProTransferV2Args(process.argv.slice(2))
  const source = assertTransferV2Source(args.source)
  const target = realpathSync(resolve(args.target))
  const output = resolve(args.output)
  if (output === parse(output).root || output === canonicalOutput || isPathInside(canonicalOutput, output)) {
    throw new Error('Transfer v2 diagnostics cannot replace or write inside the canonical ARP viewer directory.')
  }
  if (isPathInside(source.directory, output) || isPathInside(output, source.directory)) {
    throw new Error('Transfer v2 output and MoMask source directories cannot contain one another.')
  }
  if (sha256(contractPath) !== momaskAutoRigProTransferV2MapSha256) {
    throw new Error('The frozen transfer v2 mapping hash changed.')
  }
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) throw new Error('Blender was not found. Set BLENDER_BIN to its executable.')

  mkdirSync(dirname(output), { recursive: true })
  const stagingOutput = mkdtempSync(join(dirname(output), '.auto-rig-pro-transfer-v2-'))
  const targetHash = sha256(target)
  const result = spawnSync(
    blender,
    [
      '--background',
      target,
      '--python-exit-code',
      '1',
      '--python',
      resolve(dirname(fileURLToPath(import.meta.url)), 'auto-rig-pro-transfer-v2.py'),
      '--',
      '--source',
      source.directory,
      '--source-report',
      source.reportPath,
      '--map',
      contractPath,
      '--output',
      stagingOutput,
    ],
    { stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) {
    rmSync(stagingOutput, { recursive: true, force: true })
    if (result.error) throw result.error
    throw new Error(`Auto-Rig Pro transfer v2 failed with exit code ${result.status ?? 'unknown'}.`)
  }
  if (sha256(target) !== targetHash) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error('The accepted ARP target blend changed during transfer v2.')
  }
  const missing = autoRigProTransferV2ArtifactNames.find((name) => !existsSync(resolve(stagingOutput, name)))
  if (missing) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error(`Transfer v2 completed without required artifact: ${missing}`)
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
