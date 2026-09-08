import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MAX_FRAME_DELTA, RUN_SPEED, SPRINT_SPEED, WALK_SPEED, type Explorer } from './movement'
import { APPROVED_CLIPS, type ApprovedCharacterTemplate, type ApprovedClipName } from './approved-character-source'
import { DEFAULT_STARTER_GEAR_APPEARANCE, StarterGear, type StarterGearAppearance } from './starter-gear'
import type { StarterGearDyeChannel, StarterGearSlot, StarterGearTemplate } from './starter-gear-source'

export { loadApprovedCharacter } from './approved-character-source'
export type { ApprovedCharacterTemplate } from './approved-character-source'

const MOVING_SPEED = 0.05
const BLEND_SECONDS = 0.1
const MOVING_LAND_SECONDS = 0.125
const NO_GEAR_DYE_CHANNELS: StarterGearTemplate['dyeChannels'] = new Map()

export interface ApprovedAnimationState {
  readonly state: 'idle' | 'moving' | 'jumping' | 'landing'
  readonly dominantClip: ApprovedClipName
  readonly speed: number
  readonly phase: number
}

export class ApprovedWorldCharacter {
  readonly root = new THREE.Group()
  private readonly body: THREE.Object3D
  private readonly mixer: THREE.AnimationMixer
  private readonly gear: StarterGear | undefined
  private readonly actions: ReadonlyMap<ApprovedClipName, THREE.AnimationAction>
  private readonly materials = new Set<THREE.Material>()
  private previousX: number
  private previousZ: number
  private previousGrounded: boolean
  private mode: 'start' | 'air' | 'land' | null = null
  private modeTime = 0
  private landingPlaybackTime = 0
  private locomotionPhase = 0
  private dominantClip: ApprovedClipName = 'idle'
  private currentSpeed = 0
  private blendFrom = new Map<ApprovedClipName, number>([['idle', 1]])
  private blendTarget = new Map<ApprovedClipName, number>([['idle', 1]])
  private blendElapsed = BLEND_SECONDS

  constructor(private readonly template: ApprovedCharacterTemplate, explorer: Explorer, gearTemplate?: StarterGearTemplate) {
    this.root.name = 'world-character'
    this.body = cloneSkinned(template.scene)
    const materialClones = new Map<THREE.Material, THREE.Material>()
    this.body.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      const source = object.material as THREE.Material
      let material = materialClones.get(source)
      if (!material) {
        material = source.clone()
        materialClones.set(source, material)
        this.materials.add(material)
      }
      object.material = material
      object.castShadow = true
      object.receiveShadow = true
      object.frustumCulled = false
    })
    this.mixer = new THREE.AnimationMixer(this.body)
    this.actions = new Map(APPROVED_CLIPS.map((name) => [name, this.mixer.clipAction(this.clip(name))]))
    this.gear = gearTemplate ? new StarterGear(this.body, template.manifest.glb.sha256, gearTemplate) : undefined
    this.previousX = explorer.x
    this.previousZ = explorer.z
    this.previousGrounded = explorer.grounded
    this.root.add(this.body)
    this.reset(explorer)
  }

  get animationState(): ApprovedAnimationState {
    return {
      state: this.mode === 'land' ? 'landing' : this.mode ? 'jumping' : this.dominantClip === 'idle' ? 'idle' : 'moving',
      dominantClip: this.dominantClip,
      speed: this.currentSpeed,
      phase: this.locomotionPhase,
    }
  }

  get gearAppearance(): StarterGearAppearance { return this.gear?.appearanceState ?? DEFAULT_STARTER_GEAR_APPEARANCE }
  get gearDyeChannels(): StarterGearTemplate['dyeChannels'] { return this.gear?.dyeChannels ?? NO_GEAR_DYE_CHANNELS }

  setGearEquipped(slot: StarterGearSlot, equipped: boolean): void {
    if (!this.gear) throw new Error('Starter gear is not loaded.')
    this.gear.setEquipped(slot, equipped)
  }

  setGearDye(slot: StarterGearSlot, channel: StarterGearDyeChannel, tint: string | null): void {
    if (!this.gear) throw new Error('Starter gear is not loaded.')
    this.gear.setDye(slot, channel, tint)
  }

  update(explorer: Explorer, delta: number): void {
    const seconds = Math.min(Math.max(delta, 0), MAX_FRAME_DELTA)
    if (seconds === 0) {
      this.root.position.set(explorer.x, explorer.y, explorer.z)
      this.root.rotation.y = explorer.facing
      return
    }
    const distance = Math.hypot(explorer.x - this.previousX, explorer.z - this.previousZ)
    this.currentSpeed = seconds > 0 ? distance / seconds : 0
    this.updateJump(explorer, seconds)
    if (this.mode === 'land' || this.actions.get('jump_land')!.getEffectiveWeight() > 1e-5) {
      this.landingPlaybackTime = Math.min(this.clip('jump_land').duration, this.landingPlaybackTime + seconds)
      this.actions.get('jump_land')!.time = this.landingPlaybackTime
    }
    if (this.mode === 'land' && (this.landingPlaybackTime >= this.clip('jump_land').duration
      || (this.currentSpeed > MOVING_SPEED && this.landingPlaybackTime >= MOVING_LAND_SECONDS))) {
      this.mode = null
      this.modeTime = 0
    }
    const target = this.targetClip()
    this.dominantClip = target
    if (!this.mode && target !== 'idle') {
      const record = this.template.manifest.clips.find((clip) => clip.name === target)!
      this.locomotionPhase = (this.locomotionPhase + distance / (record.nominalSpeed * record.duration)) % 1
      for (const clipName of ['walk_forward', 'run_forward', 'sprint_forward'] as const) {
        this.actions.get(clipName)!.time = this.locomotionPhase * this.clip(clipName).duration
      }
    } else if (this.mode) {
      const action = this.actions.get(target)!
      action.time = target === 'jump_air' ? this.modeTime % action.getClip().duration
        : target === 'jump_land' ? this.landingPlaybackTime : Math.min(this.modeTime, action.getClip().duration)
    }
    this.blendTo(target, seconds)
    this.mixer.update(0)
    this.root.position.set(explorer.x, explorer.y, explorer.z)
    this.root.rotation.y = explorer.facing
    this.previousX = explorer.x
    this.previousZ = explorer.z
  }

  reset(explorer: Explorer): void {
    this.mixer.stopAllAction()
    for (const [name, action] of this.actions) {
      action.reset().play()
      action.enabled = name === 'idle'
      action.setEffectiveWeight(name === 'idle' ? 1 : 0)
      action.setEffectiveTimeScale(0)
      action.setLoop(this.isLooping(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      action.clampWhenFinished = !this.isLooping(name)
    }
    this.mode = null
    this.modeTime = 0
    this.landingPlaybackTime = 0
    this.locomotionPhase = 0
    this.dominantClip = 'idle'
    this.currentSpeed = 0
    this.previousX = explorer.x
    this.previousZ = explorer.z
    this.previousGrounded = explorer.grounded
    this.blendFrom = new Map([['idle', 1]])
    this.blendTarget = new Map([['idle', 1]])
    this.blendElapsed = BLEND_SECONDS
    this.root.position.set(explorer.x, explorer.y, explorer.z)
    this.root.rotation.y = explorer.facing
    this.mixer.update(0)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.body)
    this.gear?.dispose()
    for (const material of this.materials) material.dispose()
    this.root.removeFromParent()
  }

  private updateJump(explorer: Explorer, seconds: number): void {
    if (explorer.jumpPhase === 'preparing' && this.mode !== 'start') this.beginMode('start')
    else if (this.previousGrounded && !explorer.grounded && this.mode !== 'start') this.beginMode('start')
    else if (explorer.jumpPhase === 'landing' && this.mode !== 'land') this.beginMode('land')
    else if (!explorer.grounded && !this.mode) { this.mode = 'air'; this.modeTime = 0 }
    if (this.mode === 'start') {
      this.modeTime += seconds
      if (this.modeTime >= this.clip('jump_start').duration) {
        this.modeTime -= this.clip('jump_start').duration
        this.mode = 'air'
      }
    } else if (this.mode === 'air') this.modeTime += seconds
    this.previousGrounded = explorer.grounded
  }

  private beginMode(mode: 'start' | 'land'): void {
    this.mode = mode
    this.modeTime = 0
    if (mode === 'land') this.landingPlaybackTime = 0
    const action = this.actions.get(mode === 'start' ? 'jump_start' : 'jump_land')!
    action.reset().play()
    action.setEffectiveTimeScale(0)
  }

  private targetClip(): ApprovedClipName {
    if (this.mode === 'start') return 'jump_start'
    if (this.mode === 'air') return 'jump_air'
    if (this.mode === 'land') return 'jump_land'
    if (this.currentSpeed <= MOVING_SPEED) return 'idle'
    if (this.currentSpeed < (WALK_SPEED + RUN_SPEED) / 2) return 'walk_forward'
    return this.currentSpeed < (RUN_SPEED + SPRINT_SPEED) / 2 ? 'run_forward' : 'sprint_forward'
  }

  private blendTo(target: ApprovedClipName, seconds: number): void {
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

  private clip(name: ApprovedClipName): THREE.AnimationClip {
    return this.template.animations.find((clip) => clip.name === name)!
  }

  private isLooping(name: ApprovedClipName): boolean {
    return this.template.manifest.clips.find((clip) => clip.name === name)!.loop
  }
}
