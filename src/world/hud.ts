import {
  GEAR_DYE_CHANNELS,
  GEAR_SET_IDS,
  VISUAL_GEAR_SLOTS,
  type GearDyeChannel,
  type GearSetId,
  type VisualGearSlot,
} from './gear-source'
import type { GearSlotDyes } from './gear'

const GEAR_SET_LABELS: Readonly<Record<GearSetId, string>> = {
  'starter-leather': 'Starter leather',
  'arcane-mage-tier': 'Arcane mage',
}

const GEAR_PRESET_LABELS: Readonly<Record<GearSetId, string>> = {
  'starter-leather': 'Full starter set',
  'arcane-mage-tier': 'Full mage set',
}

export interface WorldHud {
  readonly joystick: HTMLElement
  readonly joystickKnob: HTMLElement
  readonly sprintButton: HTMLButtonElement
  readonly jumpButton: HTMLButtonElement
  readonly overviewButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
  readonly gearButton: HTMLButtonElement
  readonly gearSetSelects: Readonly<Record<VisualGearSlot, HTMLSelectElement>>
  readonly gearPresetButtons: Readonly<Record<GearSetId, HTMLButtonElement>>
  readonly gearDyeInputs: Readonly<Record<VisualGearSlot, Readonly<Record<GearDyeChannel, HTMLInputElement>>>>
  readonly gearDyeClearButtons: Readonly<Record<VisualGearSlot, Readonly<Record<GearDyeChannel, HTMLButtonElement>>>>
  setLocation(name: string): void
  setOverview(active: boolean): void
  setGearPanel(open: boolean): void
  setGearSetAvailable(id: GearSetId, available: boolean): void
  setGearOptions(slot: VisualGearSlot, ids: readonly GearSetId[]): void
  setGearDyeAvailability(slot: VisualGearSlot, channels: ReadonlySet<GearDyeChannel>): void
  setGearAppearance(slot: VisualGearSlot, selected: GearSetId | null, dyes: GearSlotDyes): void
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
        <div class="mb-3 grid grid-cols-2 gap-2">
          ${GEAR_SET_IDS.map((id) => `<button id="gear-preset-${id}" type="button" class="rounded-md border border-amber-200/20 bg-amber-100/10 px-2 py-2 text-xs text-amber-50 hover:bg-amber-100/15">${GEAR_PRESET_LABELS[id]}</button>`).join('')}
        </div>
        <div class="grid gap-2">
          ${VISUAL_GEAR_SLOTS.map((slot) => `
            <section id="gear-${slot}-section" class="rounded-lg border border-stone-200/15 bg-stone-900/55 p-2">
              <label for="gear-${slot}" class="mb-1 block text-xs capitalize text-stone-300">${slot}</label>
              <select id="gear-${slot}" aria-label="${slot} appearance" class="min-h-11 w-full rounded-md border border-amber-200/30 bg-stone-900 px-3 py-2 text-sm text-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"><option value="">None</option></select>
              <div class="mt-2 grid gap-2 px-1">
                ${GEAR_DYE_CHANNELS.map((channel) => `
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
  const gearSetSelects = Object.fromEntries(VISUAL_GEAR_SLOTS.map((slot) => [slot, get<HTMLSelectElement>(`gear-${slot}`)])) as Record<VisualGearSlot, HTMLSelectElement>
  const gearPresetButtons = Object.fromEntries(GEAR_SET_IDS.map((id) => [id, get<HTMLButtonElement>(`gear-preset-${id}`)])) as Record<GearSetId, HTMLButtonElement>
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
    gearSetSelects,
    gearPresetButtons,
    gearDyeInputs,
    gearDyeClearButtons,
    setLocation: (name) => { location.textContent = name },
    setOverview: (active) => { overviewButton.textContent = active ? 'Return to trail' : 'Overview' },
    setGearPanel: (open) => {
      gearPanel.hidden = !open
      gearButton.setAttribute('aria-expanded', String(open))
    },
    setGearSetAvailable: (id, available) => {
      gearPresetButtons[id].disabled = !available
      gearPresetButtons[id].hidden = !available
    },
    setGearOptions: (slot, ids) => {
      const select = gearSetSelects[slot]
      select.replaceChildren(new Option('None', ''), ...ids.map((id) => new Option(GEAR_SET_LABELS[id], id)))
    },
    setGearDyeAvailability: (slot, channels) => {
      for (const channel of GEAR_DYE_CHANNELS) {
        const available = channels.has(channel)
        get<HTMLElement>(`gear-${slot}-${channel}-row`).hidden = !available
        gearDyeInputs[slot][channel].disabled = !available
      }
    },
    setGearAppearance: (slot, selected, dyes) => {
      gearSetSelects[slot].value = selected ?? ''
      for (const channel of GEAR_DYE_CHANNELS) {
        const tint = channel === 'primary' ? dyes.primaryTint : dyes.trimTint
        gearDyeInputs[slot][channel].value = tint ?? '#ffffff'
        gearDyeClearButtons[slot][channel].disabled = tint === null || gearDyeInputs[slot][channel].disabled
      }
    },
  }
}

function gearControlRecord<T>(create: (slot: VisualGearSlot, channel: GearDyeChannel) => T): Record<VisualGearSlot, Record<GearDyeChannel, T>> {
  return Object.fromEntries(VISUAL_GEAR_SLOTS.map((slot) => [
    slot,
    Object.fromEntries(GEAR_DYE_CHANNELS.map((channel) => [channel, create(slot, channel)])),
  ])) as Record<VisualGearSlot, Record<GearDyeChannel, T>>
}
