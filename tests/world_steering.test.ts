import { describe, expect, it, vi } from 'vitest'
import { keyboardAxes, keyboardSteeringActive, WorldInput } from '../src/world/input'
import { createExplorer, WALK_SPEED } from '../src/world/movement'
import { explorerFacingFromCamera, steerExplorer, TURN_SPEED } from '../src/world/steering'

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
      )
      const down = new Event('keydown')
      Object.defineProperty(down, 'code', { value: 'KeyW' })
      browserWindow.dispatchEvent(down)
      expect(input.read().keyboardForward).toBe(1)
      browserWindow.dispatchEvent(new Event('blur'))
      expect(input.read().keyboardForward).toBe(0)
      browserWindow.dispatchEvent(down)
      browserDocument.dispatchEvent(new Event('visibilitychange'))
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
    expect(Math.hypot(straight.x - OPEN.x, straight.z - OPEN.z)).toBeCloseTo(WALK_SPEED * DT)
    expect(Math.hypot(diagonal.x - OPEN.x, diagonal.z - OPEN.z)).toBeCloseTo(WALK_SPEED * DT)
  })
})
