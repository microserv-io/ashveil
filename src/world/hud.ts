import type { StarterGearSlotAppearance } from './starter-gear'
import {
  STARTER_GEAR_DYE_CHANNELS,
  STARTER_GEAR_SLOTS,
  type StarterGearDyeChannel,
  type StarterGearSlot,
} from './starter-gear-source'

export interface WorldHud {
  readonly joystick: HTMLElement
  readonly joystickKnob: HTMLElement
  readonly sprintButton: HTMLButtonElement
  readonly jumpButton: HTMLButtonElement
  readonly overviewButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
  readonly gearButton: HTMLButtonElement
  readonly gearSlotButtons: Readonly<Record<StarterGearSlot, HTMLButtonElement>>
  readonly gearDyeInputs: Readonly<Record<StarterGearSlot, Readonly<Record<StarterGearDyeChannel, HTMLInputElement>>>>
  readonly gearDyeClearButtons: Readonly<Record<StarterGearSlot, Readonly<Record<StarterGearDyeChannel, HTMLButtonElement>>>>
  setLocation(name: string): void
  setOverview(active: boolean): void
  setGearPanel(open: boolean): void
  setGearSlotAvailable(slot: StarterGearSlot, available: boolean): void
  setGearDyeAvailability(slot: StarterGearSlot, channels: ReadonlySet<StarterGearDyeChannel>): void
  setGearAppearance(slot: StarterGearSlot, appearance: StarterGearSlotAppearance): void
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
          <button id="gear" aria-expanded="false" aria-controls="gear-panel" class="rounded-lg border border-stone-200/15 bg-stone-950/70 px-3 py-2 text-xs font-medium backdrop-blur-md hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200">Gear</button>
          <button id="overview" class="rounded-lg border border-stone-200/15 bg-stone-950/70 px-3 py-2 text-xs font-medium backdrop-blur-md hover:bg-stone-800">Overview</button>
          <button id="reset" class="rounded-lg border border-stone-200/15 bg-stone-950/70 px-3 py-2 text-xs font-medium backdrop-blur-md hover:bg-stone-800">Return to refuge</button>
        </div>
      </section>
      <section id="gear-panel" aria-labelledby="gear-title" hidden class="pointer-events-auto fixed right-4 top-36 z-30 max-h-[calc(100vh-10rem)] w-72 overflow-y-auto rounded-xl border border-amber-100/15 bg-stone-950/85 p-3 shadow-2xl backdrop-blur-md min-[440px]:top-20 sm:right-6 sm:top-24">
        <h2 id="gear-title" class="px-2 pb-2 font-serif text-lg text-stone-50">Gear</h2>
        <div class="grid gap-2">
          ${STARTER_GEAR_SLOTS.map((slot) => `
            <section id="gear-${slot}-section" class="rounded-lg border border-stone-200/15 bg-stone-900/55 p-2">
              <button id="gear-${slot}" aria-label="Toggle ${slot}" aria-pressed="true" class="flex min-h-11 w-full items-center justify-between rounded-md border border-amber-200/30 bg-amber-100/10 px-3 py-2 text-left text-sm capitalize hover:bg-amber-100/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"><span>${slot}</span><span data-state>Equipped</span></button>
              <div class="mt-2 grid gap-2 px-1">
                ${STARTER_GEAR_DYE_CHANNELS.map((channel) => `
                  <div id="gear-${slot}-${channel}-row" class="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <label for="gear-${slot}-${channel}" class="text-xs capitalize text-stone-300">${channel}</label>
                    <input id="gear-${slot}-${channel}" type="color" value="#ffffff" aria-label="${slot} ${channel} dye" class="h-8 w-10 cursor-pointer rounded border border-stone-200/20 bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40">
                    <button id="gear-${slot}-${channel}-clear" type="button" aria-label="Restore ${slot} ${channel} dye default" disabled class="rounded border border-stone-200/15 px-2 py-1 text-[0.65rem] text-stone-300 hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40">Default</button>
                  </div>`).join('')}
              </div>
            </section>`).join('')}
        </div>
      </section>
      <div class="pointer-events-none fixed bottom-5 left-1/2 z-20 hidden -translate-x-1/2 rounded-full border border-stone-200/10 bg-stone-950/65 px-5 py-2 text-xs text-stone-300 backdrop-blur-md md:block">W/S run · A/D turn · Q/E strafe · Alt walk · Shift sprint · Space jump · Drag look · Scroll zoom</div>
      <section aria-label="Touch controls" class="touch-controls pointer-events-none fixed inset-x-0 bottom-5 z-30 flex items-end justify-between px-5">
        <div id="joystick" class="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-stone-100/20 bg-stone-950/35 backdrop-blur-sm">
          <div id="joystick-knob" class="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100/30 bg-amber-100/20"></div>
        </div>
        <div class="pointer-events-auto flex gap-3">
          <button id="jump" class="h-20 w-20 touch-none rounded-full border border-stone-100/20 bg-stone-950/45 text-xs font-semibold uppercase tracking-widest text-amber-100 backdrop-blur-sm">Jump</button>
          <button id="sprint" class="h-20 w-20 touch-none rounded-full border border-stone-100/20 bg-stone-950/45 text-xs font-semibold uppercase tracking-widest text-amber-100 backdrop-blur-sm">Sprint</button>
        </div>
      </section>
    </main>`
  const get = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Missing world UI: ${id}`)
    return element as T
  }
  const location = get<HTMLElement>('location')
  const overviewButton = get<HTMLButtonElement>('overview')
  const gearButton = get<HTMLButtonElement>('gear')
  const gearPanel = get<HTMLElement>('gear-panel')
  const gearSlotButtons = Object.fromEntries(STARTER_GEAR_SLOTS.map((slot) => [slot, get<HTMLButtonElement>(`gear-${slot}`)])) as Record<StarterGearSlot, HTMLButtonElement>
  const gearDyeInputs = gearControlRecord((slot, channel) => get<HTMLInputElement>(`gear-${slot}-${channel}`))
  const gearDyeClearButtons = gearControlRecord((slot, channel) => get<HTMLButtonElement>(`gear-${slot}-${channel}-clear`))
  return {
    joystick: get('joystick'),
    joystickKnob: get('joystick-knob'),
    sprintButton: get('sprint'),
    jumpButton: get('jump'),
    overviewButton,
    resetButton: get('reset'),
    gearButton,
    gearSlotButtons,
    gearDyeInputs,
    gearDyeClearButtons,
    setLocation: (name) => { location.textContent = name },
    setOverview: (active) => { overviewButton.textContent = active ? 'Return to trail' : 'Overview' },
    setGearPanel: (open) => {
      gearPanel.hidden = !open
      gearButton.setAttribute('aria-expanded', String(open))
    },
    setGearSlotAvailable: (slot, available) => {
      get<HTMLElement>(`gear-${slot}-section`).hidden = !available
    },
    setGearDyeAvailability: (slot, channels) => {
      for (const channel of STARTER_GEAR_DYE_CHANNELS) {
        const available = channels.has(channel)
        get<HTMLElement>(`gear-${slot}-${channel}-row`).hidden = !available
        gearDyeInputs[slot][channel].disabled = !available
      }
    },
    setGearAppearance: (slot, appearance) => {
      const button = gearSlotButtons[slot]
      button.setAttribute('aria-pressed', String(appearance.equipped))
      button.classList.toggle('border-amber-200/30', appearance.equipped)
      button.classList.toggle('bg-amber-100/10', appearance.equipped)
      button.classList.toggle('border-stone-200/15', !appearance.equipped)
      button.classList.toggle('bg-stone-900/70', !appearance.equipped)
      const state = button.querySelector<HTMLElement>('[data-state]')
      if (state) state.textContent = appearance.equipped ? 'Equipped' : 'Unequipped'
      for (const channel of STARTER_GEAR_DYE_CHANNELS) {
        const tint = channel === 'primary' ? appearance.primaryTint : appearance.trimTint
        gearDyeInputs[slot][channel].value = tint ?? '#ffffff'
        gearDyeClearButtons[slot][channel].disabled = tint === null || gearDyeInputs[slot][channel].disabled
      }
    },
  }
}

function gearControlRecord<T>(create: (slot: StarterGearSlot, channel: StarterGearDyeChannel) => T): Record<StarterGearSlot, Record<StarterGearDyeChannel, T>> {
  return Object.fromEntries(STARTER_GEAR_SLOTS.map((slot) => [
    slot,
    Object.fromEntries(STARTER_GEAR_DYE_CHANNELS.map((channel) => [channel, create(slot, channel)])),
  ])) as Record<StarterGearSlot, Record<StarterGearDyeChannel, T>>
}
