import { canOccupy as canOccupyWorld, type Occupant } from './movement'
import { heightAt as terrainHeightAt } from './terrain'

export const HOME = { x: -43, z: 20 } as const
export const ROAM_RADIUS = 3.5
export const WOLF_RADIUS = 0.7
export const WALK_SPEED = 0.5
export const ATTACK_SECONDS = 1
export const MAX_FRAME_DELTA = 0.1

const STEP_SECONDS = 1 / 60
const PATH_SAMPLE_SPACING = 0.2
const MAX_DESTINATION_ATTEMPTS = 8
const RETRY_SECONDS = 0.5
const MIN_ATTACK_INTERVAL = 3
const ATTACK_INTERVAL_RANGE = 4
const EPSILON = 1e-9

export type WolfOccupancy = Occupant
export type WolfAction = 'walk' | 'attack'
export type WolfClip = 'walk' | 'attack'

export interface WanderingWolfState {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly facing: number
  readonly action: WolfAction
  readonly dominantClip: WolfClip
  readonly actionTime: number
  readonly attackCount: number
}

export interface WanderingWolfSnapshot {
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly facing: number
  readonly state: WolfAction
  readonly dominantClip: WolfClip
  readonly time: number
  readonly attackCount: number
}

interface WanderingWolfOptions {
  readonly seed?: number
  readonly home?: { readonly x: number; readonly z: number }
  readonly roamRadius?: number
  readonly radius?: number
  readonly speed?: number
  readonly heightAt?: (x: number, z: number) => number
  readonly canOccupy?: (from: WolfOccupancy, x: number, z: number) => boolean
}

class LocalRng {
  constructor(private value: number) { this.value ||= 0x6d2b79f5 }

  next(): number {
    let value = this.value
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.value = value >>> 0
    return this.value / 0x1_0000_0000
  }
}

export class WanderingWolfController {
  private readonly initialSeed: number
  private readonly home: { readonly x: number; readonly z: number }
  private readonly roamRadius: number
  private readonly radius: number
  private readonly speed: number
  private readonly heightAt: (x: number, z: number) => number
  private readonly canOccupy: (from: WolfOccupancy, x: number, z: number) => boolean
  private rng: LocalRng
  private current: WanderingWolfState
  private destination: { x: number; z: number } | undefined
  private attackRemaining = 0
  private attackDelay = 0
  private retryRemaining = 0
  private accumulator = 0

  constructor(options: WanderingWolfOptions = {}) {
    this.initialSeed = options.seed ?? 0x57_0f_2026
    this.home = options.home ?? HOME
    this.roamRadius = options.roamRadius ?? ROAM_RADIUS
    this.radius = options.radius ?? WOLF_RADIUS
    this.speed = options.speed ?? WALK_SPEED
    this.heightAt = options.heightAt ?? terrainHeightAt
    this.canOccupy = options.canOccupy ?? ((from, x, z) => canOccupyWorld(from, x, z))
    this.rng = new LocalRng(this.initialSeed)
    this.current = this.initialState()
    this.reset()
  }

  get state(): WanderingWolfState { return this.current }

  advance(delta: number): WanderingWolfState {
    this.accumulator += Math.min(Math.max(delta, 0), MAX_FRAME_DELTA)
    while (this.accumulator + EPSILON >= STEP_SECONDS) {
      this.tick()
      this.accumulator -= STEP_SECONDS
      if (this.accumulator < EPSILON) this.accumulator = 0
    }
    return this.current
  }

  reset(): WanderingWolfState {
    this.rng = new LocalRng(this.initialSeed)
    this.current = this.initialState()
    this.destination = undefined
    this.attackRemaining = 0
    this.attackDelay = this.nextAttackDelay()
    this.retryRemaining = 0
    this.accumulator = 0
    this.chooseDestination()
    return this.current
  }

  snapshot(): WanderingWolfSnapshot {
    return {
      position: { x: this.current.x, y: this.current.y, z: this.current.z },
      facing: this.current.facing,
      state: this.current.action,
      dominantClip: this.current.dominantClip,
      time: this.current.actionTime,
      attackCount: this.current.attackCount,
    }
  }

  private initialState(): WanderingWolfState {
    return {
      x: this.home.x,
      y: this.heightAt(this.home.x, this.home.z),
      z: this.home.z,
      facing: 0,
      action: 'walk',
      dominantClip: 'walk',
      actionTime: 0,
      attackCount: 0,
    }
  }

  private tick(): void {
    if (this.current.action === 'attack') {
      this.attackRemaining -= STEP_SECONDS
      if (this.attackRemaining > EPSILON) {
        this.current = { ...this.current, actionTime: ATTACK_SECONDS - this.attackRemaining }
        return
      }
      this.current = { ...this.current, action: 'walk', dominantClip: 'walk', actionTime: 0 }
      this.chooseDestination()
      return
    }

    this.attackDelay -= STEP_SECONDS
    if (this.attackDelay <= EPSILON) {
      this.attackRemaining = ATTACK_SECONDS
      this.attackDelay = this.nextAttackDelay()
      this.current = {
        ...this.current,
        action: 'attack',
        dominantClip: 'attack',
        actionTime: 0,
        attackCount: this.current.attackCount + 1,
      }
      return
    }

    if (!this.destination) {
      this.retryRemaining -= STEP_SECONDS
      if (this.retryRemaining <= EPSILON) this.chooseDestination()
      return
    }

    const dx = this.destination.x - this.current.x
    const dz = this.destination.z - this.current.z
    const remaining = Math.hypot(dx, dz)
    if (remaining <= EPSILON) {
      this.chooseDestination()
      return
    }
    const distance = Math.min(this.speed * STEP_SECONDS, remaining)
    const x = this.current.x + dx / remaining * distance
    const z = this.current.z + dz / remaining * distance
    const occupant = { x: this.current.x, z: this.current.z, radius: this.radius }
    if (!this.canOccupy(occupant, x, z)) {
      this.destination = undefined
      this.retryRemaining = RETRY_SECONDS
      return
    }
    const facing = Math.atan2(dx, dz)
    this.current = { ...this.current, x, y: this.heightAt(x, z), z, facing, actionTime: this.current.actionTime + STEP_SECONDS }
    if (distance >= remaining - EPSILON) this.chooseDestination()
  }

  private chooseDestination(): void {
    this.destination = undefined
    for (let attempt = 0; attempt < MAX_DESTINATION_ATTEMPTS; attempt += 1) {
      const angle = this.rng.next() * Math.PI * 2
      const distance = Math.sqrt(this.rng.next()) * this.roamRadius
      const candidate = {
        x: this.home.x + Math.sin(angle) * distance,
        z: this.home.z + Math.cos(angle) * distance,
      }
      if (this.routeIsClear(candidate)) {
        this.destination = candidate
        this.retryRemaining = 0
        return
      }
    }
    this.retryRemaining = RETRY_SECONDS
  }

  private routeIsClear(destination: { readonly x: number; readonly z: number }): boolean {
    const dx = destination.x - this.current.x
    const dz = destination.z - this.current.z
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / PATH_SAMPLE_SPACING))
    let from: WolfOccupancy = { x: this.current.x, z: this.current.z, radius: this.radius }
    for (let sample = 1; sample <= samples; sample += 1) {
      const x = this.current.x + dx * sample / samples
      const z = this.current.z + dz * sample / samples
      if (!this.canOccupy(from, x, z)) return false
      from = { x, z, radius: this.radius }
    }
    return true
  }

  private nextAttackDelay(): number {
    return MIN_ATTACK_INTERVAL + this.rng.next() * ATTACK_INTERVAL_RANGE
  }
}
