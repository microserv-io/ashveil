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
import { createHash } from 'node:crypto'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { blenderCandidates, isPathInside } from './character-spike'

export { blenderCandidates, isPathInside } from './character-spike'

export interface CharacterRigSpikeArgs {
  input: string
  output: string
}

const usage =
  'Usage: tsx scripts/art/character-rig-spike.ts --input <prepared-directory> --output <rigged-directory>'

export const characterRigSpikeArtifactNames = [
  'masculine-rig-spike.blend',
  'masculine-rigged-diagnostic.glb',
  ...[
    'bind',
    'overhead-reach',
    'cross-body-reach',
    'deep-elbow-bend',
    'long-stride',
    'head-turn',
  ].flatMap((pose) => ['front', 'back', 'right'].map((view) => `validation-${pose}-${view}.png`)),
  'validation-bind-skeleton-front.png',
  'validation-bind-skeleton-right.png',
  'report.json',
] as const

const expectedSourceHash = '375e25dea0da0c8d4267ee4402a64cf4582520341b367e1163730b8f8fc56edb'
const expectedPreparedBlendHash = 'c9212b65a98456dbb2eaa2a51b4347d12ec6571e2162e9eda1592db6e25480c7'
const expectedBaldGlbHash = '76c95673872e1ac2042d8d965e950c846b7990f6701ac6d7df016015964f185d'
const semanticMeshes = [
  'Body',
  'Eye_NegativeX',
  'Eye_PositiveX',
  'Facial_Feature_01',
  'Hand_NegativeX',
  'Hand_PositiveX',
  'Head',
] as const

export function parseCharacterRigSpikeArgs(args: string[]): CharacterRigSpikeArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(usage)
    }
    values.set(key, value)
  }
  if (values.size !== 2 || !values.get('--input') || !values.get('--output')) {
    throw new Error(usage)
  }
  return { input: values.get('--input')!, output: values.get('--output')! }
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

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function glbStructure(path: string): { meshes: number; primitives: number; nodes: number; materials: number } {
  const file = readFileSync(path)
  if (file.subarray(0, 4).toString() !== 'glTF') throw new Error('Prepared bald GLB has an invalid header.')
  let offset = 12
  while (offset + 8 <= file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    if (type === 0x4e4f534a) {
      const document = JSON.parse(file.subarray(offset + 8, offset + 8 + length).toString()) as {
        meshes?: { primitives?: unknown[] }[]
        nodes?: unknown[]
        materials?: unknown[]
      }
      const meshes = document.meshes ?? []
      return {
        meshes: meshes.length,
        primitives: meshes.reduce((total, mesh) => total + (mesh.primitives?.length ?? 0), 0),
        nodes: document.nodes?.length ?? 0,
        materials: document.materials?.length ?? 0,
      }
    }
    offset += 8 + length
  }
  throw new Error('Prepared bald GLB has no JSON document.')
}

export function assertPreparedInput(input: string): void {
  const reportPath = resolve(input, 'report.json')
  const blendPath = resolve(input, 'masculine-character-spike.blend')
  const baldPath = resolve(input, 'masculine-bald-base.glb')
  if (!existsSync(reportPath) || !existsSync(blendPath) || !existsSync(baldPath)) {
    throw new Error('Prepared input must contain its report, editable blend, and bald GLB.')
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    pipeline?: string
    status?: string
    source?: { sha256Before?: string; sha256After?: string; preserved?: boolean }
    parameters?: { targetHeightMetres?: number; status?: string }
    preparation?: {
      meshHealth?: { vertices?: number }
      baldBounds?: { dimensions?: number[] }
      components?: { name?: string }[]
      hairExcludedFromRuntime?: string
    }
    exports?: { path?: string; sha256?: string; gltfStructure?: unknown }[]
  }
  const componentNames = (report.preparation?.components ?? [])
    .map((component) => component.name)
    .filter((name) => name !== 'Hair_Source')
    .sort()
  const baldExport = report.exports?.find((entry) => entry.path === 'masculine-bald-base.glb')
  const blendExport = report.exports?.find((entry) => entry.path === 'masculine-character-spike.blend')
  if (
    report.pipeline !== 'ashveil-character-model-spike' ||
    report.status !== 'spike_not_production_ready' ||
    report.source?.sha256Before !== expectedSourceHash ||
    report.source?.sha256After !== expectedSourceHash ||
    report.source?.preserved !== true ||
    report.parameters?.targetHeightMetres !== 1.8 ||
    report.parameters?.status !== 'provisional_spike_parameter_not_canonical_scale' ||
    report.preparation?.meshHealth?.vertices !== 7966 ||
    report.preparation?.baldBounds?.dimensions?.[2] !== 1.8 ||
    report.preparation?.hairExcludedFromRuntime !== 'Hair_Source' ||
    JSON.stringify(componentNames) !== JSON.stringify([...semanticMeshes].sort()) ||
    blendExport?.sha256 !== expectedPreparedBlendHash ||
    sha256(blendPath) !== expectedPreparedBlendHash ||
    baldExport?.sha256 !== expectedBaldGlbHash ||
    sha256(baldPath) !== expectedBaldGlbHash ||
    JSON.stringify(glbStructure(baldPath)) !==
      JSON.stringify({ meshes: 7, primitives: 7, nodes: 7, materials: 2 })
  ) {
    throw new Error('Prepared report does not match the audited masculine mannequin contract.')
  }
}

function run(): void {
  const args = parseCharacterRigSpikeArgs(process.argv.slice(2))
  const input = realpathSync(resolve(args.input))
  assertPreparedInput(input)
  const output = resolve(args.output)
  if (output === parse(output).root) {
    throw new Error('The output directory cannot be a filesystem root.')
  }
  const outputParent = dirname(output)
  mkdirSync(outputParent, { recursive: true })
  const canonicalOutput = existsSync(output)
    ? realpathSync(output)
    : resolve(realpathSync(outputParent), basename(output))
  if (isPathInside(canonicalOutput, input) || isPathInside(input, canonicalOutput)) {
    throw new Error('Input and output directories must not contain one another.')
  }

  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) {
    throw new Error('Blender was not found. Install Blender or set BLENDER_BIN to its executable.')
  }

  const pythonScript = resolve(dirname(fileURLToPath(import.meta.url)), 'character-rig-spike.py')
  const stagingOutput = mkdtempSync(join(outputParent, '.character-rig-spike-'))
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
      input,
      '--output',
      stagingOutput,
    ],
    { stdio: 'inherit' },
  )

  if (result.error || result.status !== 0) {
    rmSync(stagingOutput, { recursive: true, force: true })
    if (result.error) throw result.error
    throw new Error(`Blender character rig spike failed with exit code ${result.status ?? 'unknown'}.`)
  }
  const missingArtifact = characterRigSpikeArtifactNames.find(
    (artifact) => !existsSync(resolve(stagingOutput, artifact)),
  )
  if (missingArtifact) {
    rmSync(stagingOutput, { recursive: true, force: true })
    throw new Error(`Blender completed without required artifact: ${missingArtifact}`)
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
