export interface WorldHud {
  readonly joystick: HTMLElement
  readonly joystickKnob: HTMLElement
  readonly sprintButton: HTMLButtonElement
  readonly overviewButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
  setLocation(name: string): void
  setOverview(active: boolean): void
}

export function createWorldHud(root: HTMLElement): WorldHud {
  root.innerHTML = `
    <main id="world-shell" class="pointer-events-none fixed inset-0 overflow-hidden text-stone-100">
      <section aria-label="Terrain exploration" class="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col items-start justify-between gap-3 p-4 min-[440px]:flex-row sm:p-6">
        <div class="rounded-xl border border-amber-100/15 bg-stone-950/70 px-4 py-3 shadow-2xl backdrop-blur-md">
          <p class="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-amber-200/65">Terrain exploration</p>
          <h1 id="location" class="mt-1 font-serif text-xl tracking-wide text-stone-50">Alderbank Refuge</h1>
        </div>
        <div class="pointer-events-auto flex gap-2">
          <button id="overview" class="rounded-lg border border-stone-200/15 bg-stone-950/70 px-3 py-2 text-xs font-medium backdrop-blur-md hover:bg-stone-800">Overview</button>
          <button id="reset" class="rounded-lg border border-stone-200/15 bg-stone-950/70 px-3 py-2 text-xs font-medium backdrop-blur-md hover:bg-stone-800">Return to refuge</button>
        </div>
      </section>
      <div class="pointer-events-none fixed bottom-5 left-1/2 z-20 hidden -translate-x-1/2 rounded-full border border-stone-200/10 bg-stone-950/65 px-5 py-2 text-xs text-stone-300 backdrop-blur-md md:block">WASD to walk · Shift to run · Drag to look · Scroll to zoom</div>
      <section aria-label="Touch controls" class="touch-controls pointer-events-none fixed inset-x-0 bottom-5 z-30 flex items-end justify-between px-5">
        <div id="joystick" class="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-stone-100/20 bg-stone-950/35 backdrop-blur-sm">
          <div id="joystick-knob" class="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100/30 bg-amber-100/20"></div>
        </div>
        <button id="sprint" class="pointer-events-auto h-20 w-20 touch-none rounded-full border border-stone-100/20 bg-stone-950/45 text-xs font-semibold uppercase tracking-widest text-amber-100 backdrop-blur-sm">Run</button>
      </section>
    </main>`
  const get = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Missing world UI: ${id}`)
    return element as T
  }
  const location = get<HTMLElement>('location')
  const overviewButton = get<HTMLButtonElement>('overview')
  return {
    joystick: get('joystick'),
    joystickKnob: get('joystick-knob'),
    sprintButton: get('sprint'),
    overviewButton,
    resetButton: get('reset'),
    setLocation: (name) => { location.textContent = name },
    setOverview: (active) => { overviewButton.textContent = active ? 'Return to trail' : 'Overview' },
  }
}
