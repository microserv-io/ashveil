import type { HillsideTerrainLook } from './hillside-review'

export interface HillsideReviewPanelState {
  readonly look: HillsideTerrainLook
  readonly loading: boolean
  readonly error?: string
}

export interface HillsideReviewPanelActions {
  readonly clearMovement: () => void
  readonly retry: () => void
  readonly setLook: (look: HillsideTerrainLook) => void
}

export interface HillsideReviewPanel {
  update(state: HillsideReviewPanelState): void
  dispose(): void
}

export function createHillsideReviewPanel(
  host: HTMLElement,
  actions: HillsideReviewPanelActions,
): HillsideReviewPanel {
  const panel = document.createElement('aside')
  panel.id = 'hillside-review-panel'
  panel.setAttribute('aria-label', 'Terrain material comparison')
  panel.className = 'pointer-events-auto fixed bottom-32 left-1/2 z-40 w-[min(21rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-stone-100/20 bg-stone-950/85 p-2 text-stone-100 shadow-2xl backdrop-blur-md sm:bottom-16'
  panel.innerHTML = `
    <p class="px-1 pb-1.5 text-center text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-amber-100/75">Alderbank terrain study</p>
    <div class="grid grid-cols-2 gap-1" role="group" aria-label="Terrain look">
      <button type="button" data-look="baseline" class="rounded-lg border px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-200">Baseline</button>
      <button type="button" data-look="painterly" class="rounded-lg border px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-200">Painterly</button>
    </div>
    <p data-status class="hidden px-2 pt-2 text-center text-xs leading-5 text-red-200"></p>
    <button type="button" data-retry class="mx-auto mt-2 hidden rounded-md border border-red-200/30 px-3 py-1.5 text-xs font-medium text-red-100 outline-none hover:bg-red-100/10 focus-visible:ring-2 focus-visible:ring-red-200">Retry texture</button>`
  host.append(panel)

  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-look]')]
  const baseline = required<HTMLButtonElement>(panel, '[data-look="baseline"]')
  const status = required<HTMLElement>(panel, '[data-status]')
  const retry = required<HTMLButtonElement>(panel, '[data-retry]')
  const stopKey = (event: Event): void => { event.stopPropagation() }
  const selectLook = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-look]')
    if (button?.dataset.look === 'baseline' || button?.dataset.look === 'painterly') actions.setLook(button.dataset.look)
  }
  const retryTexture = (): void => { actions.retry() }
  panel.addEventListener('keydown', stopKey)
  panel.addEventListener('keyup', stopKey)
  panel.addEventListener('keypress', stopKey)
  panel.addEventListener('focusin', actions.clearMovement)
  panel.addEventListener('pointerenter', actions.clearMovement)
  panel.addEventListener('click', selectLook)
  retry.addEventListener('click', retryTexture)

  return {
    update: (state) => {
      for (const button of buttons) {
        const selected = button.dataset.look === state.look
        button.setAttribute('aria-pressed', String(selected))
        button.classList.toggle('border-amber-200/60', selected)
        button.classList.toggle('bg-amber-100/15', selected)
        button.classList.toggle('border-stone-100/15', !selected)
      }
      baseline.disabled = state.loading || Boolean(state.error)
      baseline.classList.toggle('cursor-wait', state.loading)
      baseline.classList.toggle('opacity-45', baseline.disabled)
      status.textContent = state.loading ? 'Loading baseline terrain…' : state.error ?? ''
      status.classList.toggle('hidden', !state.loading && !state.error)
      retry.classList.toggle('hidden', !state.error)
    },
    dispose: () => {
      panel.removeEventListener('keydown', stopKey)
      panel.removeEventListener('keyup', stopKey)
      panel.removeEventListener('keypress', stopKey)
      panel.removeEventListener('focusin', actions.clearMovement)
      panel.removeEventListener('pointerenter', actions.clearMovement)
      panel.removeEventListener('click', selectLook)
      retry.removeEventListener('click', retryTexture)
      panel.remove()
    },
  }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
    if (!element) throw new Error(`Missing terrain review control: ${selector}`)
  return element
}
