import { describe, expect, it, vi } from 'vitest'
import { keyboardAxes, keyboardSteeringActive, WorldInput } from '../src/world/input'
import { createExplorer, RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from '../src/world/movement'
import { explorerFacingFromCamera, steerExplorer, TURN_SPEED } from '../src/world/steering'
import { advanceExplorer, suspendInjectedMovement } from '../src/world/world-controls'

const DT = 0.1
const OPEN = { x: -70, z: -70 }

function at(facing = 0) {
  return { ...createExplorer(OPEN), facing }
}

describe('modal movement suspension', () => {
  it('clears injected diagnostics movement without resuming it after the modal closes', () => {
    const suspended = suspendInjectedMovement({ x: 1, z: -1, sprint: true }, true)

    expect(suspended).toEqual({ x: 0, z: 0, sprint: false })
    expect(suspendInjectedMovement(suspended, false)).toEqual({ x: 0, z: 0, sprint: false })
  })
})

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

  it('tracks mouse look, steering, and both-button forward across partial releases', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const canvas = Object.assign(new EventTarget(), {
      style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const control = Object.assign(new EventTarget(), {
        style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      })
      const input = new WorldInput(canvas as never, control as never, control as never, control as never, control as never)
      const pointer = (type: string, properties: Record<string, unknown>): Event => {
        const event = new Event(type, { cancelable: true })
        for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
        return event
      }
      canvas.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 10, clientY: 10 }))
      expect(input.read()).toMatchObject({ freeLook: true, mouseSteering: false, mouseForward: false })

      canvas.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 3, clientX: 10, clientY: 10 }))
      expect(input.read()).toMatchObject({ freeLook: false, mouseSteering: true, mouseSteeringPending: true, mouseForward: true })

      canvas.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 2, clientX: 20, clientY: 12 }))
      expect(input.read()).toMatchObject({ freeLook: false, mouseSteering: true, mouseSteeringPending: true, mouseForward: false, orbitX: 10 })
      canvas.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, buttons: 0, clientX: 20, clientY: 12 }))
      expect(input.read()).toMatchObject({ freeLook: false, mouseSteering: false, mouseForward: false })

      canvas.dispatchEvent(pointer('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 2, buttons: 2, clientX: 30, clientY: 15 }))
      canvas.dispatchEvent(pointer('pointermove', { pointerId: 2, pointerType: 'mouse', buttons: 3, clientX: 30, clientY: 15 }))
      expect(input.read()).toMatchObject({ freeLook: false, mouseSteering: true, mouseForward: true })
      canvas.dispatchEvent(pointer('pointermove', { pointerId: 2, pointerType: 'mouse', buttons: 1, clientX: 30, clientY: 15 }))
      expect(input.read()).toMatchObject({ freeLook: true, mouseSteering: false, mouseForward: false })
      canvas.dispatchEvent(pointer('pointerup', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 0, clientX: 30, clientY: 15 }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves a quick right-drag facing edge without latching forward', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const canvas = Object.assign(new EventTarget(), {
      style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const control = Object.assign(new EventTarget(), {
        style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      })
      const input = new WorldInput(canvas as never, control as never, control as never, control as never, control as never)
      const dispatch = (type: string, properties: Record<string, unknown>): Event => {
        const event = new Event(type, { cancelable: true })
        for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
        canvas.dispatchEvent(event)
        return event
      }
      dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, buttons: 2, clientX: 10, clientY: 10 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 2, clientX: 30, clientY: 15 })
      dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, buttons: 0, clientX: 30, clientY: 15 })
      expect(input.read()).toMatchObject({
        mouseSteering: false, mouseSteeringPending: true, mouseForward: false,
        mouseSteeringOrbitX: 20, orbitX: 20, orbitY: 5,
      })
      expect(input.read()).toMatchObject({ mouseSteeringPending: false, orbitX: 0, orbitY: 0 })

      const contextMenu = dispatch('contextmenu', {})
      expect(contextMenu.defaultPrevented).toBe(true)
      dispatch('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 1, buttons: 4, clientX: 0, clientY: 0 })
      dispatch('pointermove', { pointerId: 2, pointerType: 'mouse', buttons: 4, clientX: 20, clientY: 20 })
      expect(input.read()).toMatchObject({ orbitX: 0, orbitY: 0, mouseSteering: false, freeLook: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('clears canceled orbit and ignores stale pointer moves until a new canvas press', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const canvas = Object.assign(new EventTarget(), {
      style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const control = Object.assign(new EventTarget(), {
        style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      })
      const input = new WorldInput(canvas as never, control as never, control as never, control as never, control as never)
      const dispatch = (type: string, properties: Record<string, unknown>): void => {
        const event = new Event(type, { cancelable: true })
        for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
        canvas.dispatchEvent(event)
      }
      dispatch('pointerdown', { pointerId: 1, pointerType: 'pen', buttons: 1, clientX: 0, clientY: 0 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'pen', buttons: 1, clientX: 20, clientY: 10 })
      dispatch('pointercancel', { pointerId: 1, pointerType: 'pen', buttons: 0, clientX: 20, clientY: 10 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'pen', buttons: 1, clientX: 40, clientY: 30 })
      expect(input.read()).toMatchObject({ orbitX: 0, orbitY: 0, mouseSteeringPending: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each(['touch', 'pen'])('keeps %s orbit separate from mouse steering', (pointerType) => {
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
      const dispatch = (type: string, properties: Record<string, unknown>): void => {
        const event = new Event(type, { cancelable: true })
        for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
        element.dispatchEvent(event)
      }
      dispatch('pointerdown', { pointerId: 1, pointerType, buttons: 1, clientX: 0, clientY: 0 })
      dispatch('pointermove', { pointerId: 1, pointerType, buttons: 1, clientX: 15, clientY: 8 })
      expect(input.read()).toMatchObject({
        orbitX: 15, orbitY: 8, freeLook: false, mouseSteering: false,
        mouseSteeringPending: false, mouseForward: false,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('records the camera yaw at the last right-steering event before trailing free-look', () => {
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
      const dispatch = (type: string, properties: Record<string, unknown>): void => {
        const event = new Event(type, { cancelable: true })
        for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
        element.dispatchEvent(event)
      }
      dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 0, clientY: 0 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 10, clientY: 0 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 3, clientX: 10, clientY: 0 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 3, clientX: 20, clientY: 0 })
      dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 30, clientY: 0 })
      const result = input.read()
      expect(result).toMatchObject({
        orbitX: 30, mouseSteeringOrbitX: 20, mouseSteeringPending: true,
        freeLook: true, mouseSteering: false, mouseForward: false,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not reacquire a cleared movement key from an operating-system repeat', () => {
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
      const key = (type: string, code: string, repeat: boolean): void => {
        const event = new Event(type, { cancelable: true })
        Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } })
        browserWindow.dispatchEvent(event)
      }
      key('keydown', 'KeyW', false)
      expect(input.read().keyboardForward).toBe(1)
      input.clear()
      key('keydown', 'KeyW', true)
      expect(input.read().keyboardForward).toBe(0)
      key('keyup', 'KeyW', false)
      key('keydown', 'KeyW', false)
      expect(input.read().keyboardForward).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('releases active captures when gameplay input is cleared', () => {
    const browserWindow = new EventTarget()
    const browserDocument = new EventTarget()
    const released: string[] = []
    const element = (name: string) => Object.assign(new EventTarget(), {
      style: { transform: '' }, setPointerCapture: (_pointer: number) => {},
      hasPointerCapture: (_pointer: number) => true,
      releasePointerCapture: (pointer: number) => { released.push(`${name}:${pointer}`) },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    })
    const canvas = element('canvas')
    const joystick = element('joystick')
    const knob = element('knob')
    const sprint = element('sprint')
    const jump = element('jump')
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('document', browserDocument)
    try {
      const input = new WorldInput(canvas as never, joystick as never, knob as never, sprint as never, jump as never)
      const dispatch = (target: EventTarget, type: string, properties: Record<string, unknown>): void => {
        const event = new Event(type, { cancelable: true })
        for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
        target.dispatchEvent(event)
      }
      dispatch(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse', buttons: 2, clientX: 0, clientY: 0 })
      dispatch(joystick, 'pointerdown', { pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 75, clientY: 50 })
      dispatch(sprint, 'pointerdown', { pointerId: 3, pointerType: 'touch', buttons: 1, clientX: 0, clientY: 0 })
      input.clear()
      expect(released).toEqual(['canvas:1', 'joystick:2', 'sprint:3'])
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
    freeLook: false, mouseSteering: false, mouseSteeringPending: false, mouseForward: false, mouseSteeringOrbitX: 0,
    ...overrides,
  })
  const cameraForward = { x: 0, z: 1 }
  const intendedCameraFacing = Math.PI
  const injected = { x: 0, z: 0, sprint: false }

  it('passes stationary keyboard and mobile jump edges into physics', () => {
    const keyboard = advanceExplorer(at(), frame({ jump: true }), cameraForward, intendedCameraFacing, injected, DT)
    expect(keyboard.explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(keyboard.explorer.x).toBe(OPEN.x)
    expect(keyboard.explorer.z).toBe(OPEN.z)

    const mobile = advanceExplorer(at(), frame({ jump: true, touchForward: 0.01 }), cameraForward, intendedCameraFacing, injected, DT)
    expect(mobile.explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(mobile.explorer.z).toBeGreaterThan(OPEN.z)
  })

  it('keeps jump with keyboard movement and keyboard precedence over touch', () => {
    const movingJump = advanceExplorer(at(), frame({ keyboardForward: 1, jump: true }), cameraForward, intendedCameraFacing, injected, DT)
    expect(movingJump.explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(movingJump.explorer.z).toBeGreaterThan(OPEN.z)

    const turn = advanceExplorer(at(), frame({ keyboardTurn: 1, touchForward: 1 }), cameraForward, intendedCameraFacing, injected, DT)
    expect(turn.explorer.x).toBe(OPEN.x)
    expect(turn.explorer.z).toBe(OPEN.z)
    expect(turn.turnDelta).toBeCloseTo(TURN_SPEED * DT)
  })

  it('propagates default run, sprint, and optional walk through camera-relative movement', () => {
    const canceled = advanceExplorer(at(), frame({ keyboardForward: 0, touchForward: 1 }), cameraForward, intendedCameraFacing, injected, DT)
    expect(canceled.explorer.z - OPEN.z).toBeCloseTo(RUN_SPEED * DT)
    const shiftOnly = advanceExplorer(at(), frame({ sprint: true, touchForward: 1 }), cameraForward, intendedCameraFacing, injected, DT)
    expect(shiftOnly.explorer.z - OPEN.z).toBeCloseTo(SPRINT_SPEED * DT)
    const altOnly = advanceExplorer(at(), frame({ walk: true, touchForward: 1 }), cameraForward, intendedCameraFacing, injected, DT)
    expect(altOnly.explorer.z - OPEN.z).toBeCloseTo(WALK_SPEED * DT)
    const injectedWalk = advanceExplorer(at(), frame(), cameraForward, intendedCameraFacing, { ...injected, z: 1, walk: true }, DT)
    expect(injectedWalk.explorer.z - OPEN.z).toBeCloseTo(WALK_SPEED * DT)
    const sprintWins = advanceExplorer(at(), frame({ sprint: true, walk: true, touchForward: 1 }), cameraForward, intendedCameraFacing, injected, DT)
    expect(sprintWins.explorer.z - OPEN.z).toBeCloseTo(SPRINT_SPEED * DT)
  })

  it('uses intended camera facing for right-mouse steering without moving', () => {
    const controlled = advanceExplorer(at(0.4), frame({ mouseSteering: true }), cameraForward, intendedCameraFacing, injected, DT)
    expect(controlled.explorer.facing).toBeCloseTo(intendedCameraFacing)
    expect(controlled.explorer.x).toBe(OPEN.x)
    expect(controlled.explorer.z).toBe(OPEN.z)
    expect(controlled.turnDelta).toBe(0)
  })

  it('preserves a released right-drag facing edge for one frame', () => {
    const controlled = advanceExplorer(at(0.4), frame({ mouseSteeringPending: true }), cameraForward, 1.2, injected, DT)
    expect(controlled.explorer.facing).toBeCloseTo(1.2)
    expect(controlled.turnDelta).toBe(0)
  })

  it('applies a released right-drag facing edge before held keyboard movement', () => {
    const controlled = advanceExplorer(at(0.4), frame({ keyboardForward: 1, mouseSteeringPending: true }), cameraForward, 1.2, injected, DT)
    expect(controlled.explorer.facing).toBeCloseTo(1.2)
    expect(controlled.explorer.x).toBeGreaterThan(OPEN.x)
    expect(controlled.turnDelta).toBe(0)
  })

  it('turns A/D into strafe while right steering and lets mouse-forward win over S', () => {
    const left = advanceExplorer(at(), frame({ keyboardTurn: 1, mouseSteering: true }), cameraForward, 0, injected, DT)
    const right = advanceExplorer(at(), frame({ keyboardTurn: -1, mouseSteering: true }), cameraForward, 0, injected, DT)
    expect(left.explorer.x).toBeGreaterThan(OPEN.x)
    expect(right.explorer.x).toBeLessThan(OPEN.x)
    expect(left.explorer.facing).toBeCloseTo(0)
    expect(right.explorer.facing).toBeCloseTo(0)
    expect(left.turnDelta).toBe(0)

    const forward = advanceExplorer(at(), frame({ keyboardForward: -1, mouseSteering: true, mouseForward: true }), cameraForward, 0, injected, DT)
    expect(forward.explorer.z).toBeGreaterThan(OPEN.z)
    expect(forward.explorer.z - OPEN.z).toBeCloseTo(RUN_SPEED * DT)
  })

  it('keeps left free-look independent while keyboard turning still turns the character', () => {
    const controlled = advanceExplorer(at(), frame({ keyboardTurn: 1, freeLook: true }), cameraForward, intendedCameraFacing, injected, DT)
    expect(controlled.explorer.facing).toBeCloseTo(TURN_SPEED * DT)
    expect(controlled.turnDelta).toBe(0)
  })
})
