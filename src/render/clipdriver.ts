import * as THREE from 'three'
import type { MotionDriver } from './motion'
import { RIG_CLIPS, type RigState } from './rig'
import type { RigInput } from './riginput'

export interface ClipProfile {
  clips: readonly THREE.AnimationClip[]
}

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

export class ClipDriver implements MotionDriver<ClipProfile> {
  private mixer: THREE.AnimationMixer | null = null
  private body: THREE.Object3D | null = null
  private readonly clips = new Map<string, THREE.AnimationClip>()
  private readonly skeletons: THREE.Skeleton[] = []
  private current: THREE.AnimationAction | null = null
  private currentState: RigState | null = null

  bind(body: THREE.Object3D, profile: ClipProfile): void {
    this.body = body
    this.mixer = new THREE.AnimationMixer(body)
    this.clips.clear()
    for (const clip of profile.clips) this.clips.set(clip.name, clip)
    this.skeletons.length = 0
    body.traverse((child) => {
      if (!(child instanceof THREE.SkinnedMesh) || this.skeletons.includes(child.skeleton)) return
      this.skeletons.push(child.skeleton)
    })
  }

  reset(): void {}

  update(input: RigInput, delta: number): void {
    const mixer = this.mixer
    if (!mixer) throw new Error('ClipDriver.update called before bind')
    this.apply(input.state)
    if (input.recovering) this.scaleToDuration(input.castLeft)
    mixer.update(delta)
  }

  dispose(): void {
    if (this.mixer && this.body) {
      this.mixer.stopAllAction()
      this.mixer.uncacheRoot(this.body)
    }
    this.mixer = null
    this.body = null
    this.clips.clear()
    this.skeletons.length = 0
    this.current = null
    this.currentState = null
  }

  private apply(state: RigState): void {
    if (state === this.currentState) return
    let clip: THREE.AnimationClip | undefined
    for (const name of RIG_CLIPS[state]) {
      clip = this.clips.get(name)
      if (clip) break
    }
    if (!clip || !this.mixer) return

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

  private scaleToDuration(seconds: number): void {
    if (!this.current || seconds <= 0) return
    const clip = this.current.getClip()
    this.current.timeScale = clip.duration / seconds
  }
}
