export const BGM_MUTED_STORAGE_KEY = 'ashveil.bgm.muted'
export const BGM_VOLUME_STORAGE_KEY = 'ashveil.bgm.volume'

const DEFAULT_TARGET_VOLUME = 0.6
const DEFAULT_FADE_SECONDS = 2.5

export interface BgmAudioLike {
  src: string
  loop: boolean
  volume: number
  paused: boolean
  play(): Promise<void>
  pause(): void
}

export interface BgmStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type BgmGestureSource = (trigger: () => void) => () => void
export type BgmVisibilitySource = (onChange: (visible: boolean) => void) => () => void

export interface IntroZoneBgmStatus {
  readonly source: string
  playing: boolean
  muted: boolean
  /** The configured music level (0..1); status.volume is the fade-in-progress value. */
  level: number
  volume: number
}

export interface IntroZoneBgm {
  readonly status: IntroZoneBgmStatus
  tick(nowMilliseconds: number): void
  toggleMuted(): void
  setLevel(level: number): void
  subscribe(listener: () => void): () => void
  dispose(): void
}

export interface IntroZoneBgmDependencies {
  source: string
  createAudio: (source: string) => BgmAudioLike
  storage: BgmStorageLike
  onGesture: BgmGestureSource
  onVisibilityChange?: BgmVisibilitySource
  targetVolume?: number
  fadeSeconds?: number
}

interface Fade { from: number; to: number; startedAt: number }

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function readStoredLevel(storage: BgmStorageLike, fallback: number): number {
  const raw = Number.parseFloat(storage.getItem(BGM_VOLUME_STORAGE_KEY) ?? '')
  return Number.isFinite(raw) ? clamp01(raw) : clamp01(fallback)
}

/**
 * The intro-zone music bed. Browsers reject play() before a user gesture, so the
 * player stays armed on the first pointer/key press and retries until audio starts.
 * Volume fades ride the render loop's tick rather than owning a timer of their own.
 */
export function createIntroZoneBgm(dependencies: IntroZoneBgmDependencies): IntroZoneBgm {
  const fadeSeconds = dependencies.fadeSeconds ?? DEFAULT_FADE_SECONDS
  const audio = dependencies.createAudio(dependencies.source)
  audio.src = dependencies.source
  audio.loop = true
  audio.volume = 0

  let muted = dependencies.storage.getItem(BGM_MUTED_STORAGE_KEY) === '1'
  let level = readStoredLevel(dependencies.storage, dependencies.targetVolume ?? DEFAULT_TARGET_VOLUME)
  let started = false
  let fade: Fade | undefined
  let pausedForTab = false
  let lastNow = 0
  let disposed = false
  const listeners = new Set<() => void>()

  const status: IntroZoneBgmStatus = { source: dependencies.source, playing: false, muted, level, volume: 0 }

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  const stopGesture = dependencies.onGesture(() => { attemptStart() })
  const stopVisibility = dependencies.onVisibilityChange?.((visible) => {
    if (disposed) return
    if (!visible) {
      if (started && !audio.paused) {
        audio.pause()
        pausedForTab = true
      }
      return
    }
    if (pausedForTab) {
      pausedForTab = false
      void play()
    }
  })

  async function play(): Promise<void> {
    try {
      await audio.play()
      started = true
      status.playing = true
      stopGesture()
      notify()
    } catch {
      // Autoplay policy rejection: stay armed so the next gesture retries.
    }
  }

  function attemptStart(): void {
    if (disposed || started) return
    beginFade(muted ? 0 : level)
    void play()
  }

  function beginFade(to: number): void {
    fade = { from: audio.volume, to, startedAt: lastNow }
  }

  function tick(nowMilliseconds: number): void {
    if (disposed) return
    lastNow = nowMilliseconds
    if (!fade) return
    if (nowMilliseconds < fade.startedAt) fade.startedAt = nowMilliseconds
    const progress = Math.min(1, (nowMilliseconds - fade.startedAt) / (fadeSeconds * 1000))
    const volume = fade.from + (fade.to - fade.from) * progress
    audio.volume = volume
    status.volume = volume
    if (progress === 1) fade = undefined
  }

  function toggleMuted(): void {
    muted = !muted
    status.muted = muted
    dependencies.storage.setItem(BGM_MUTED_STORAGE_KEY, muted ? '1' : '0')
    if (muted) beginFade(0)
    else if (started) beginFade(level)
    notify()
  }

  function setLevel(next: number): void {
    if (disposed) return
    level = clamp01(next)
    status.level = level
    dependencies.storage.setItem(BGM_VOLUME_STORAGE_KEY, String(level))
    if (level > 0 && muted) {
      muted = false
      status.muted = false
      dependencies.storage.setItem(BGM_MUTED_STORAGE_KEY, '0')
    }
    if (started && !muted) beginFade(level)
    notify()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopGesture()
    stopVisibility?.()
    audio.pause()
    status.playing = false
    listeners.clear()
  }

  return { status, tick, toggleMuted, setLevel, subscribe, dispose }
}

const ICON_SOUND = `
  <svg aria-hidden="true" viewbox="0 0 24 24" class="h-4 w-4 fill-none stroke-current stroke-[1.8] stroke-round stroke-linecap-round">
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.2 6a8.5 8.5 0 0 1 0 12" />
  </svg>`
const ICON_MUTED = `
  <svg aria-hidden="true" viewbox="0 0 24 24" class="h-4 w-4 fill-none stroke-current stroke-[1.8] stroke-round stroke-linecap-round">
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M16 9.5 21 15M21 9.5 16 15" />
  </svg>`

export function attachBgmControl(bgm: IntroZoneBgm, host: HTMLElement): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', 'Toggle music')
  button.className = 'pointer-events-auto grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-stone-100/15 bg-stone-950/80 text-amber-50 shadow-lg backdrop-blur-md hover:bg-stone-800/80'

  const paint = (): void => {
    button.setAttribute('aria-pressed', String(bgm.status.muted))
    button.innerHTML = bgm.status.muted ? ICON_MUTED : ICON_SOUND
  }
  paint()
  bgm.subscribe(() => {
    if (button.isConnected) paint()
    button.blur()
  })
  button.addEventListener('click', () => { bgm.toggleMuted() })
  host.append(button)
}
