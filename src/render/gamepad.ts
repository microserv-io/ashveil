import { applyDeadzone } from '../sim/targeting'
import type { ActionState, DigitalAction } from './actions'
import { DIGITAL_ACTIONS } from './actions'
import { STANDARD_PROFILE, profileFor, type PadProfile } from './profiles'

const STICK_DEADZONE = 0.22
const TRIGGER_THRESHOLD = 0.45
const TOUCHPAD_DEADZONE = 0.18
const NAVIGATE_THRESHOLD = 0.55

/**
 * Reads whatever pad is present and writes actions through its profile. Nothing
 * downstream knows which device it was, which is what lets a Deck's back grips
 * and a plain Xbox pad drive the same game.
 */
export class GamepadBackend {
  profile: PadProfile = STANDARD_PROFILE
  connected = false

  private index: number | null = null

  update(state: ActionState): void {
    const pad = this.pick()
    this.connected = pad !== null
    if (!pad) return

    this.profile = profileFor(pad)

    for (const action of DIGITAL_ACTIONS) {
      if (this.isActionDown(pad, action)) state.press(action)
    }

    const move = applyDeadzone(readAxes(pad, this.profile.moveAxes), STICK_DEADZONE)
    state.setAxis('move_x', move.x)
    state.setAxis('move_y', move.y)

    const aim = applyDeadzone(readAxes(pad, this.profile.aimAxes), STICK_DEADZONE)
    state.setAxis('aim_x', aim.x)
    state.setAxis('aim_y', aim.y)

    this.readTouchpads(pad, state)
  }

  private isActionDown(pad: Gamepad, action: DigitalAction): boolean {
    const sources = this.profile.buttons[action]
    if (!sources) return false
    for (const index of sources) {
      const button = pad.buttons[index]
      // A binding past the end of this device is inert, not an error: it is how a
      // Deck profile degrades to the standard layout on an ordinary pad.
      if (!button) continue
      const down = index === 6 || index === 7 ? button.value > TRIGGER_THRESHOLD : button.pressed
      if (down) return true
    }
    return false
  }

  private readTouchpads(pad: Gamepad, state: ActionState): void {
    for (const touchpad of this.profile.touchpads ?? []) {
      const touched = pad.buttons[touchpad.touchButton]?.pressed ?? false
      if (!touched) continue

      const reading = applyDeadzone(readAxes(pad, touchpad.axes), TOUCHPAD_DEADZONE)
      if (touchpad.role === 'aim') {
        // An absolute pad position reads as a direction from centre, which is
        // close to how a mouse feels and far better than a stick for precision.
        state.setAxis('aim_x', reading.x)
        state.setAxis('aim_y', reading.y)
        continue
      }

      if (reading.y <= -NAVIGATE_THRESHOLD) state.press('ui_up')
      if (reading.y >= NAVIGATE_THRESHOLD) state.press('ui_down')
      if (reading.x <= -NAVIGATE_THRESHOLD) state.press('ui_left')
      if (reading.x >= NAVIGATE_THRESHOLD) state.press('ui_right')
    }
  }

  private pick(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? []
    const remembered = this.index === null ? null : pads[this.index]
    if (remembered?.connected) return remembered

    for (const pad of pads) {
      if (!pad?.connected) continue
      this.index = pad.index
      return pad
    }
    this.index = null
    return null
  }

  /** Short, quiet pulses only — continuous rumble in an ARPG is unbearable. */
  rumble(strong: number, weak: number, durationMs: number): void {
    if (this.index === null) return
    const actuator = (navigator.getGamepads?.() ?? [])[this.index]?.vibrationActuator
    if (!actuator) return
    void actuator
      .playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: Math.min(1, strong),
        weakMagnitude: Math.min(1, weak),
      })
      .catch(() => {
        /* a pad without haptics is not an error */
      })
  }
}

function readAxes(pad: Gamepad, axes: readonly [number, number]): { x: number; y: number } {
  return { x: pad.axes[axes[0]] ?? 0, y: pad.axes[axes[1]] ?? 0 }
}
