import type { RigState } from '../rig'
import type { RigInput } from '../riginput'
import type { ArmCarry } from '../profiles/profile'
import { applyFlinch } from './flinch'
import { createGaitDrive, createGaitState, seedOffset, strideFrequency, writeLocomotion } from './gait'
import { writeShoulderGirdle } from './girdle'
import { writeDash, writeIdle } from './stances'
import type { RigGeometry } from './geometry'
import { blendPose, copyPose, createPose, type Pose } from './pose'
import { DEATH_SETTLE, POSE_CLIPS, type PoseClipName } from './clips'
import { writeClipPose } from './poses'

export interface PoseGenerator {
  /** Writes the body's pose for this frame into `out`. Allocates nothing. */
  generate(input: RigInput, out: Pose): void
  /** Called when a pooled body is reused: forget the last body's history. */
  reset(): void
}

/**
 * How long a change of state takes to cross over: short enough that a body reads
 * as reacting rather than easing, long enough that no joint moves more than
 * 0.2 rad in a frame at 60 Hz even when a walk becomes a swing, which
 * `tests/procedural_generator.test.ts` pins.
 */
const BLEND = 0.12
/** Above this the actor is moving; below it, a body reads as standing. */
const MOVING_SPEED = 0.05

type Mode = 'idle' | 'moving' | 'dash' | 'dead' | PoseClipName

/**
 * Turns a `RigInput` into a full-body pose. All of its memory derives from
 * replicated state — sim time, velocity, the death it saw — so two clients
 * driving the same input sequence produce the same run.
 */
export function createPoseGenerator(geometry: RigGeometry, armCarry?: ArmCarry): PoseGenerator {
  const scratch = createGaitState()
  const drive = createGaitDrive()
  const target = createPose()
  const previous = createPose()
  const source = createPose()

  let mode: Mode | null = null
  let lastTime: number | null = null
  let lastSpeed = 0
  let phase = 0
  let blendLeft = 0
  let deathAt: number | null = null

  function reset(): void {
    mode = null
    lastTime = null
    lastSpeed = 0
    phase = 0
    blendLeft = 0
    deathAt = null
  }

  function generate(input: RigInput, out: Pose): void {
    const delta = lastTime === null ? 0 : Math.max(0, input.time - lastTime)
    if (lastTime === null) phase = seedOffset(input.seed)
    lastTime = input.time

    drive.acceleration = delta > 0 ? (input.speed - lastSpeed) / delta : 0
    lastSpeed = input.speed
    // Integrated rather than sampled from time: stride frequency changes with
    // speed, so `time * frequency` would jump the whole gait on every acceleration.
    phase += strideFrequency(geometry, input.speed) * delta
    phase -= Math.floor(phase)

    drive.speed = input.speed
    drive.phase = phase
    drive.time = input.time
    drive.seed = input.seed
    drive.facingDelta = input.facingDelta

    const next = modeOf(input)
    if (next === 'dead' && deathAt === null) deathAt = input.time
    if (next !== 'dead') deathAt = null
    if (mode !== null && next !== mode) {
      copyPose(previous, source)
      blendLeft = BLEND
    }
    mode = next

    write(next, input, target)
    // Over the top of whatever state wrote it: an arm swings from a shoulder, and
    // the shoulder has to go with it.
    writeShoulderGirdle(geometry, target)

    if (blendLeft > 0) {
      blendLeft = Math.max(0, blendLeft - delta)
      blendPose(source, target, 1 - blendLeft / BLEND, out)
    } else {
      copyPose(target, out)
    }
    copyPose(out, previous)
    applyFlinch(out, input.hitAge, input.seed)
  }

  function write(current: Mode, input: RigInput, out: Pose): void {
    if (current === 'idle') return writeIdle(geometry, drive, scratch, out, armCarry)
    if (current === 'moving') return writeLocomotion(geometry, drive, scratch, out, armCarry)
    if (current === 'dash') return writeDash(geometry, drive, scratch, out, armCarry)
    const at = current === 'dead' ? fallProgress(input.time) : castPhase(input)
    writeClipPose(geometry, POSE_CLIPS[current], at, scratch, out)
  }

  function fallProgress(time: number): number {
    return deathAt === null ? 0 : (time - deathAt) / DEATH_SETTLE
  }

  return { generate, reset }
}

/**
 * Precedence follows `rigStateOf`, with one addition: `dash` outlives the skill
 * that started it, so the flag holds the pose after the skill state has moved on.
 */
function modeOf(input: RigInput): Mode {
  const state: RigState = input.state
  if (state === 'dead') return 'dead'
  if (state === 'dash' || input.dashing) return 'dash'
  if (state !== 'idle' && state !== 'moving') return state
  return input.speed > MOVING_SPEED && state === 'moving' ? 'moving' : 'idle'
}

/** Windup fills the first half of a skill pose and recovery the second. */
function castPhase(input: RigInput): number {
  const phase = input.phase
  if (phase === null) return 0.5
  return 'windup' in phase ? phase.windup * 0.5 : 0.5 + phase.recovery * 0.5
}
