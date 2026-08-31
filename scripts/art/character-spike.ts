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
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export interface CharacterSpikeArgs {
  input: string
  output: string
  targetHeight: number
}

interface BlenderCandidateOptions {
  configuredBinary?: string
  homeDirectory?: string
  platform?: NodeJS.Platform
}

const usage =
  'Usage: npm run art:character-spike -- --input <model.fbx> --output <directory> --target-height <metres>'

export const characterSpikeArtifactNames = [
  'masculine-character-spike.blend',
  'masculine-bald-base.glb',
  'masculine-armor-fit-proxy.glb',
  'validation-front.png',
  'validation-back.png',
  'validation-right.png',
  'validation-fit-proxy-front.png',
  'report.json',
] as const

export function parseCharacterSpikeArgs(args: string[]): CharacterSpikeArgs {
  const values = new Map<string, string>()

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(usage)
    }
    values.set(key, value)
  }

  const input = values.get('--input')
  const output = values.get('--output')
  const heightValue = values.get('--target-height')
  if (!input || !output || !heightValue) {
    throw new Error(usage)
  }

  const targetHeight = Number(heightValue)
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
    throw new Error('The target height must be a positive number in metres.')
  }

  return { input, output, targetHeight }
}

export function blenderCandidates({
  configuredBinary,
  homeDirectory = homedir(),
  platform = process.platform,
}: BlenderCandidateOptions = {}): string[] {
  const candidates = configuredBinary ? [configuredBinary] : []
  if (platform === 'darwin') {
    candidates.push(
      resolve(homeDirectory, 'Applications/Blender.app/Contents/MacOS/Blender'),
      '/Applications/Blender.app/Contents/MacOS/Blender',
    )
  }
  candidates.push(platform === 'win32' ? 'blender.exe' : 'blender')
  return [...new Set(candidates)]
}

export function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent === '' ||
    (pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
  )
}

function canExecute(candidate: string): boolean {
  if (!candidate.includes('/')) {
    const check = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    return check.status === 0
  }

  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function run(): void {
  const args = parseCharacterSpikeArgs(process.argv.slice(2))
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) {
    throw new Error('Blender was not found. Install Blender or set BLENDER_BIN to its executable.')
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const pythonScript = resolve(scriptDirectory, 'character-spike.py')
  const input = resolve(args.input)
  const output = resolve(args.output)
  if (output === parse(output).root) {
    throw new Error('The output directory cannot be a filesystem root.')
  }
  const outputParent = dirname(output)
  mkdirSync(outputParent, { recursive: true })
  const canonicalInput = realpathSync(input)
  const canonicalOutput = existsSync(output)
    ? realpathSync(output)
    : resolve(realpathSync(outputParent), basename(output))
  if (isPathInside(canonicalOutput, canonicalInput)) {
    throw new Error('The input must not be the output directory or a file inside it.')
  }
  const stagingOutput = mkdtempSync(join(outputParent, '.character-spike-'))
  const result = spawnSync(
    blender,
    [
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      pythonScript,
      '--',
      '--input',
      canonicalInput,
      '--output',
      stagingOutput,
      '--target-height',
      String(args.targetHeight),
    ],
    { stdio: 'inherit' },
  )

  if (result.error) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw result.error
  }
  if (result.status !== 0) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error(`Blender character spike failed with exit code ${result.status ?? 'unknown'}.`)
  }

  const missingArtifact = characterSpikeArtifactNames.find(
    (artifact) => !existsSync(resolve(stagingOutput, artifact)),
  )
  if (missingArtifact) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error(`Blender completed without required artifact: ${missingArtifact}`)
  }

  const previousOutput = `${output}.previous-${process.pid}`
  if (existsSync(output)) {
    renameSync(output, previousOutput)
  }
  try {
    renameSync(stagingOutput, output)
    rmSync(previousOutput, { recursive: true, force: true })
  } catch (error) {
    if (existsSync(previousOutput) && !existsSync(output)) {
      renameSync(previousOutput, output)
    }
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
