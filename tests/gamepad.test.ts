import { afterEach, describe, expect, it } from 'vitest'
import { ActionState } from '../src/render/actions'
import { GamepadBackend } from '../src/render/gamepad'
import { DECK_PROFILE, glyphFor, profileFor } from '../src/render/profiles'

/**
 * Device handling without a device. These fakes are the shapes the Gamepad API
 * actually reports, so the profile logic is exercised for real — including the
 * case that matters most: a Deck binding must be inert on a pad that lacks it,
 * never a crash.
 */
function fakePad(id: string, buttonCount: number, axes: number[]): Gamepad {
  return {
    id,
    index: 0,
    connected: true,
    mapping: 'standard',
    axes,
    buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, touched: false, value: 0 })),
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad
}

function press(pad: Gamepad, index: number, value = 1): void {
  ;(pad.buttons as unknown as { pressed: boolean; touched: boolean; value: number }[])[index] = {
    pressed: true,
    touched: true,
    value,
  }
}

function setAxis(pad: Gamepad, index: number, value: number): void {
  ;(pad.axes as unknown as number[])[index] = value
}

/** navigator is getter-only on modern Node, so it has to be redefined. */
function install(pad: Gamepad | null): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => (pad ? [pad] : []) },
    configurable: true,
    writable: true,
  })
}

function read(pad: Gamepad, backend = new GamepadBackend()): { state: ActionState; backend: GamepadBackend } {
  install(pad)
  const state = new ActionState()
  // Twice: edge detection needs a previous frame to compare against.
  state.beginFrame()
  backend.update(state)
  state.beginFrame()
  backend.update(state)
  return { state, backend }
}

afterEach(() => {
  install(null)
})

const STANDARD = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'
const DECK = 'Valve Software Steam Deck Controller'

describe('profile selection', () => {
  it('uses the standard layout for an ordinary pad', () => {
    expect(profileFor(fakePad(STANDARD, 17, [0, 0, 0, 0])).id).toBe('standard')
  })

  it('recognises a PlayStation pad for its glyphs', () => {
    expect(profileFor(fakePad('Sony DualSense Wireless Controller (054c)', 17, [0, 0, 0, 0])).layout).toBe('playstation')
  })

  it('only takes the Deck profile when the device really reports extras', () => {
    // Through Steam Input a Deck presents as a plain 17-button pad, and must be
    // treated as one — the extras are not there to bind.
    expect(profileFor(fakePad(DECK, 17, [0, 0, 0, 0])).id).toBe('standard')
    expect(profileFor(fakePad(DECK, 23, new Array(8).fill(0))).id).toBe('deck-extended')
  })
})

describe('standard pad', () => {
  it('reads the left stick as movement', () => {
    const { state } = read(fakePad(STANDARD, 17, [1, 0, 0, 0]))
    expect(state.axis('move_x')).toBeCloseTo(1)
    expect(state.axis('move_y')).toBe(0)
  })

  it('ignores stick noise inside the deadzone', () => {
    const { state } = read(fakePad(STANDARD, 17, [0.1, 0.08, 0, 0]))
    expect(state.axis('move_x')).toBe(0)
    expect(state.axis('move_y')).toBe(0)
  })

  it('treats a resting analog trigger as unpressed', () => {
    const pad = fakePad(STANDARD, 17, [0, 0, 0, 0])
    press(pad, 7, 0.2)
    expect(read(pad).state.isHeld('attack_primary')).toBe(false)

    press(pad, 7, 0.9)
    expect(read(pad).state.isHeld('attack_primary')).toBe(true)
  })

  it('maps the face and shoulder buttons to actions', () => {
    const pad = fakePad(STANDARD, 17, [0, 0, 0, 0])
    press(pad, 5)
    press(pad, 4)
    press(pad, 0)
    const { state } = read(pad)
    expect(state.isHeld('attack_secondary')).toBe(true)
    expect(state.isHeld('skill_nova')).toBe(true)
    expect(state.isHeld('interact')).toBe(true)
  })
})

describe('steam deck extras', () => {
  it('binds the back grips to actions a standard pad has no room for', () => {
    const pad = fakePad(DECK, 23, new Array(8).fill(0))
    press(pad, 17) // L4
    press(pad, 19) // L5
    const { state } = read(pad)
    expect(state.isHeld('skill_dash')).toBe(true)
    expect(state.isHeld('loot_all')).toBe(true)
  })

  it('aims from the right trackpad when it is touched', () => {
    const pad = fakePad(DECK, 23, new Array(8).fill(0))
    setAxis(pad, 6, -0.9)
    setAxis(pad, 7, -0.9)
    press(pad, 22)
    const { state } = read(pad)
    expect(state.axis('aim_x')).toBeLessThan(0)
    expect(state.axis('aim_y')).toBeLessThan(0)
  })

  it('ignores an untouched trackpad, whose rest position is also its centre', () => {
    const pad = fakePad(DECK, 23, new Array(8).fill(0))
    setAxis(pad, 6, -0.9)
    setAxis(pad, 7, -0.9)
    const { state } = read(pad)
    expect(state.axis('aim_x')).toBe(0)
  })

  it('navigates panels from the left trackpad', () => {
    const pad = fakePad(DECK, 23, new Array(8).fill(0))
    setAxis(pad, 4, 0)
    setAxis(pad, 5, -0.9)
    press(pad, 21)
    expect(read(pad).state.isHeld('ui_up')).toBe(true)
  })

  it('leaves Deck-only bindings inert on a pad that lacks those controls', () => {
    const pad = fakePad(STANDARD, 17, [0, 0, 0, 0])
    const backend = new GamepadBackend()
    backend.profile = DECK_PROFILE
    // Every Deck index is past the end of this device; nothing should throw.
    expect(() => read(pad, backend)).not.toThrow()
    expect(read(pad, backend).state.isHeld('skill_dash')).toBe(false)
  })
})

describe('glyphs', () => {
  it('labels each layout in its own vocabulary', () => {
    expect(glyphFor(profileFor(fakePad(STANDARD, 17, [0, 0, 0, 0])), 'primary')).toBe('RT')
    expect(glyphFor(profileFor(fakePad('DualSense (054c)', 17, [0, 0, 0, 0])), 'primary')).toBe('R2')
    expect(glyphFor(DECK_PROFILE, 'dash')).toBe('L4')
  })
})

describe('no pad', () => {
  it('reports disconnected and writes nothing', () => {
    install(null)
    const backend = new GamepadBackend()
    const state = new ActionState()
    state.beginFrame()
    backend.update(state)
    expect(backend.connected).toBe(false)
    expect(state.anyInput).toBe(false)
  })
})
