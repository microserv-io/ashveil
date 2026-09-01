import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { blenderCandidates, isPathInside } from './character-spike'

type MixamoAshveilArgs = { source: string; target: string; output: string }
type Gate = { pass?: unknown }
type Artifact = { path?: unknown; sha256?: unknown; bytes?: unknown }
type GeneratedMixamoAshveilReport = {
  schemaVersion?: unknown
  status?: unknown
  objectiveAcceptance?: { pass?: unknown; failedGates?: unknown }
  source?: { file?: unknown; sha256?: unknown; meshes?: unknown; pass?: unknown }
  postureCalibration?: { enabled?: unknown; targetControlsChanged?: unknown; pass?: unknown }
  preGroundContact?: { sole?: Gate; heelForefoot?: Gate; measured?: unknown }
  groundPlacement?: {
    pass?: unknown
    targetRootVerticalCurveAuthored?: unknown
    sourceActionCurvesChanged?: unknown
    maximumAbsoluteOffsetMetres?: unknown
    maximumAbsoluteOffsetLimitMetres?: unknown
    maximumFrameVelocityMetres?: unknown
    maximumFrameVelocityLimitMetres?: unknown
    endpointOffsetDifferenceMetres?: unknown
    velocityOffsetDifferenceMetresPerFrame?: unknown
  }
  bindPoseParity?: { pass?: unknown; before?: unknown; after?: unknown }
  sagittalPosture?: Gate
  headBodySeam?: Gate
  meshDeformation?: Gate
  runtimeRenderEvidence?: Gate & { artifacts?: Artifact[]; artifactRetention?: unknown }
  export?: {
    sourceMeshesExported?: unknown
    actions?: Array<{ name?: unknown; frames?: unknown; fps?: unknown; durationSeconds?: unknown }>
  }
  humanReview?: Gate
  productionPass?: unknown
  canonicalViewerPromoted?: unknown
  artifacts?: Artifact[]
  [key: string]: unknown
}

export const ashveilMixamoSourceSha256 =
  'ecc6d600e10358d9d2230fa199f7e0b49d3b50d98775a46f39bc7dff43f1b916'
export const ashveilMixamoSourceContract = {
  fileName: '1-Walking.fbx',
  bones: 65,
  meshes: 0,
  fps: 60,
  sourceFrameStart: 0,
  sourceFrameEnd: 61,
  importedFrameStart: 1,
  importedFrameEnd: 62,
} as const
export const expectedMixamoAshveilFailedGates = [
  'sagittalPosture',
  'headBodySeam',
  'meshDeformation',
] as const
export const retainedMixamoAshveilArtifactNames = [
  'masculine-auto-rig-pro-mixamo-ashveil-wip.glb',
  'report.json',
] as const

const generatedBlendName = 'masculine-auto-rig-pro-mixamo-ashveil-wip.blend'
const generatedGlbName = retainedMixamoAshveilArtifactNames[0]
const usage =
  'Usage: tsx scripts/art/auto-rig-pro-mixamo-ashveil.ts --source <1-Walking.fbx> --target <accepted-ARP.blend> --output <isolated-output-directory>'
export const approvedMixamoAshveilOutput = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-mixamo-ashveil-wip',
)
const approvedOutputParent = dirname(approvedMixamoAshveilOutput)
const stagingPrefix = '.auto-rig-pro-mixamo-ashveil-'

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function removeExtras(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) removeExtras(entry)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const record = value as Record<string, unknown>
  delete record.extras
  for (const entry of Object.values(record)) removeExtras(entry)
}

export function stripGlbExtras(path: string): void {
  const glb = readFileSync(path)
  if (glb.subarray(0, 4).toString('ascii') !== 'glTF' || glb.readUInt32LE(4) !== 2) {
    throw new Error('Retained runtime artifact is not a glTF 2 GLB.')
  }
  const chunks: Array<{ type: number; data: Buffer }> = []
  for (let offset = 12; offset < glb.length;) {
    const length = glb.readUInt32LE(offset)
    const type = glb.readUInt32LE(offset + 4)
    chunks.push({ type, data: glb.subarray(offset + 8, offset + 8 + length) })
    offset += 8 + length
  }
  const jsonChunk = chunks.find((chunk) => chunk.type === 0x4e4f534a)
  if (!jsonChunk) throw new Error('Retained runtime GLB has no JSON chunk.')
  const document = JSON.parse(jsonChunk.data.toString('utf8').trimEnd())
  removeExtras(document)
  const json = Buffer.from(JSON.stringify(document), 'utf8')
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20)
  json.copy(paddedJson)
  jsonChunk.data = paddedJson
  const outputLength = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0)
  const output = Buffer.alloc(outputLength)
  output.write('glTF', 0, 'ascii')
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(outputLength, 8)
  let outputOffset = 12
  for (const chunk of chunks) {
    output.writeUInt32LE(chunk.data.length, outputOffset)
    output.writeUInt32LE(chunk.type, outputOffset + 4)
    chunk.data.copy(output, outputOffset + 8)
    outputOffset += 8 + chunk.data.length
  }
  const temporaryPath = `${path}.sanitized-${process.pid}`
  writeFileSync(temporaryPath, output)
  renameSync(temporaryPath, path)
}

export function parseAutoRigProMixamoAshveilArgs(args: string[]): MixamoAshveilArgs {
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

export function assertApprovedMixamoAshveilOutput(outputArgument: string): string {
  const output = resolve(outputArgument)
  if (output !== approvedMixamoAshveilOutput) {
    throw new Error(`Mixamo Ashveil output must be exactly ${approvedMixamoAshveilOutput}.`)
  }
  return output
}

function assertApprovedStaging(stagingArgument: string): string {
  const staging = resolve(stagingArgument)
  const name = parse(staging).base
  if (
    dirname(staging) !== approvedOutputParent ||
    !name.startsWith(stagingPrefix) ||
    name.length <= stagingPrefix.length
  ) {
    throw new Error('Mixamo Ashveil staging must be a generated sibling of the approved output leaf.')
  }
  return staging
}

export function assertPinnedFileIdentity(
  sourceArgument: string,
  expectedFileName: string,
  expectedSha256: string,
): { path: string; sha256: string; bytes: number } {
  const path = realpathSync(resolve(sourceArgument))
  if (parse(path).base !== expectedFileName) throw new Error(`Source must be the pinned ${expectedFileName} file.`)
  const hash = sha256(path)
  if (hash !== expectedSha256) throw new Error(`${expectedFileName} checksum changed.`)
  return { path, sha256: hash, bytes: statSync(path).size }
}

export function assertAshveilMixamoSource(sourceArgument: string): {
  path: string
  sha256: string
  bytes: number
} {
  return assertPinnedFileIdentity(
    sourceArgument,
    ashveilMixamoSourceContract.fileName,
    ashveilMixamoSourceSha256,
  )
}

export function symmetricLoopNeighborValues(
  start: number,
  second: number,
  penultimate: number,
  end: number,
): [number, number, number, number] {
  const wrappedVelocity = ((second - start) + (end - penultimate)) * 0.5
  return [start, start + wrappedVelocity, end - wrappedVelocity, end]
}

export function conditionSparseLoopKeyValues(
  keyedValues: Readonly<Record<number, number>>,
  evaluated: readonly [number, number, number, number],
): Record<number, number> {
  const [start, second, penultimate, end] = symmetricLoopNeighborValues(...evaluated)
  if (Math.abs((evaluated[1] - evaluated[0]) - (evaluated[3] - evaluated[2])) <= 1e-8) {
    return { ...keyedValues }
  }
  return { ...keyedValues, 1: start, 2: second, 61: penultimate, 62: end }
}

function assertExactFailedGates(failedGates: unknown): void {
  if (!Array.isArray(failedGates)) throw new Error('Mixamo Ashveil report has no failed-gate inventory.')
  const actual = [...failedGates].sort()
  const expected = [...expectedMixamoAshveilFailedGates].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Mixamo Ashveil report must fail exactly ${expected.join(', ')}.`)
  }
}

function assertPassingGate(report: GeneratedMixamoAshveilReport, field: string): void {
  const value = report[field]
  if (typeof value !== 'object' || value === null || (value as Gate).pass !== true) {
    throw new Error(`Mixamo Ashveil report requires ${field}.pass=true.`)
  }
}

export function assertGeneratedMixamoAshveilReport(report: GeneratedMixamoAshveilReport): void {
  if (
    report.schemaVersion !== 'ashveil.auto-rig-pro-mixamo-ashveil.v1' ||
    report.status !== 'diagnostic_rejected' ||
    report.objectiveAcceptance?.pass !== false
  ) {
    throw new Error('Mixamo Ashveil report must remain an explicitly rejected diagnostic.')
  }
  assertExactFailedGates(report.objectiveAcceptance.failedGates)
  for (const field of [
    'sourceRootMotion',
    'sourceLoopSeam',
    'mapping',
    'actionOwnership',
    'rootMotionExtraction',
    'footRotationCalibration',
    'postureCalibration',
    'groundPlacement',
    'targetRootNet',
    'bindPoseParity',
    'bindRelativeAxialTwist',
    'kneeHingeDirection',
    'footContact',
    'heelForefootContact',
    'toeAlignment',
    'loopSeam',
    'shoulderWristContinuity',
    'runtimeInventory',
    'authorRuntimeJointParity',
    'skinnedVertexParity',
    'runtimeRenderEvidence',
  ]) assertPassingGate(report, field)
  const action = report.export?.actions?.[0]
  if (
    report.source?.file !== ashveilMixamoSourceContract.fileName ||
    report.source?.sha256 !== ashveilMixamoSourceSha256 ||
    report.source?.meshes !== 0 ||
    report.source?.pass !== true ||
    report.export?.sourceMeshesExported !== false ||
    report.export?.actions?.length !== 1 ||
    action?.name !== 'Ashveil_Mixamo_Walk_InPlace_60fps' ||
    action.frames !== 62 ||
    action.fps !== 60 ||
    action.durationSeconds !== 61 / 60
  ) {
    throw new Error('Mixamo Ashveil report source/export contract changed.')
  }
  if (
    report.sagittalPosture?.pass !== false ||
    report.headBodySeam?.pass !== false ||
    report.meshDeformation?.pass !== false ||
    report.postureCalibration?.enabled !== false ||
    report.postureCalibration?.targetControlsChanged !== false ||
    report.preGroundContact?.measured !== true ||
    report.groundPlacement?.targetRootVerticalCurveAuthored !== true ||
    report.groundPlacement?.sourceActionCurvesChanged !== false
  ) {
    throw new Error('Mixamo Ashveil report must preserve the measured base blockers and bounded grounding policy.')
  }
  const grounding = report.groundPlacement
  if (
    typeof grounding.maximumAbsoluteOffsetMetres !== 'number' ||
    typeof grounding.maximumAbsoluteOffsetLimitMetres !== 'number' ||
    grounding.maximumAbsoluteOffsetMetres > grounding.maximumAbsoluteOffsetLimitMetres ||
    typeof grounding.maximumFrameVelocityMetres !== 'number' ||
    typeof grounding.maximumFrameVelocityLimitMetres !== 'number' ||
    grounding.maximumFrameVelocityMetres > grounding.maximumFrameVelocityLimitMetres ||
    grounding.endpointOffsetDifferenceMetres !== 0 ||
    grounding.velocityOffsetDifferenceMetresPerFrame !== 0
  ) {
    throw new Error('Mixamo Ashveil grounding correction exceeds its frozen bounded/periodic contract.')
  }
  if (
    report.bindPoseParity?.before === undefined ||
    JSON.stringify(report.bindPoseParity.before) !== JSON.stringify(report.bindPoseParity.after) ||
    report.humanReview?.pass !== false ||
    report.productionPass !== false ||
    report.canonicalViewerPromoted !== false
  ) {
    throw new Error('Mixamo Ashveil diagnostic must preserve the target and remain fail closed.')
  }
}

function artifactPath(directory: string, artifact: Artifact): string {
  if (typeof artifact.path !== 'string') throw new Error('Generated artifact path is invalid.')
  return resolve(directory, artifact.path.endsWith('.png') ? join('renders', artifact.path) : artifact.path)
}

function assertArtifact(directory: string, artifact: Artifact): void {
  const path = artifactPath(directory, artifact)
  if (!isPathInside(directory, path) || !existsSync(path)) {
    throw new Error(`Generated diagnostic artifact is missing: ${String(artifact.path)}`)
  }
  if (artifact.sha256 !== sha256(path) || artifact.bytes !== statSync(path).size) {
    throw new Error(`Generated diagnostic artifact identity changed: ${String(artifact.path)}`)
  }
}

export function assertCompleteGeneratedMixamoAshveilArtifacts(
  directory: string,
  report: GeneratedMixamoAshveilReport,
): void {
  for (const name of [generatedBlendName, generatedGlbName, 'report.json']) {
    if (!existsSync(resolve(directory, name))) throw new Error(`Mixamo Ashveil generation omitted ${name}.`)
  }
  const renders = report.runtimeRenderEvidence?.artifacts
  if (!Array.isArray(renders) || renders.length !== 15) {
    throw new Error('Mixamo Ashveil generation must produce all 15 runtime review renders.')
  }
  const artifacts = report.artifacts
  if (!Array.isArray(artifacts) || artifacts.length !== 17) {
    throw new Error('Mixamo Ashveil generation must report its BLEND, GLB, and 15 renders.')
  }
  for (const artifact of artifacts) assertArtifact(directory, artifact)
}

function retainLicensableArtifactsOnly(
  directory: string,
  report: GeneratedMixamoAshveilReport,
): void {
  const glbPath = resolve(directory, generatedGlbName)
  stripGlbExtras(glbPath)
  report.runtimeRenderEvidence = {
    ...report.runtimeRenderEvidence,
    artifactRetention: 'measured_metadata_only',
  }
  delete report.runtimeRenderEvidence.artifacts
  report.artifacts = [{
    path: generatedGlbName,
    sha256: sha256(glbPath),
    bytes: statSync(glbPath).size,
  }]
  const reportPath = resolve(directory, 'report.json')
  const temporaryReportPath = resolve(directory, '.report.json.tmp')
  writeFileSync(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`)
  renameSync(temporaryReportPath, reportPath)
  for (const entry of readdirSync(directory)) {
    if (!(retainedMixamoAshveilArtifactNames as readonly string[]).includes(entry)) {
      rmSync(resolve(directory, entry), { recursive: true, force: true })
    }
  }
}

export function retainGeneratedMixamoAshveilOutput(staging: string, output: string): void {
  const approvedStaging = assertApprovedStaging(staging)
  const approvedOutput = assertApprovedMixamoAshveilOutput(output)
  try {
    const report = JSON.parse(readFileSync(resolve(approvedStaging, 'report.json'), 'utf8')) as GeneratedMixamoAshveilReport
    assertGeneratedMixamoAshveilReport(report)
    assertCompleteGeneratedMixamoAshveilArtifacts(approvedStaging, report)
    retainLicensableArtifactsOnly(approvedStaging, report)
  } catch (error) {
    rmSync(approvedStaging, { recursive: true, force: true })
    throw error
  }
  const previous = `${approvedOutput}.previous-${process.pid}`
  if (existsSync(previous)) {
    rmSync(approvedStaging, { recursive: true, force: true })
    throw new Error(`Mixamo Ashveil backup path already exists: ${previous}`)
  }
  const previousCreated = existsSync(approvedOutput)
  if (previousCreated) renameSync(approvedOutput, previous)
  try {
    renameSync(approvedStaging, approvedOutput)
    if (previousCreated) rmSync(previous, { recursive: true, force: true })
  } catch (error) {
    if (previousCreated && existsSync(previous) && !existsSync(approvedOutput)) {
      renameSync(previous, approvedOutput)
    }
    rmSync(approvedStaging, { recursive: true, force: true })
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
  const args = parseAutoRigProMixamoAshveilArgs(process.argv.slice(2))
  const output = assertApprovedMixamoAshveilOutput(args.output)
  const source = assertAshveilMixamoSource(args.source)
  const target = realpathSync(resolve(args.target))
  const blender = blenderCandidates({ configuredBinary: process.env.BLENDER_BIN }).find(canExecute)
  if (!blender) throw new Error('Blender was not found. Set BLENDER_BIN to its executable.')

  mkdirSync(dirname(output), { recursive: true })
  const staging = mkdtempSync(join(approvedOutputParent, stagingPrefix))
  const targetHash = sha256(target)
  const result = spawnSync(
    blender,
    [
      '--background',
      target,
      '--python-exit-code',
      '1',
      '--python',
      resolve(dirname(fileURLToPath(import.meta.url)), 'auto-rig-pro-mixamo-ashveil.py'),
      '--',
      '--source',
      source.path,
      '--source-sha256',
      source.sha256,
      '--output',
      staging,
    ],
    { stdio: 'inherit' },
  )
  if (sha256(target) !== targetHash) {
    rmSync(staging, { recursive: true, force: true })
    throw new Error('The accepted ARP target blend changed during the Mixamo Ashveil diagnostic.')
  }
  if (result.error || result.status !== 1) {
    rmSync(staging, { recursive: true, force: true })
    if (result.error) throw result.error
    throw new Error(`Mixamo Ashveil generator must exit 1 for its expected diagnostic rejection, received ${result.status ?? 'unknown'}.`)
  }
  retainGeneratedMixamoAshveilOutput(staging, output)
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
