import { BIND_POSE_CLIP, type ReviewClip } from './animation-review'

export type ReviewSourceId = 'canonical' | 'wip-transfer-v2' | 'diagnostic-mixamo-ashveil'

export interface ReviewSource {
  id: ReviewSourceId
  label: string
  artifactUrl: string
  reportUrl: string
  reportKind: 'canonical' | 'transfer-v2' | 'mixamo-ashveil'
}

export interface TransferV2Report {
  schemaVersion: 'ashveil.auto-rig-pro-transfer-v2'
  status: 'diagnostic_not_production_ready'
  retargetSkeletal: {
    clips: Array<{
      id: string
      outputName: string
      outputFrameStart: number
      outputFrameEnd: number
      outputFps: number
      durationSeconds: number
    }>
  }
}

export interface MixamoAshveilReport {
  schemaVersion: 'ashveil.auto-rig-pro-mixamo-ashveil.v1'
  status: 'diagnostic_rejected'
  objectiveAcceptance: { pass: false; failedGates: string[] }
  source: {
    file: '1-Walking.fbx'
    sha256: string
    meshes: 0
    frames: number
    fps: number
  }
  export: {
    sourceMeshesExported: false
    actions: Array<{
      name: string
      frames: number
      fps: number
      durationSeconds: number
    }>
  }
  sagittalPosture: { pass: false }
  headBodySeam: { pass: false }
  meshDeformation: { pass: false }
  humanReview: { pass: false }
  productionPass: false
  canonicalViewerPromoted: false
}

export const REVIEW_SOURCES: readonly ReviewSource[] = [
  {
    id: 'canonical',
    label: 'Canonical review',
    artifactUrl: new URL(
      '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/masculine-auto-rig-pro-diagnostic.glb',
      import.meta.url,
    ).href,
    reportUrl: new URL(
      '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/report.json',
      import.meta.url,
    ).href,
    reportKind: 'canonical',
  },
  {
    id: 'wip-transfer-v2',
    label: 'WIP transfer v2',
    artifactUrl: new URL(
      '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-transfer-v2/masculine-auto-rig-pro-transfer-v2-diagnostic.glb',
      import.meta.url,
    ).href,
    reportUrl: new URL(
      '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-transfer-v2/report.json',
      import.meta.url,
    ).href,
    reportKind: 'transfer-v2',
  },
  {
    id: 'diagnostic-mixamo-ashveil',
    label: 'Ashveil model · Mixamo walk diagnostic',
    artifactUrl: new URL(
      '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-mixamo-ashveil-wip/masculine-auto-rig-pro-mixamo-ashveil-wip.glb',
      import.meta.url,
    ).href,
    reportUrl: new URL(
      '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro-mixamo-ashveil-wip/report.json',
      import.meta.url,
    ).href,
    reportKind: 'mixamo-ashveil',
  },
] as const

export function initialReviewSource(search: string): ReviewSource {
  const requested = new URLSearchParams(search).get('source')
  return REVIEW_SOURCES.find((source) => source.id === requested) ?? REVIEW_SOURCES[0]!
}

export function defaultReviewClip(source: ReviewSource, canonicalClip: string): string {
  return source.reportKind === 'canonical' ? canonicalClip : BIND_POSE_CLIP
}

export function buildTransferV2ReviewClips(
  report: TransferV2Report,
  exported: readonly { name: string; duration: number }[],
): ReviewClip[] {
  if (
    report.schemaVersion !== 'ashveil.auto-rig-pro-transfer-v2' ||
    report.status !== 'diagnostic_not_production_ready'
  ) {
    throw new Error('WIP transfer v2 report contract is invalid')
  }
  const clips = report.retargetSkeletal.clips.map((clip) => ({
    name: clip.outputName,
    label: `${readableClipName(clip.id)} · in place`,
    kind: 'locomotion' as const,
    framesPerSecond: clip.outputFps,
    frameStart: clip.outputFrameStart,
    frameEnd: clip.outputFrameEnd,
    durationSeconds: clip.durationSeconds,
    contactSchedule: [],
  }))
  const expectedNames = clips.map((clip) => clip.name)
  const actualNames = exported.map((clip) => clip.name)
  if (
    clips.length === 0 ||
    new Set(expectedNames).size !== clips.length ||
    new Set(actualNames).size !== exported.length ||
    expectedNames.length !== actualNames.length ||
    expectedNames.some((name) => !actualNames.includes(name))
  ) {
    throw new Error(`WIP clip inventory must be exactly ${expectedNames.join(', ')}`)
  }
  for (const clip of clips) {
    const actual = exported.find((candidate) => candidate.name === clip.name)!
    if (Math.abs(actual.duration - clip.durationSeconds) > 0.0001) {
      throw new Error(`${clip.name} duration must match the transfer v2 report`)
    }
  }
  return clips
}

export function buildMixamoAshveilReviewClips(
  report: MixamoAshveilReport,
  exported: readonly { name: string; duration: number }[],
): ReviewClip[] {
  const failedGates = [...report.objectiveAcceptance.failedGates].sort()
  if (
    report.schemaVersion !== 'ashveil.auto-rig-pro-mixamo-ashveil.v1' ||
    report.status !== 'diagnostic_rejected' ||
    report.objectiveAcceptance.pass !== false ||
    JSON.stringify(failedGates) !== JSON.stringify(['headBodySeam', 'meshDeformation', 'sagittalPosture']) ||
    report.source.file !== '1-Walking.fbx' ||
    report.source.sha256 !== 'ecc6d600e10358d9d2230fa199f7e0b49d3b50d98775a46f39bc7dff43f1b916' ||
    report.source.meshes !== 0 ||
    report.source.frames !== 62 ||
    report.source.fps !== 60 ||
    report.export.sourceMeshesExported ||
    report.sagittalPosture?.pass !== false ||
    report.headBodySeam?.pass !== false ||
    report.meshDeformation?.pass !== false ||
    report.humanReview.pass ||
    report.productionPass ||
    report.canonicalViewerPromoted
  ) {
    throw new Error('Ashveil Mixamo review must remain the exact rejected motion-only diagnostic')
  }
  const action = report.export.actions[0]
  if (
    report.export.actions.length !== 1 ||
    action?.name !== 'Ashveil_Mixamo_Walk_InPlace_60fps' ||
    action.frames !== 62 ||
    action.fps !== 60 ||
    Math.abs(action.durationSeconds - 61 / 60) > 0.0001
  ) {
    throw new Error('Ashveil Mixamo diagnostic must contain one exact 62-frame, 60fps walk')
  }
  const runtime = exported[0]
  if (
    exported.length !== 1 ||
    runtime?.name !== action.name ||
    Math.abs(runtime.duration - action.durationSeconds) > 0.0001
  ) {
    throw new Error(`Ashveil Mixamo diagnostic clip inventory must be exactly ${action.name}`)
  }
  return [{
    name: action.name,
    label: 'Walk · in place · 60fps · diagnostic',
    kind: 'locomotion',
    framesPerSecond: action.fps,
    frameStart: 0,
    frameEnd: action.frames - 1,
    durationSeconds: action.durationSeconds,
    contactSchedule: [],
  }]
}

function readableClipName(id: string): string {
  return id.length === 0 ? 'Animation' : `${id[0]!.toUpperCase()}${id.slice(1)}`
}
