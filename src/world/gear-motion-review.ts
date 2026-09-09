import { APPROVED_CLIPS, type ApprovedClipName } from './approved-character-source'
import type { GearReviewCameraPreset } from './gear-motion-review-gate'
import type { WorldView } from './renderer'

export interface GearMotionReviewUi {
  update(): void
  dispose(): void
}

export function createGearMotionReview(
  host: HTMLElement,
  view: WorldView,
  facing: () => number,
): GearMotionReviewUi {
  const panel = document.createElement('section')
  panel.id = 'gear-motion-review'
  panel.setAttribute('aria-labelledby', 'gear-motion-review-title')
  panel.className = 'pointer-events-auto fixed left-4 top-28 z-40 w-72 rounded-xl border border-sky-200/25 bg-stone-950/90 p-3 text-stone-100 shadow-2xl backdrop-blur-md sm:left-6 sm:top-32'
  panel.innerHTML = `
    <h2 id="gear-motion-review-title" class="font-serif text-base">Gear motion review</h2>
    <div class="mt-2 grid grid-cols-[1fr_auto] gap-2">
      <label for="gear-motion-review-clip" class="sr-only">Approved clip</label>
      <select id="gear-motion-review-clip" aria-label="Approved clip" class="min-h-10 min-w-0 rounded-md border border-sky-200/25 bg-stone-900 px-2 text-sm">
        ${APPROVED_CLIPS.map((clip) => `<option value="${clip}">${clip}</option>`).join('')}
      </select>
      <button id="gear-motion-review-play" type="button" aria-label="Pause selected clip" class="min-h-10 rounded-md border border-sky-200/25 bg-sky-100/10 px-3 text-sm">Pause</button>
    </div>
    <div class="mt-3 grid gap-1">
      <label for="gear-motion-review-time" class="sr-only">Normalized clip time</label>
      <input id="gear-motion-review-time" type="range" min="0" max="1" step="0.001" value="0" aria-label="Normalized clip time" class="w-full accent-sky-300">
      <output id="gear-motion-review-readout" for="gear-motion-review-time" aria-live="polite" class="font-mono text-xs text-stone-300"></output>
    </div>
    <fieldset class="mt-3 flex flex-wrap items-center gap-2">
      <legend class="mr-1 text-xs text-stone-300">Camera</legend>
      ${(['front', 'back', 'left', 'right'] as const).map((preset) => `<button type="button" data-review-camera="${preset}" aria-label="View character from ${preset}" class="min-h-10 rounded-md border border-stone-200/20 px-3 text-xs capitalize hover:bg-stone-800">${preset}</button>`).join('')}
      <span class="text-[0.65rem] text-stone-400">Scroll: 2.3 m detail</span>
    </fieldset>`
  host.append(panel)

  const clip = panel.querySelector<HTMLSelectElement>('#gear-motion-review-clip')!
  const play = panel.querySelector<HTMLButtonElement>('#gear-motion-review-play')!
  const time = panel.querySelector<HTMLInputElement>('#gear-motion-review-time')!
  const readout = panel.querySelector<HTMLOutputElement>('#gear-motion-review-readout')!

  clip.addEventListener('change', () => {
    if (!APPROVED_CLIPS.includes(clip.value as ApprovedClipName)) return
    view.setMotionReviewClip(clip.value as ApprovedClipName)
    update()
  })
  play.addEventListener('click', () => {
    const state = view.motionReviewState
    if (!state) return
    view.setMotionReviewPlaying(!state.playing)
    update()
  })
  time.addEventListener('input', () => {
    view.setMotionReviewProgress(Number(time.value))
    update()
  })
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-review-camera]')) {
    button.addEventListener('click', () => {
      view.setGearReviewCamera(button.dataset.reviewCamera as GearReviewCameraPreset, facing())
    })
  }

  function update(): void {
    const state = view.motionReviewState
    if (!state) return
    clip.value = state.clip
    play.textContent = state.playing ? 'Pause' : 'Play'
    play.setAttribute('aria-label', `${state.playing ? 'Pause' : 'Play'} selected clip`)
    if (document.activeElement !== time) time.value = String(state.normalizedTime)
    readout.value = `${state.clip} · ${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s · ${Math.round(state.normalizedTime * 100)}%`
  }

  update()
  return { update, dispose: () => panel.remove() }
}
