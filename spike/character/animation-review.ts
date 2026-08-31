import * as THREE from 'three'

export type ReviewClipKind = 'stress' | 'locomotion'

export interface ContactPhase {
  frame: number
  phase: string
}

export interface ReviewClip {
  name: string
  label: string
  kind: ReviewClipKind
  framesPerSecond: number
  frameStart: number
  frameEnd: number
  durationSeconds: number
  contactSchedule: readonly ContactPhase[]
}

interface ReviewAnimationReport {
  animation: {
    name: string
    framesPerSecond: number
    frameStart: number
    frameEnd: number
  }
  locomotion?: {
    clips: Array<{
      name: string
      framesPerSecond: number
      frameStart: number
      frameEnd: number
      durationSeconds: number
      contactSchedule: ContactPhase[]
    }>
  }
}

export interface ReviewAction {
  name?: string
  paused: boolean
  enabled: boolean
  clampWhenFinished: boolean
  stopFading(): unknown
  fadeOut(duration: number): unknown
  stop(): unknown
  reset(): unknown
  setLoop(mode: THREE.AnimationActionLoopStyles, repetitions: number): unknown
  setEffectiveWeight(weight: number): unknown
  play(): unknown
}

export interface LoopConfiguration {
  mode: THREE.AnimationActionLoopStyles
  repetitions: number
  clamp: boolean
}

const REQUIRED_LOCOMOTION_CLIPS = [
  { name: 'Ashveil_Walk_InPlace', label: 'Walk · in place' },
  { name: 'Ashveil_Sprint_InPlace', label: 'Sprint · in place' },
] as const

const ACTION_FADE_SECONDS = 0.12

export function buildReviewClips(report: ReviewAnimationReport): ReviewClip[] {
  const locomotion = report.locomotion?.clips ?? []
  const clips: ReviewClip[] = [
    {
      name: report.animation.name,
      label: 'Stress benchmark',
      kind: 'stress',
      framesPerSecond: report.animation.framesPerSecond,
      frameStart: report.animation.frameStart,
      frameEnd: report.animation.frameEnd,
      durationSeconds:
        (report.animation.frameEnd - report.animation.frameStart) / report.animation.framesPerSecond,
      contactSchedule: [],
    },
  ]
  for (const required of REQUIRED_LOCOMOTION_CLIPS) {
    const source = locomotion.find((clip) => clip.name === required.name)
    if (!source) throw new Error(`Report is missing required locomotion clip ${required.name}`)
    clips.push({ ...source, label: required.label, kind: 'locomotion' })
  }
  return clips
}

export function assertReviewClipInventory(
  expected: readonly ReviewClip[],
  actual: readonly { name: string; duration: number }[],
): void {
  const failures: string[] = []
  const expectedNames = expected.map((clip) => clip.name)
  const actualNames = actual.map((clip) => clip.name)
  if (new Set(expectedNames).size !== expectedNames.length || new Set(actualNames).size !== actualNames.length) {
    failures.push('animation clip names must be unique')
  }
  if (
    actualNames.length !== expectedNames.length ||
    expectedNames.some((name) => !actualNames.includes(name))
  ) {
    failures.push(`animation clips must be exactly ${expectedNames.join(', ')}`)
  }
  for (const clip of expected) {
    const exported = actual.find((candidate) => candidate.name === clip.name)
    if (!exported) continue
    if (!Number.isFinite(exported.duration) || Math.abs(exported.duration - clip.durationSeconds) > 0.0001) {
      failures.push(
        `${clip.name} duration ${exported.duration} must match report duration ${clip.durationSeconds}`,
      )
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

export function loopConfiguration(kind: ReviewClipKind): LoopConfiguration {
  return kind === 'stress'
    ? { mode: THREE.LoopOnce, repetitions: 1, clamp: true }
    : { mode: THREE.LoopRepeat, repetitions: Infinity, clamp: false }
}

export function activateReviewAction(
  previous: ReviewAction | null,
  selected: ReviewAction,
  loop: LoopConfiguration,
): void {
  if (previous && previous !== selected) {
    previous.stopFading()
    previous.fadeOut(ACTION_FADE_SECONDS)
    previous.stop()
    previous.reset()
  }
  selected.stopFading()
  selected.reset()
  selected.setLoop(loop.mode, loop.repetitions)
  selected.clampWhenFinished = loop.clamp
  selected.enabled = true
  selected.setEffectiveWeight(1)
  selected.play()
  selected.paused = true
}

export function nearestContactPhase(
  schedule: readonly ContactPhase[],
  frame: number,
): ContactPhase {
  if (schedule.length === 0) throw new Error('Locomotion contact schedule must not be empty')
  return schedule.reduce((nearest, candidate) =>
    Math.abs(candidate.frame - frame) < Math.abs(nearest.frame - frame) ? candidate : nearest,
  )
}

export function sampleTimeForReviewFrame(clip: ReviewClip, frame: number): number {
  const clamped = Math.max(clip.frameStart, Math.min(frame, clip.frameEnd))
  const seconds = (clamped - clip.frameStart) / clip.framesPerSecond
  if (clip.kind === 'locomotion') return Math.min(seconds, clip.durationSeconds)
  const samplingOffset = 0.1 / clip.framesPerSecond
  return clamped >= clip.frameEnd ? clip.durationSeconds + samplingOffset : seconds + samplingOffset
}

export function frameForReviewTime(clip: ReviewClip, seconds: number): number {
  const elapsed = clip.kind === 'locomotion' && clip.durationSeconds > 0
    ? seconds % clip.durationSeconds
    : Math.min(seconds, clip.durationSeconds)
  return Math.max(
    clip.frameStart,
    Math.min(clip.frameEnd, clip.frameStart + Math.round(elapsed * clip.framesPerSecond)),
  )
}
