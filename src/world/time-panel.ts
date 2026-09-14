import { MAX_DAY_DURATION_SECONDS, type WorldClockState } from './world-clock'

export interface TimePanelActions {
  readonly clearMovement: () => void
  readonly setHour: (hour: number) => void
  readonly setDuration: (durationSeconds: number) => void
  readonly setPaused: (paused: boolean) => void
}

export interface TimePanel {
  update(state: WorldClockState): void
  dispose(): void
}

const PRESETS = [
  ['Dawn', 6], ['Noon', 12], ['Dusk', 18], ['Midnight', 0],
] as const

export function createTimePanel(host: HTMLElement, actions: TimePanelActions): TimePanel {
  const panel = document.createElement('aside')
  panel.id = 'time-of-day-panel'
  panel.className = 'pointer-events-auto fixed left-4 top-36 z-30 w-44 max-w-[calc(100vw-2rem)] text-stone-100 sm:top-28 sm:w-64'
  panel.innerHTML = `
    <details class="max-h-[calc(100vh-19rem)] overflow-y-auto rounded-xl border border-stone-100/15 bg-stone-950/80 shadow-2xl backdrop-blur-md sm:max-h-[calc(100vh-10rem)]">
      <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-amber-50">Time of day <span data-clock class="ml-1 font-mono text-stone-300">08:00</span></summary>
      <div class="space-y-3 border-t border-stone-100/10 p-3">
        <label class="block text-[0.68rem] uppercase tracking-wider text-stone-400">Hour
          <input data-hour class="mt-1 block w-full accent-amber-300" type="range" min="0" max="24" step="0.05" value="8">
        </label>
        <div data-presets class="grid grid-cols-2 gap-1.5">
          ${PRESETS.map(([label, hour]) => `<button type="button" data-hour-preset="${hour}" class="rounded-md border border-stone-100/15 px-2 py-1.5 text-[0.7rem] hover:bg-stone-800">${label}</button>`).join('')}
        </div>
        <label class="block text-[0.68rem] uppercase tracking-wider text-stone-400">Cycle seconds
          <input data-duration class="mt-1 block w-full rounded-md border border-stone-100/15 bg-stone-900 px-2 py-1.5 text-sm text-stone-100" type="number" min="1" max="${MAX_DAY_DURATION_SECONDS}" step="1" value="600">
        </label>
        <button data-pause type="button" class="w-full rounded-md border border-amber-100/20 bg-amber-100/10 px-2 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-100/15">Pause</button>
      </div>
    </details>`
  host.append(panel)

  const hourInput = required<HTMLInputElement>(panel, '[data-hour]')
  const durationInput = required<HTMLInputElement>(panel, '[data-duration]')
  const pauseButton = required<HTMLButtonElement>(panel, '[data-pause]')
  const clock = required<HTMLElement>(panel, '[data-clock]')
  let state: WorldClockState = { hour: 8, durationSeconds: 600, paused: false }

  const stopKey = (event: Event): void => { event.stopPropagation() }
  const clearMovement = (): void => { actions.clearMovement() }
  const setHour = (): void => { actions.setHour(hourInput.valueAsNumber) }
  const setDuration = (): void => {
    if (durationInput.validity.valid) actions.setDuration(durationInput.valueAsNumber)
  }
  const togglePause = (): void => { actions.setPaused(!state.paused) }
  const selectPreset = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-hour-preset]')
    if (button) actions.setHour(Number(button.dataset.hourPreset))
  }
  panel.addEventListener('keydown', stopKey)
  panel.addEventListener('keyup', stopKey)
  panel.addEventListener('keypress', stopKey)
  panel.addEventListener('focusin', clearMovement)
  panel.addEventListener('pointerenter', clearMovement)
  hourInput.addEventListener('input', setHour)
  durationInput.addEventListener('change', setDuration)
  pauseButton.addEventListener('click', togglePause)
  required(panel, '[data-presets]').addEventListener('click', selectPreset)

  return {
    update: (next) => {
      state = next
      clock.textContent = formatHour(next.hour)
      pauseButton.textContent = next.paused ? 'Resume' : 'Pause'
      if (document.activeElement !== hourInput) hourInput.value = String(next.hour)
      if (document.activeElement !== durationInput) durationInput.value = String(next.durationSeconds)
    },
    dispose: () => {
      panel.removeEventListener('keydown', stopKey)
      panel.removeEventListener('keyup', stopKey)
      panel.removeEventListener('keypress', stopKey)
      panel.removeEventListener('focusin', clearMovement)
      panel.removeEventListener('pointerenter', clearMovement)
      hourInput.removeEventListener('input', setHour)
      durationInput.removeEventListener('change', setDuration)
      pauseButton.removeEventListener('click', togglePause)
      required(panel, '[data-presets]').removeEventListener('click', selectPreset)
      panel.remove()
    },
  }
}

function formatHour(hour: number): string {
  const totalMinutes = Math.floor((((hour % 24) + 24) % 24) * 60) % (24 * 60)
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing time panel control: ${selector}`)
  return element
}
