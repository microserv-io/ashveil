import type { ActionState, DigitalAction } from './actions'

/** Held-key and mouse-button bindings. Several keys may drive one action. */
const KEY_BINDINGS: Partial<Record<DigitalAction, readonly string[]>> = {
  skill_nova: ['q'],
  skill_dash: [' ', 'shift'],
  interact: ['f'],
  loot_all: ['e'],
  panel_gear: ['tab', 'i'],
  panel_passives: ['p'],
  ui_cancel: ['escape'],
  ui_confirm: ['enter'],
  ui_up: ['arrowup'],
  ui_down: ['arrowdown'],
  ui_left: ['arrowleft'],
  ui_right: ['arrowright'],
  toggle_movement_mode: ['m'],
}

const MOUSE_BINDINGS: Partial<Record<DigitalAction, readonly number[]>> = {
  attack_primary: [0],
  attack_secondary: [2],
}

const MOVE_KEYS: readonly { keys: readonly string[]; x: number; y: number }[] = [
  { keys: ['w'], x: 0, y: -1 },
  { keys: ['s'], x: 0, y: 1 },
  { keys: ['a'], x: -1, y: 0 },
  { keys: ['d'], x: 1, y: 0 },
]

/**
 * Keys are held state, not events, so this composes with a pad in the same frame
 * instead of one clobbering the other.
 */
export class KeyboardMouseBackend {
  private readonly keys = new Set<string>()
  private readonly mouse = new Set<number>()
  private used = false

  constructor(element: HTMLElement) {
    element.addEventListener('contextmenu', (event) => event.preventDefault())
    element.addEventListener('pointerdown', (event) => {
      this.mouse.add(event.button)
      this.used = true
    })
    globalThis.addEventListener('pointerup', (event) => this.mouse.delete(event.button))
    element.addEventListener('pointerleave', () => this.mouse.clear())

    globalThis.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase()
      if (key === 'tab' || key === ' ') event.preventDefault()
      if (event.repeat) return
      this.keys.add(key)
      this.used = true
    })
    globalThis.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()))
    globalThis.addEventListener('blur', () => {
      this.keys.clear()
      this.mouse.clear()
    })
  }

  /** True when the player has touched a key or the mouse since the last check. */
  takeActivity(): boolean {
    const used = this.used
    this.used = false
    return used
  }

  update(state: ActionState): void {
    for (const [action, keys] of Object.entries(KEY_BINDINGS)) {
      if (keys.some((key) => this.keys.has(key))) state.press(action as DigitalAction)
    }
    for (const [action, buttons] of Object.entries(MOUSE_BINDINGS)) {
      if (buttons.some((button) => this.mouse.has(button))) state.press(action as DigitalAction)
    }

    let x = 0
    let y = 0
    for (const binding of MOVE_KEYS) {
      if (!binding.keys.some((key) => this.keys.has(key))) continue
      x += binding.x
      y += binding.y
    }
    const length = Math.hypot(x, y)
    if (length > 0) {
      state.setAxis('move_x', x / length)
      state.setAxis('move_y', y / length)
    }
  }

  get mouseHeld(): ReadonlySet<number> {
    return this.mouse
  }
}
