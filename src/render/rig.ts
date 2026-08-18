import * as THREE from 'three'
import type { Actor, SkillId } from '../sim/types'

/**
 * What the body is doing, derived from sim state. Skills are their own poses, so a
 * new skill that nobody mapped fails a test rather than rendering as a T-pose.
 */
export type RigState = 'idle' | 'moving' | 'dead' | SkillId

/**
 * KayKit clip names, best first. Both character packs ship the same 41-bone rig and
 * 76 shared clip names, so one table drives the player and every monster; the
 * fallbacks cover the handful of clips only the skeletons carry.
 */
export const RIG_CLIPS: Record<RigState, readonly string[]> = {
  idle: ['Idle', 'Unarmed_Idle'],
  moving: ['Running_A', 'Walking_A'],
  dead: ['Death_A', 'Death_B'],

  cleave: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'],
  firebolt: ['Spellcast_Shoot', 'Spellcasting'],
  frost_nova: ['Spellcast_Raise', 'Spellcasting'],
  dash: ['Dodge_Forward', 'Running_A'],

  monster_bite: ['Unarmed_Melee_Attack_Punch_A', '1H_Melee_Attack_Chop'],
  monster_bolt: ['Spellcast_Shoot', 'Spellcasting'],
  monster_slam: ['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop'],
}

/** Poses that play once and hold, rather than looping. */
const ONE_SHOT: ReadonlySet<RigState> = new Set<RigState>([
  'dead',
  'cleave',
  'dash',
  'firebolt',
  'frost_nova',
  'monster_bite',
  'monster_bolt',
  'monster_slam',
])

const FADE = 0.14

export function rigStateOf(actor: Actor): RigState {
  if (actor.dead) return 'dead'
  if (actor.state === 'acting' && actor.activeSkill) return actor.activeSkill
  if (actor.state === 'moving') return 'moving'
  return 'idle'
}

/**
 * Drives one body's animation from sim state. Holds no sim references: `apply` is
 * told the state, so this stays testable and the renderer keeps its read-only role.
 */
export class Rig {
  private readonly mixer: THREE.AnimationMixer
  private readonly clips = new Map<string, THREE.AnimationClip>()
  private current: THREE.AnimationAction | null = null
  private currentState: RigState | null = null

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root)
    for (const clip of clips) this.clips.set(clip.name, clip)
  }

  apply(state: RigState): void {
    if (state === this.currentState) return
    const clip = RIG_CLIPS[state].map((name) => this.clips.get(name)).find(Boolean)
    if (!clip) return

    const next = this.mixer.clipAction(clip)
    next.reset()
    if (ONE_SHOT.has(state)) {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity)
    }
    next.fadeIn(FADE).play()
    this.current?.fadeOut(FADE)
    this.current = next
    this.currentState = state
  }

  /**
   * An attack pose is shorter than the skill that triggered it, so a fast weapon
   * would otherwise freeze mid-swing on the last frame.
   */
  scaleToDuration(seconds: number): void {
    if (!this.current || seconds <= 0) return
    const clip = this.current.getClip()
    this.current.timeScale = clip.duration / seconds
  }

  update(delta: number): void {
    this.mixer.update(delta)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D)
  }
}
