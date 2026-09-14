export const DEFAULT_START_HOUR = 8
export const DEFAULT_DAY_DURATION_SECONDS = 600
export const MAX_DAY_DURATION_SECONDS = 604_800

export interface WorldClockState {
  readonly hour: number
  readonly durationSeconds: number
  readonly paused: boolean
}

export interface WorldClockOptions {
  readonly nowMilliseconds: number
  readonly startHour?: number
  readonly durationSeconds?: number
  readonly paused?: boolean
}

export class WorldClock {
  private anchorHour: number
  private anchorMilliseconds: number
  private dayDurationSeconds: number
  private isPaused: boolean

  constructor(options: WorldClockOptions) {
    this.anchorMilliseconds = validMonotonic(options.nowMilliseconds)
    this.anchorHour = wrappedHour(options.startHour ?? DEFAULT_START_HOUR)
    this.dayDurationSeconds = validDuration(options.durationSeconds ?? DEFAULT_DAY_DURATION_SECONDS)
    this.isPaused = options.paused ?? false
  }

  read(nowMilliseconds: number): WorldClockState {
    const now = validMonotonic(nowMilliseconds)
    const cycleMilliseconds = this.dayDurationSeconds * 1_000
    const elapsedHours = this.isPaused ? 0 : ((now - this.anchorMilliseconds) % cycleMilliseconds) * 24 / cycleMilliseconds
    return {
      hour: wrappedHour(this.anchorHour + elapsedHours),
      durationSeconds: this.dayDurationSeconds,
      paused: this.isPaused,
    }
  }

  setHour(hour: number, nowMilliseconds: number): void {
    const nextAnchor = validMonotonic(nowMilliseconds)
    const nextHour = wrappedHour(hour)
    this.anchorMilliseconds = nextAnchor
    this.anchorHour = nextHour
  }

  setDuration(durationSeconds: number, nowMilliseconds: number): void {
    const nextDuration = validDuration(durationSeconds)
    const current = this.read(nowMilliseconds)
    this.anchorHour = current.hour
    this.anchorMilliseconds = nowMilliseconds
    this.dayDurationSeconds = nextDuration
  }

  setPaused(paused: boolean, nowMilliseconds: number): void {
    const current = this.read(nowMilliseconds)
    this.anchorHour = current.hour
    this.anchorMilliseconds = nowMilliseconds
    this.isPaused = paused
  }
}

function wrappedHour(hour: number): number {
  if (!Number.isFinite(hour)) throw new Error('World clock hour must be finite.')
  return ((hour % 24) + 24) % 24
}

function validDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DAY_DURATION_SECONDS) {
    throw new Error(`World clock duration must be between 1 and ${MAX_DAY_DURATION_SECONDS} seconds.`)
  }
  return durationSeconds
}

function validMonotonic(nowMilliseconds: number): number {
  if (!Number.isFinite(nowMilliseconds)) throw new Error('World clock monotonic time must be finite.')
  return nowMilliseconds
}
