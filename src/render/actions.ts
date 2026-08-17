/**
 * Gameplay asks for actions, never for buttons. Every input backend — a standard
 * pad, a Deck with its extra controls, mouse and keyboard, and one day Steam
 * Input — fills in the same action set, so adding a device never touches the game.
 */
export const DIGITAL_ACTIONS = [
  'attack_primary',
  'attack_secondary',
  'skill_nova',
  'skill_dash',
  'interact',
  'loot_all',
  'panel_gear',
  'panel_passives',
  'ui_confirm',
  'ui_cancel',
  'ui_up',
  'ui_down',
  'ui_left',
  'ui_right',
  'toggle_movement_mode',
] as const

export type DigitalAction = (typeof DIGITAL_ACTIONS)[number]

export const ANALOG_ACTIONS = ['move_x', 'move_y', 'aim_x', 'aim_y'] as const
export type AnalogAction = (typeof ANALOG_ACTIONS)[number]

export interface Vector2 {
  x: number
  y: number
}

/**
 * One frame of input, device-agnostic. Backends write it, `Controls` reads it.
 * Multiple backends can write the same frame, so a pad and a keyboard compose
 * rather than fight — useful on a Deck in desktop mode with a keyboard attached.
 */
export class ActionState {
  private held = new Set<DigitalAction>()
  private previous = new Set<DigitalAction>()
  private readonly analog = new Map<AnalogAction, number>()

  beginFrame(): void {
    this.previous = this.held
    this.held = new Set()
    this.analog.clear()
  }

  press(action: DigitalAction): void {
    this.held.add(action)
  }

  /** Largest magnitude wins, so a stick and a trackpad can feed the same axis. */
  setAxis(action: AnalogAction, value: number): void {
    const existing = this.analog.get(action) ?? 0
    if (Math.abs(value) > Math.abs(existing)) this.analog.set(action, value)
  }

  isHeld(action: DigitalAction): boolean {
    return this.held.has(action)
  }

  justPressed(action: DigitalAction): boolean {
    return this.held.has(action) && !this.previous.has(action)
  }

  axis(action: AnalogAction): number {
    return this.analog.get(action) ?? 0
  }

  vector(x: AnalogAction, y: AnalogAction): Vector2 {
    return { x: this.axis(x), y: this.axis(y) }
  }

  get anyInput(): boolean {
    if (this.held.size > 0) return true
    for (const value of this.analog.values()) {
      if (value !== 0) return true
    }
    return false
  }
}
