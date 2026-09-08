import { describe, expect, it, vi } from 'vitest'
import { keyboardAxes, keyboardSteeringActive, WorldInput } from '../src/world/input'
import { createExplorer, RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from '../src/world/movement'
import { explorerFacingFromCamera, steerExplorer, TURN_SPEED } from '../src/world/steering'
import { advanceExplorer } from '../src/world/world-controls'

const DT = 0.1
const OPEN = { x: -70, z: -70 }

function at(facing = 0) {
  return { ...createExplorer(OPEN), facing }
}

describe('first-zone keyboard axes', () => {
  it('maps forward, strafe and positive-left turn independently', () => {
    expect(keyboardAxes(new Set(['KeyW', 'KeyQ', 'KeyA']))).toEqual({ forward: 1, strafe: -1, turn: 1 })
    expect(keyboardAxes(new Set(['ArrowDown', 'KeyE', 'ArrowRight']))).toEqual({ forward: -1, strafe: 1, turn: -1 })
  })

  it('lets opposing keys cancel to zero', () => {
    expect(keyboardAxes(new Set(['KeyW', 'KeyS', 'KeyQ', 'KeyE', 'KeyA', 'KeyD']))).toEqual({ forward: 0, strafe: 0, turn: 0 })
  })

  it('claims mixed-input precedence only for a nonzero steering axis', () => {
    expect(keyboardSteeringActive({ keyboardForward: 0, keyboardStrafe: 0, keyboardTurn: 1 })).toBe(true)
    expect(keyboardSteeringActive({ keyboardForward: 1, keyboardStrafe: 0, keyboardTurn: 0 })).toBe(true)
    expect(keyboardSteeringActive({ keyboardForward: 0, keyboardStrafe: 0, keyboardTurn: 0 })).toBe(false)
  })

  it('clears held keyboard input on blur and visibility change', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const element = Object.assign(new EventTarget(), {
      style: { transform: '' },
      setPointerCapture: (_pointer: number) => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const input = new WorldInput(
        element as unknown as HTMLCanvasElement,
        element as unknown as HTMLElement,
        element as unknown as HTMLElement,
        element as unknown as HTMLButtonElement,
        element as unknown as HTMLButtonElement,
      )
      const press = (code: string): void => {
        const event = new Event('keydown')
        Object.defineProperty(event, 'code', { value: code })
        browserWindow.dispatchEvent(event)
      }
      press('KeyW')
      press('ShiftLeft')
      press('AltLeft')
      expect(input.read()).toMatchObject({ keyboardForward: 1, sprint: true, walk: true })
      browserWindow.dispatchEvent(new Event('blur'))
      expect(input.read()).toMatchObject({ keyboardForward: 0, sprint: false, walk: false })
      press('KeyW')
      press('AltRight')
      browserDocument.dispatchEvent(new Event('visibilitychange'))
      expect(input.read()).toMatchObject({ keyboardForward: 0, walk: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('emits jump once, ignores repeats, and clears queued jump input', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const element = Object.assign(new EventTarget(), {
      style: { transform: '' },
      setPointerCapture: (_pointer: number) => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const input = new WorldInput(
        element as unknown as HTMLCanvasElement,
        element as unknown as HTMLElement,
        element as unknown as HTMLElement,
        element as unknown as HTMLButtonElement,
        element as unknown as HTMLButtonElement,
      )
      const jump = new Event('keydown', { cancelable: true })
      Object.defineProperties(jump, { code: { value: 'Space' }, repeat: { value: false } })
      browserWindow.dispatchEvent(jump)
      expect(jump.defaultPrevented).toBe(true)
      expect(input.read().jump).toBe(true)
      expect(input.read().jump).toBe(false)

      const touchJump = new Event('pointerdown', { cancelable: true })
      element.dispatchEvent(touchJump)
      expect(touchJump.defaultPrevented).toBe(true)
      expect(input.read().jump).toBe(true)
      expect(input.read().jump).toBe(false)

      const repeated = new Event('keydown', { cancelable: true })
      Object.defineProperties(repeated, { code: { value: 'Space' }, repeat: { value: true } })
      browserWindow.dispatchEvent(repeated)
      expect(input.read().jump).toBe(false)

      browserWindow.dispatchEvent(jump)
      browserWindow.dispatchEvent(new Event('blur'))
      expect(input.read().jump).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not claim gameplay shortcuts from editable controls', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const element = Object.assign(new EventTarget(), {
      style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const input = new WorldInput(element as never, element as never, element as never, element as never, element as never)
      const field = { matches: (selector: string) => selector.includes('input'), closest: () => field }
      const event = new Event('keydown', { cancelable: true })
      Object.defineProperties(event, { code: { value: 'KeyW' }, repeat: { value: false }, target: { value: field } })
      browserWindow.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(input.read().keyboardForward).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('first-zone keyboard steering', () => {
  it('starts facing away from the camera', () => {
    const cameraYaw = 0.45
    expect(Math.abs(explorerFacingFromCamera(cameraYaw) - cameraYaw)).toBeCloseTo(Math.PI)
  })

  it('uses the body heading for forward and the requested Q/E strafe signs', () => {
    const forward = steerExplorer(at(0), { forward: 1, strafe: 0, turn: 0, sprint: false }, DT).explorer
    const q = steerExplorer(at(0), { forward: 0, strafe: -1, turn: 0, sprint: false }, DT).explorer
    const e = steerExplorer(at(0), { forward: 0, strafe: 1, turn: 0, sprint: false }, DT).explorer
    expect(forward.z).toBeGreaterThan(OPEN.z)
    expect(forward.x).toBeCloseTo(OPEN.x)
    expect(q.x).toBeGreaterThan(OPEN.x)
    expect(e.x).toBeLessThan(OPEN.x)

    const east = steerExplorer(at(Math.PI / 2), { forward: 1, strafe: 0, turn: 0, sprint: false }, DT).explorer
    expect(east.x).toBeGreaterThan(OPEN.x)
    expect(east.z).toBeCloseTo(OPEN.z)
  })

  it('turns in place at 120 degrees per second and clamps a stalled frame', () => {
    const turned = steerExplorer(at(), { forward: 0, strafe: 0, turn: 1, sprint: false }, 2)
    expect(turned.explorer.x).toBe(OPEN.x)
    expect(turned.explorer.z).toBe(OPEN.z)
    expect(turned.explorer.facing).toBeCloseTo(TURN_SPEED * DT)
    expect(turned.turnDelta).toBeCloseTo(12 * Math.PI / 180)
  })

  it('preserves heading while backing, strafing, moving diagonally and when blocked', () => {
    const facing = 0.7
    const backward = steerExplorer(at(facing), { forward: -1, strafe: 0, turn: 0, sprint: false }, DT).explorer
    const strafe = steerExplorer(at(facing), { forward: 0, strafe: 1, turn: 0, sprint: false }, DT).explorer
    const diagonal = steerExplorer(at(facing), { forward: 1, strafe: 1, turn: 0, sprint: false }, DT).explorer
    const blocked = steerExplorer(at(facing), { forward: 1, strafe: 0, turn: 0, sprint: false }, DT, [
      { id: 'block', x: OPEN.x + Math.sin(facing), z: OPEN.z + Math.cos(facing), radius: 1 },
    ]).explorer
    for (const explorer of [backward, strafe, diagonal, blocked]) expect(explorer.facing).toBeCloseTo(facing)
    expect(blocked.x).toBe(OPEN.x)
    expect(blocked.z).toBe(OPEN.z)
  })

  it('leaves diagonal movement normalized by the existing controller', () => {
    const straight = steerExplorer(at(), { forward: 1, strafe: 0, turn: 0, sprint: false }, DT).explorer
    const diagonal = steerExplorer(at(), { forward: 1, strafe: 1, turn: 0, sprint: false }, DT).explorer
    const walked = steerExplorer(at(), { forward: 1, strafe: 0, turn: 0, sprint: false, walk: true }, DT).explorer
    const sprinted = steerExplorer(at(), { forward: 1, strafe: 0, turn: 0, sprint: true }, DT).explorer
    expect(Math.hypot(straight.x - OPEN.x, straight.z - OPEN.z)).toBeCloseTo(RUN_SPEED * DT)
    expect(Math.hypot(diagonal.x - OPEN.x, diagonal.z - OPEN.z)).toBeCloseTo(RUN_SPEED * DT)
    expect(walked.z - OPEN.z).toBeCloseTo(WALK_SPEED * DT)
    expect(sprinted.z - OPEN.z).toBeCloseTo(SPRINT_SPEED * DT)
  })
})

describe('first-zone control precedence', () => {
  const frame = (overrides: Partial<ReturnType<WorldInput['read']>> = {}): ReturnType<WorldInput['read']> => ({
    keyboardForward: 0, keyboardStrafe: 0, keyboardTurn: 0,
    touchForward: 0, touchRight: 0, sprint: false, jump: false,
    orbitX: 0, orbitY: 0, zoom: 0,
    ...overrides,
  })
  const cameraForward = { x: 0, z: 1 }
  const injected = { x: 0, z: 0, sprint: false }

  it('passes stationary keyboard and mobile jump edges into physics', () => {
    const keyboard = advanceExplorer(at(), frame({ jump: true }), cameraForward, injected, DT)
    expect(keyboard.explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(keyboard.explorer.x).toBe(OPEN.x)
    expect(keyboard.explorer.z).toBe(OPEN.z)

    const mobile = advanceExplorer(at(), frame({ jump: true, touchForward: 0.01 }), cameraForward, injected, DT)
    expect(mobile.explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(mobile.explorer.z).toBeGreaterThan(OPEN.z)
  })

  it('keeps jump with keyboard movement and keyboard precedence over touch', () => {
    const movingJump = advanceExplorer(at(), frame({ keyboardForward: 1, jump: true }), cameraForward, injected, DT)
    expect(movingJump.explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(movingJump.explorer.z).toBeGreaterThan(OPEN.z)

    const turn = advanceExplorer(at(), frame({ keyboardTurn: 1, touchForward: 1 }), cameraForward, injected, DT)
    expect(turn.explorer.x).toBe(OPEN.x)
    expect(turn.explorer.z).toBe(OPEN.z)
    expect(turn.turnDelta).toBeCloseTo(TURN_SPEED * DT)
  })

  it('propagates default run, sprint, and optional walk through camera-relative movement', () => {
    const canceled = advanceExplorer(at(), frame({ keyboardForward: 0, touchForward: 1 }), cameraForward, injected, DT)
    expect(canceled.explorer.z - OPEN.z).toBeCloseTo(RUN_SPEED * DT)
    const shiftOnly = advanceExplorer(at(), frame({ sprint: true, touchForward: 1 }), cameraForward, injected, DT)
    expect(shiftOnly.explorer.z - OPEN.z).toBeCloseTo(SPRINT_SPEED * DT)
    const altOnly = advanceExplorer(at(), frame({ walk: true, touchForward: 1 }), cameraForward, injected, DT)
    expect(altOnly.explorer.z - OPEN.z).toBeCloseTo(WALK_SPEED * DT)
    const injectedWalk = advanceExplorer(at(), frame(), cameraForward, { ...injected, z: 1, walk: true }, DT)
    expect(injectedWalk.explorer.z - OPEN.z).toBeCloseTo(WALK_SPEED * DT)
    const sprintWins = advanceExplorer(at(), frame({ sprint: true, walk: true, touchForward: 1 }), cameraForward, injected, DT)
    expect(sprintWins.explorer.z - OPEN.z).toBeCloseTo(SPRINT_SPEED * DT)
  })
})
