import { menuIcon } from './menu-icons'
import { createTargetFrame, HUD_CHAT_PLACEHOLDER, HUD_PLAYER_FRAME, HUD_TARGET_FRAME } from './hud-frames'

export interface WorldHud {
  readonly joystick: HTMLElement
  readonly joystickKnob: HTMLElement
  readonly sprintButton: HTMLButtonElement
  readonly jumpButton: HTMLButtonElement
  readonly overviewButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
  readonly developerTools: HTMLElement
  setLocation(name: string): void
  setOverview(active: boolean): void
  setTarget(target: { readonly name: string } | null): void
}

const MENUS = [
  ['character', 'Character', 'KeyC'], ['pack', 'Pack', 'KeyB'], ['map', 'Map', 'KeyM'],
  ['journal', 'Journal', 'KeyJ'], ['finder', 'Finder', 'KeyG'], ['social', 'Social', 'KeyO'],
  ['settings', 'Settings', 'KeyU'],
] as const

const KEYBOARD_BINDINGS = [
  ...Array.from({ length: 10 }, (_, index) => index === 9 ? '0' : String(index + 1)),
  ...Array.from({ length: 10 }, (_, index) => `Shift + ${index === 9 ? 0 : index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `Ctrl + ${index === 9 ? 0 : index + 1}`),
]
const XHB_BINDINGS = ['↑', '→', '↓', '←', 'Y', 'B', 'A', 'X']

export function createWorldHud(root: HTMLElement, start: { readonly locationLabel: string; readonly resetLabel: string }): WorldHud {
  root.innerHTML = `
    <main id="world-shell" class="world-hud" aria-label="Alderbank interface">
      ${HUD_TARGET_FRAME}
      <aside class="hud-right-rail">
        <section class="hud-minimap" aria-label="Map unavailable">
          <div class="hud-minimap-face"></div>
          <strong id="location"></strong><small>Alderbank</small>
        </section>
        <section id="quest-tracker" class="hud-quest-tracker" aria-label="Quest tracker"></section>
      </aside>
      <section id="quest-save-status" class="hud-save-status" role="status" hidden></section>
      ${HUD_CHAT_PLACEHOLDER}
      <section class="hud-action-layout" aria-label="Player status and actions">
        <section aria-label="Context action" class="hud-interact-wrap"><button id="quest-interact" type="button" hidden><kbd>F</kbd><span id="quest-interact-label">Talk</span></button></section>
        ${HUD_PLAYER_FRAME}
        <div id="keyboard-actions" class="hud-keyboard-actions" role="group" aria-label="Unavailable keyboard action slots">${KEYBOARD_BINDINGS.map((binding) => `<span><kbd>${binding}</kbd></span>`).join('')}</div>
        <div id="controller-actions" class="hud-controller-actions" role="group" aria-label="Unavailable controller action slots" hidden><div><b>LT</b>${XHB_BINDINGS.map((binding) => `<span><kbd>${binding}</kbd></span>`).join('')}</div><div><b>RT</b>${XHB_BINDINGS.map((binding) => `<span><kbd>${binding}</kbd></span>`).join('')}</div></div>
      </section>
      <nav class="hud-utility" aria-label="Game menus">
        ${MENUS.map(([id, label, shortcut]) => `<button type="button" data-game-menu="${id}" data-shortcut="${shortcut}" aria-label="${label}"><span class="hud-menu-icon">${menuIcon(id === 'pack' ? 'inventory' : id)}</span><span class="hud-menu-label">${label}</span></button>`).join('')}
      </nav>
      <section aria-label="Touch controls" class="touch-controls"><div id="joystick"><div id="joystick-knob"></div></div><div class="touch-buttons"><button id="jump">Jump</button><button id="sprint">Sprint</button></div></section>
      <aside id="developer-tools" class="hud-dev-tools"><details><summary>Development tools</summary><div id="developer-tools-body"><div class="hud-dev-actions"><button id="overview">Overview</button><button id="reset"></button></div></div></details></aside>
    </main>`
  const get = <T extends HTMLElement>(id: string): T => {
    const element = root.querySelector<HTMLElement>(`#${id}`)
    if (!element) throw new Error(`Missing world UI: ${id}`)
    return element as T
  }
  const location = get('location')
  const overviewButton = get<HTMLButtonElement>('overview')
  const resetButton = get<HTMLButtonElement>('reset')
  const setTarget = createTargetFrame(root)
  location.textContent = start.locationLabel
  resetButton.textContent = start.resetLabel
  if (!import.meta.env.DEV) get('developer-tools').hidden = true
  return {
    joystick: get('joystick'), joystickKnob: get('joystick-knob'), sprintButton: get('sprint'), jumpButton: get('jump'),
    overviewButton, resetButton, developerTools: get('developer-tools-body'),
    setLocation: (name) => { location.textContent = name },
    setOverview: (active) => { overviewButton.textContent = active ? 'Return to trail' : 'Overview' },
    setTarget,
  }
}
