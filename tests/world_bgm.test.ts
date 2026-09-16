import { describe, expect, it } from 'vitest'
import {
  BGM_MUTED_STORAGE_KEY,
  BGM_VOLUME_STORAGE_KEY,
  createIntroZoneBgm,
  type BgmAudioLike,
  type BgmStorageLike,
  type IntroZoneBgm,
} from '../src/world/bgm'

class FakeAudio implements BgmAudioLike {
  src = ''
  loop = false
  volume = 1
  paused = true
  playCount = 0
  blockPlay = false

  play(): Promise<void> {
    this.playCount += 1
    if (this.blockPlay) return Promise.reject(new Error('autoplay blocked'))
    this.paused = false
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }
}

interface Harness {
  audio: FakeAudio
  values: Record<string, string>
  fireGesture(): void
  fireVisibility(visible: boolean): void
  readonly gestureUnsubscribed: boolean
}

function createHarness(initialValues: Record<string, string> = {}): { bgm: IntroZoneBgm; harness: Harness } {
  const audio = new FakeAudio()
  const values: Record<string, string> = { ...initialValues }
  const storage: BgmStorageLike = {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value },
  }
  let trigger: (() => void) | undefined
  let onChange: ((visible: boolean) => void) | undefined
  let gestureUnsubscribed = false
  const bgm = createIntroZoneBgm({
    source: 'audio/bgm-intro-zone.m4a',
    createAudio: () => audio,
    storage,
    onGesture: (handler) => {
      trigger = handler
      return () => { gestureUnsubscribed = true; trigger = undefined }
    },
    onVisibilityChange: (handler) => {
      onChange = handler
      return () => { onChange = undefined }
    },
  })
  const harness: Harness = {
    audio,
    values,
    get gestureUnsubscribed() { return gestureUnsubscribed },
    fireGesture: () => { trigger?.() },
    fireVisibility: (visible) => { onChange?.(visible) },
  }
  return { bgm, harness }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('intro zone bgm', () => {
  it('stays silent until the first gesture while arming the loop', () => {
    const { bgm, harness } = createHarness()
    expect(harness.audio.playCount).toBe(0)
    expect(harness.audio.loop).toBe(true)
    expect(harness.audio.volume).toBe(0)
    expect(bgm.status.playing).toBe(false)
  })

  it('fades in to the target volume once a gesture starts playback', async () => {
    const { bgm, harness } = createHarness()
    harness.fireGesture()
    await flush()
    expect(bgm.status.playing).toBe(true)
    expect(harness.gestureUnsubscribed).toBe(true)
    bgm.tick(0)
    expect(bgm.status.volume).toBeCloseTo(0, 1e-6)
    bgm.tick(1_250)
    expect(bgm.status.volume).toBeCloseTo(0.3, 1e-6)
    bgm.tick(2_500)
    expect(bgm.status.volume).toBeCloseTo(0.6, 1e-6)
    expect(harness.audio.volume).toBeCloseTo(0.6, 1e-6)
  })

  it('retries on the next gesture when the autoplay policy rejects play', async () => {
    const { bgm, harness } = createHarness()
    harness.audio.blockPlay = true
    harness.fireGesture()
    await flush()
    expect(bgm.status.playing).toBe(false)
    expect(harness.gestureUnsubscribed).toBe(false)
    harness.audio.blockPlay = false
    harness.fireGesture()
    await flush()
    expect(harness.audio.playCount).toBe(2)
    expect(bgm.status.playing).toBe(true)
  })

  it('keeps the bed silent from storage-muted state and fades in on unmute', async () => {
    const { bgm, harness } = createHarness({ [BGM_MUTED_STORAGE_KEY]: '1' })
    expect(bgm.status.muted).toBe(true)
    harness.fireGesture()
    await flush()
    bgm.tick(2_500)
    expect(bgm.status.volume).toBeCloseTo(0, 1e-6)
    bgm.toggleMuted()
    expect(harness.values[BGM_MUTED_STORAGE_KEY]).toBe('0')
    bgm.tick(5_000)
    expect(bgm.status.volume).toBeCloseTo(0.6, 1e-6)
  })

  it('persists the mute choice across player constructions', () => {
    const first = createHarness()
    first.bgm.toggleMuted()
    expect(first.harness.values[BGM_MUTED_STORAGE_KEY]).toBe('1')
    const second = createHarness(first.harness.values)
    expect(second.bgm.status.muted).toBe(true)
  })

  it('pauses while the tab is hidden and resumes when it returns', async () => {
    const { harness } = createHarness()
    harness.fireGesture()
    await flush()
    expect(harness.audio.paused).toBe(false)
    harness.fireVisibility(false)
    expect(harness.audio.paused).toBe(true)
    harness.fireVisibility(true)
    await flush()
    expect(harness.audio.playCount).toBe(2)
    expect(harness.audio.paused).toBe(false)
  })

  it('detaches the gesture listener on dispose', () => {
    const { bgm, harness } = createHarness()
    bgm.dispose()
    expect(harness.gestureUnsubscribed).toBe(true)
    harness.fireGesture()
    expect(harness.audio.playCount).toBe(0)
  })

  it('fades back in when unmuted while the tab is hidden', async () => {
    const { bgm, harness } = createHarness()
    harness.fireGesture()
    await flush()
    bgm.toggleMuted()
    bgm.tick(2_500)
    expect(bgm.status.volume).toBeCloseTo(0, 1e-6)
    harness.fireVisibility(false)
    bgm.toggleMuted()
    bgm.tick(5_000)
    expect(bgm.status.volume).toBeCloseTo(0.6, 1e-6)
    harness.fireVisibility(true)
    await flush()
    expect(harness.audio.paused).toBe(false)
  })

  it('restores the configured music level from storage and fades to it on unmute', async () => {
    const { bgm, harness } = createHarness({ [BGM_MUTED_STORAGE_KEY]: '1', [BGM_VOLUME_STORAGE_KEY]: '0.25' })
    expect(bgm.status.level).toBe(0.25)
    harness.fireGesture()
    await flush()
    bgm.tick(2_500)
    expect(bgm.status.volume).toBeCloseTo(0, 1e-6)
    bgm.toggleMuted()
    bgm.tick(5_000)
    expect(bgm.status.volume).toBeCloseTo(0.25, 1e-6)
  })

  it('ignores a malformed stored level and falls back to the default', () => {
    const { bgm } = createHarness({ [BGM_VOLUME_STORAGE_KEY]: 'loud' })
    expect(bgm.status.level).toBe(0.6)
  })

  it('fades to the new level when setLevel is used and clamps out-of-range values', async () => {
    const { bgm, harness } = createHarness()
    harness.fireGesture()
    await flush()
    bgm.tick(2_500)
    bgm.setLevel(0.9)
    expect(harness.values[BGM_VOLUME_STORAGE_KEY]).toBe('0.9')
    expect(bgm.status.level).toBe(0.9)
    bgm.tick(5_000)
    expect(bgm.status.volume).toBeCloseTo(0.9, 1e-6)
    bgm.setLevel(3)
    expect(bgm.status.level).toBe(1)
  })

  it('dragging the level above zero un-mutes and persists both settings', async () => {
    const { bgm, harness } = createHarness({ [BGM_MUTED_STORAGE_KEY]: '1' })
    harness.fireGesture()
    await flush()
    bgm.tick(2_500)
    bgm.setLevel(0.4)
    expect(bgm.status.muted).toBe(false)
    expect(harness.values[BGM_MUTED_STORAGE_KEY]).toBe('0')
    bgm.tick(5_000)
    expect(bgm.status.volume).toBeCloseTo(0.4, 1e-6)
  })

  it('persists the music level across player constructions', () => {
    const first = createHarness()
    first.bgm.setLevel(0.35)
    expect(first.harness.values[BGM_VOLUME_STORAGE_KEY]).toBe('0.35')
    const second = createHarness(first.harness.values)
    expect(second.bgm.status.level).toBe(0.35)
  })

  it('notifies subscribers when the mute or level changes', () => {
    const { bgm } = createHarness()
    let count = 0
    const unsubscribe = bgm.subscribe(() => { count += 1 })
    bgm.toggleMuted()
    bgm.setLevel(0.2)
    expect(count).toBe(2)
    unsubscribe()
    bgm.toggleMuted()
    expect(count).toBe(2)
  })
})
