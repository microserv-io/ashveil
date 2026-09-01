import type { Sim } from '../sim/sim'
import { HIT_FLASH_DURATION, type Actor, type Ailment } from '../sim/types'
import { rigStateOf, type RigState } from './rig'

export type RigPhase = { windup: number } | { recovery: number } | null

export interface RigInput {
  state: RigState
  speed: number
  dashing: boolean
  facingDelta: number
  phase: RigPhase
  hitAge: number | null
  ailments: Ailment[]
  time: number
  seed: number
  castLeft: number
  recovering: boolean
}

export interface RigInputOwner {
  rigInput: RigInput
  windupPhase: { windup: number }
  recoveryPhase: { recovery: number }
  lastFacing: number | null
}

export function createRigInputOwner(): RigInputOwner {
  return {
    rigInput: {
      state: 'idle',
      speed: 0,
      dashing: false,
      facingDelta: 0,
      phase: null,
      hitAge: null,
      ailments: [],
      time: 0,
      seed: 0,
      castLeft: 0,
      recovering: false,
    },
    windupPhase: { windup: 0 },
    recoveryPhase: { recovery: 0 },
    lastFacing: null,
  }
}

export function buildRigInput(actor: Actor, sim: Sim, view: RigInputOwner): RigInput {
  const input = view.rigInput
  const previousFacing = view.lastFacing

  input.state = rigStateOf(actor)
  input.speed = Math.hypot(actor.velocity.x, actor.velocity.y)
  input.dashing = actor.dash !== null
  input.facingDelta = previousFacing === null ? 0 : Math.atan2(Math.sin(actor.facing - previousFacing), Math.cos(actor.facing - previousFacing))
  input.phase = phaseOf(actor, view)
  input.hitAge = actor.hitFlash > 0 ? HIT_FLASH_DURATION - actor.hitFlash : null
  // The renderer only reads ailments, so aliasing avoids a copy in every actor frame.
  input.ailments = actor.ailments
  input.time = sim.time
  input.seed = actor.id
  input.castLeft = actor.recovery + actor.windup
  input.recovering = actor.state === 'acting' && actor.recovery > 0
  view.lastFacing = actor.facing
  return input
}

export function resetRigInput(view: RigInputOwner): void {
  view.lastFacing = null
}

function phaseOf(actor: Actor, view: RigInputOwner): RigPhase {
  if (actor.windup > 0 && actor.windupTotal > 0) {
    view.windupPhase.windup = progress(actor.windup, actor.windupTotal)
    return view.windupPhase
  }
  if (actor.recovery > 0 && actor.recoveryTotal > 0) {
    view.recoveryPhase.recovery = progress(actor.recovery, actor.recoveryTotal)
    return view.recoveryPhase
  }
  return null
}

function progress(remaining: number, total: number): number {
  return Math.max(0, Math.min(1, 1 - remaining / total))
}
