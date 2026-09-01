import { createHash } from 'node:crypto'
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
import { spawnSync } from 'node:child_process'
import { blenderCandidates, isPathInside } from './character-spike'

type RetargetArgs = { source: string; target: string; output: string }

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

export type RetargetSource = {
  directory: string
  reportPath: string
  report: SourceReport
  clips: Array<{
    id: 'idle' | 'walk' | 'sprint'
    path: string
    sha256: string
    frames: number
    sampleSpanSeconds: number
  }>
}

const usage =
  'Usage: tsx scripts/art/auto-rig-pro-retarget.ts --source <MoMask-source-directory> --target <accepted-ARP.blend> --output <retarget-output-directory>'
const clipIds = ['idle', 'walk', 'sprint'] as const
const contractPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'contracts/momask-to-auto-rig-pro.v1.bmap',
)
const canonicalOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro',
)

export const momaskAutoRigProMapSha256 =
  'd9b4566ab7f9344505545260530ad14e56f0daacab2cea181b90e26df2bc9324'

export const autoRigProRetargetArtifactNames = [
  'masculine-auto-rig-pro-retarget.blend',
  'masculine-auto-rig-pro-retarget-diagnostic.glb',
  'report.json',
] as const

type GeneratedRetargetReport = {
  schemaVersion?: unknown
  sourceMotion?: { pass?: unknown }
  mapping?: { pass?: unknown }
  target?: { unchanged?: unknown }
  retargetSkeletal?: { pass?: unknown }
  meshDeformation?: { pass?: unknown }
  exportParity?: { pass?: unknown; clipTimingPass?: unknown }
  humanReview?: { pass?: unknown }
  productionPass?: unknown
  canonicalViewerPromoted?: unknown
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function parseAutoRigProRetargetArgs(args: string[]): RetargetArgs {
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

export function assertRetargetSource(sourceArgument: string): RetargetSource {
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
    const clip = report.clips!.find((candidate) => candidate.id === id)
    const sourceMotion = clip?.sourceMotion
    if (sourceMotion?.pass !== true) {
      throw new Error(`${id} must explicitly mark sourceMotion.pass=true before retargeting.`)
    }
    const expectedRelativePath = `${id}/game_loop_basic_ik.bvh`
    if (sourceMotion.path !== expectedRelativePath) {
      throw new Error(`${id} sourceMotion.path must be ${expectedRelativePath}.`)
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
    const expectedSpan = (frames - 1) / 20
    if (Math.abs(sampleSpanSeconds - expectedSpan) > 1e-8) {
      throw new Error(`${id} sourceMotion duration does not match its frame count.`)
    }
    const path = resolve(directory, expectedRelativePath)
    if (!existsSync(path)) throw new Error(`${id} is missing source BVH: ${expectedRelativePath}`)
    const realPath = realpathSync(path)
    if (!isPathInside(directory, realPath)) throw new Error(`${id} source BVH escapes its source directory.`)
    if (sha256(realPath) !== sourceMotion.sha256) throw new Error(`${id} source BVH hash changed.`)
    return { id, path: realPath, sha256: sourceMotion.sha256, frames, sampleSpanSeconds }
  })

  if (report.clips.length !== clipIds.length) {
    throw new Error('MoMask source report must contain exactly idle, walk, and sprint.')
  }
  return { directory, reportPath, report, clips }
}

export function assertGeneratedRetargetReport(report: GeneratedRetargetReport): void {
  const requiredPassingFields: Array<[unknown, string]> = [
    [report.sourceMotion?.pass, 'sourceMotion.pass'],
    [report.mapping?.pass, 'mapping.pass'],
    [report.target?.unchanged, 'target.unchanged'],
    [report.retargetSkeletal?.pass, 'retargetSkeletal.pass'],
    [report.exportParity?.clipTimingPass, 'exportParity.clipTimingPass'],
  ]
  const requiredFailClosedFields: Array<[unknown, string]> = [
    [report.meshDeformation?.pass, 'meshDeformation.pass'],
    [report.exportParity?.pass, 'exportParity.pass'],
    [report.humanReview?.pass, 'humanReview.pass'],
    [report.productionPass, 'productionPass'],
    [report.canonicalViewerPromoted, 'canonicalViewerPromoted'],
  ]
  if (report.schemaVersion !== 'ashveil.auto-rig-pro-retarget.v1') {
    throw new Error('Generated retarget report schema is invalid.')
  }
  for (const [value, field] of requiredPassingFields) {
    if (value !== true) throw new Error(`Generated retarget report requires ${field}=true.`)
  }
  for (const [value, field] of requiredFailClosedFields) {
    if (value !== false) throw new Error(`Generated retarget report requires ${field}=false.`)
  }
}

export function retainGeneratedRetargetOutput(stagingOutput: string, output: string): void {
  try {
    const missing = autoRigProRetargetArtifactNames.find(
      (name) => !existsSync(resolve(stagingOutput, name)),
    )
    if (missing) throw new Error(`Retarget completed without required artifact: ${missing}`)
    const report = JSON.parse(readFileSync(resolve(stagingOutput, 'report.json'), 'utf8'))
    assertGeneratedRetargetReport(report)
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
  const args = parseAutoRigProRetargetArgs(process.argv.slice(2))
  const source = assertRetargetSource(args.source)
  const target = realpathSync(resolve(args.target))
  const output = resolve(args.output)
  if (output === parse(output).root || output === canonicalOutput || isPathInside(canonicalOutput, output)) {
    throw new Error('Retarget diagnostics cannot replace or write inside the canonical ARP viewer directory.')
  }
  if (isPathInside(source.directory, output) || isPathInside(output, source.directory)) {
    throw new Error('Retarget output and MoMask source directories cannot contain one another.')
  }
  if (sha256(contractPath) !== momaskAutoRigProMapSha256) {
    throw new Error('The frozen MoMask-to-ARP mapping hash changed.')
  }
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) throw new Error('Blender was not found. Set BLENDER_BIN to its executable.')

  mkdirSync(dirname(output), { recursive: true })
  const stagingOutput = mkdtempSync(join(dirname(output), '.auto-rig-pro-retarget-'))
  const targetHash = sha256(target)
  const result = spawnSync(
    blender,
    [
      '--background',
      target,
      '--python-exit-code',
      '1',
      '--python',
      resolve(dirname(fileURLToPath(import.meta.url)), 'auto-rig-pro-retarget.py'),
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
    throw new Error(`Auto-Rig Pro retarget failed with exit code ${result.status ?? 'unknown'}.`)
  }
  if (sha256(target) !== targetHash) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error('The accepted ARP target blend changed during retargeting.')
  }
  retainGeneratedRetargetOutput(stagingOutput, output)
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
