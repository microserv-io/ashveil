import type { ReviewClip } from './animation-review'

export type ReviewSourceId = 'canonical' | 'wip-transfer-v2'

export interface ReviewSource {
  id: ReviewSourceId
  label: string
  artifactUrl: string
  reportUrl: string
  reportKind: 'canonical' | 'transfer-v2'
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
] as const

export function initialReviewSource(search: string): ReviewSource {
  const requested = new URLSearchParams(search).get('source')
  return REVIEW_SOURCES.find((source) => source.id === requested) ?? REVIEW_SOURCES[0]!
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

function readableClipName(id: string): string {
  return id.length === 0 ? 'Animation' : `${id[0]!.toUpperCase()}${id.slice(1)}`
}
