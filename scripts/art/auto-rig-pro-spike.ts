import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { assertPreparedInput } from './character-rig-spike'
import { blenderCandidates, isPathInside } from './character-spike'

type PrepareLiveArgs = { phase: 'prepare-live'; input: string; session: string }
type BuildArgs = {
  phase: 'build'
  input: string
  session: string
  output: string
}
export type AutoRigProSpikeArgs = PrepareLiveArgs | BuildArgs

const usage =
  'Usage: tsx scripts/art/auto-rig-pro-spike.ts prepare-live --input <prepared-directory> --session <marker-session.blend> | build --input <prepared-directory> --session <marker-session.blend> --output <rigged-auto-rig-pro-directory>'

const poses = [
  'bind',
  'overhead-reach',
  'cross-body-reach',
  'deep-elbow-bend',
  'long-stride',
  'head-turn',
] as const

export const autoRigProArtifactNames = [
  'masculine-auto-rig-pro-spike.blend',
  'masculine-auto-rig-pro-diagnostic.glb',
  ...poses.flatMap((pose) =>
    ['front', 'back', 'right'].map((view) => `validation-${pose}-${view}.png`),
  ),
  'validation-bind-skeleton-front.png',
  'validation-bind-skeleton-right.png',
  'report.json',
] as const

export function parseAutoRigProSpikeArgs(args: string[]): AutoRigProSpikeArgs {
  const phase = args[0]
  if (phase !== 'prepare-live' && phase !== 'build') throw new Error(usage)
  const values = new Map<string, string>()
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(usage)
    }
    values.set(key, value)
  }
  const input = values.get('--input')
  const session = values.get('--session')
  if (!input || !session) throw new Error(usage)
  if (phase === 'prepare-live') {
    if (values.size !== 2) throw new Error(usage)
    return { phase, input, session }
  }
  const output = values.get('--output')
  if (!output || values.size !== 3) throw new Error(usage)
  return { phase, input, session, output }
}

function canExecute(candidate: string): boolean {
  if (!candidate.includes('/')) {
    return spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0
  }
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function checkedPathOutsideInput(path: string, input: string): string {
  const resolved = resolve(path)
  if (resolved === parse(resolved).root || isPathInside(resolved, input)) {
    throw new Error('ARP session and output paths must be outside the prepared input directory.')
  }
  return resolved
}

function prepareLive(
  blender: string,
  input: string,
  sessionArgument: string,
  scriptDirectory: string,
): void {
  const session = checkedPathOutsideInput(sessionArgument, input)
  mkdirSync(dirname(session), { recursive: true })
  const result = spawnSync(
    blender,
    [
      resolve(input, 'masculine-character-spike.blend'),
      '--python-exit-code',
      '1',
      '--python',
      resolve(scriptDirectory, 'auto-rig-pro-live.py'),
      '--',
      '--input',
      input,
      '--session',
      session,
    ],
    { stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) {
    if (result.error) throw result.error
    throw new Error(`Auto-Rig Pro live marker phase exited with code ${result.status ?? 'unknown'}.`)
  }
  if (!existsSync(session)) {
    throw new Error('The live marker phase closed without saving its marker session blend.')
  }
}

function build(
  blender: string,
  input: string,
  sessionArgument: string,
  outputArgument: string,
  scriptDirectory: string,
): void {
  const session = realpathSync(checkedPathOutsideInput(sessionArgument, input))
  const output = checkedPathOutsideInput(outputArgument, input)
  if (isPathInside(output, session) || isPathInside(session, output)) {
    throw new Error('The ARP marker session and benchmark output cannot contain one another.')
  }
  const outputParent = dirname(output)
  mkdirSync(outputParent, { recursive: true })
  const stagingOutput = mkdtempSync(join(outputParent, '.auto-rig-pro-spike-'))
  const result = spawnSync(
    blender,
    [
      '--background',
      session,
      '--python-exit-code',
      '1',
      '--python',
      resolve(scriptDirectory, 'auto-rig-pro-benchmark.py'),
      '--',
      '--input',
      input,
      '--output',
      stagingOutput,
    ],
    { stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) {
    rmSync(stagingOutput, { recursive: true, force: true })
    if (result.error) throw result.error
    throw new Error(`Auto-Rig Pro benchmark failed with exit code ${result.status ?? 'unknown'}.`)
  }
  const missingArtifact = autoRigProArtifactNames.find(
    (artifact) => !existsSync(resolve(stagingOutput, artifact)),
  )
  if (missingArtifact) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error(`Auto-Rig Pro benchmark completed without required artifact: ${missingArtifact}`)
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

function run(): void {
  const args = parseAutoRigProSpikeArgs(process.argv.slice(2))
  const input = realpathSync(resolve(args.input))
  assertPreparedInput(input)
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) throw new Error('Blender was not found. Set BLENDER_BIN to its executable.')
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  if (args.phase === 'prepare-live') {
    prepareLive(blender, input, args.session, scriptDirectory)
  } else {
    build(blender, input, args.session, args.output, scriptDirectory)
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
