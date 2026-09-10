import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { WanderingWolfState } from './wandering-wolf'
import { WOLF_CLIPS, type WolfClipName, type WolfTemplate } from './wolf-source'

const BLEND_SECONDS = 0.1

export interface WolfAnimationState {
  readonly dominantClip: 'walk' | 'attack'
  readonly time: number
}

export class WolfView {
  readonly root = new THREE.Group()
  private readonly body: THREE.Object3D
  private readonly mixer: THREE.AnimationMixer
  private readonly actions: ReadonlyMap<WolfClipName, THREE.AnimationAction>
  private readonly materials = new Set<THREE.Material>()
  private dominantClip: 'walk' | 'attack' = 'walk'
  private displayedTime = 0
  private blendFrom = new Map<WolfClipName, number>([['walk', 1]])
  private blendTarget = new Map<WolfClipName, number>([['walk', 1]])
  private blendElapsed = BLEND_SECONDS

  constructor(private readonly template: WolfTemplate, state: WanderingWolfState) {
    this.root.name = 'ambient-wolf'
    this.body = cloneSkinned(template.scene)
    const materialClones = new Map<THREE.Material, THREE.Material>()
    this.body.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
      const owned = sourceMaterials.map((source) => {
        const cached = materialClones.get(source)
        if (cached) return cached
        const material = source.clone()
        materialClones.set(source, material)
        this.materials.add(material)
        return material
      })
      object.material = Array.isArray(object.material) ? owned : owned[0]!
      object.castShadow = true
      object.receiveShadow = true
      object.frustumCulled = false
    })
    this.body.position.set(0, template.manifest.frame.groundOffsetY, -template.restCenterZ)
    this.root.add(this.body)
    this.mixer = new THREE.AnimationMixer(this.body)
    this.actions = new Map(WOLF_CLIPS.map((name) => [name, this.mixer.clipAction(this.clip(name))]))
    this.reset(state)
  }

  get animationState(): WolfAnimationState {
    return { dominantClip: this.dominantClip, time: this.displayedTime }
  }

  update(state: WanderingWolfState, delta: number): void {
    this.place(state)
    const seconds = Math.min(Math.max(delta, 0), 0.1)
    if (seconds === 0) return
    const target = state.dominantClip
    this.dominantClip = target
    this.displayedTime = state.actionTime
    const action = this.actions.get(target)!
    action.time = target === 'walk'
      ? state.actionTime % action.getClip().duration
      : Math.min(state.actionTime, action.getClip().duration)
    this.blendTo(target, seconds)
    this.mixer.update(0)
  }

  reset(state: WanderingWolfState): void {
    this.mixer.stopAllAction()
    for (const [name, action] of this.actions) {
      action.reset().play()
      action.enabled = name === 'walk'
      action.setEffectiveWeight(name === 'walk' ? 1 : 0)
      action.setEffectiveTimeScale(0)
      action.setLoop(name === 'attack' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
      action.clampWhenFinished = name === 'attack'
    }
    this.dominantClip = 'walk'
    this.displayedTime = 0
    this.blendFrom = new Map([['walk', 1]])
    this.blendTarget = new Map([['walk', 1]])
    this.blendElapsed = BLEND_SECONDS
    this.place(state)
    this.mixer.update(0)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.body)
    for (const material of this.materials) material.dispose()
    this.root.removeFromParent()
  }

  private place(state: WanderingWolfState): void {
    this.root.position.set(state.x, state.y, state.z)
    this.root.rotation.y = state.facing
  }

  private blendTo(target: 'walk' | 'attack', seconds: number): void {
    if (this.blendTarget.size !== 1 || !this.blendTarget.has(target)) {
      this.blendFrom = new Map([...this.actions].map(([name, action]) => [name, action.getEffectiveWeight()]))
      this.blendTarget = new Map([[target, 1]])
      this.blendElapsed = 0
    }
    this.blendElapsed = Math.min(BLEND_SECONDS, this.blendElapsed + seconds)
    const progress = this.blendElapsed / BLEND_SECONDS
    for (const [name, action] of this.actions) {
      const weight = (this.blendFrom.get(name) ?? 0) + ((this.blendTarget.get(name) ?? 0) - (this.blendFrom.get(name) ?? 0)) * progress
      action.enabled = weight > 1e-5
      action.setEffectiveWeight(weight)
    }
  }

  private clip(name: WolfClipName): THREE.AnimationClip {
    return this.template.animations.find((clip) => clip.name === name)!
  }
}
