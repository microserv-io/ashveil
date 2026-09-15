import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovedCharacterTemplate } from '../src/world/approved-character'
import { neutralInputFrame, WorldInput } from '../src/world/input'
import { QuestNpcView } from '../src/world/quest-npcs'
import { OPENING_QUESTS } from '../src/quests'
import { formatDialogueText } from '../src/world/quest-hud'

class FakeElement extends EventTarget {
  readonly style = { transform: '' }
  setPointerCapture(_id: number): void {}
  getBoundingClientRect(): DOMRect { return { left: 0, top: 0, width: 100, height: 100 } as DOMRect }
}

function event(type: string, properties: Record<string, unknown> = {}): Event {
  const result = new Event(type, { cancelable: true })
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(result, key, { value })
  return result
}

afterEach(() => vi.unstubAllGlobals())

describe('quest modal input ownership', () => {
  it('returns a fully neutral gameplay frame', () => {
    expect(neutralInputFrame()).toEqual({
      keyboardForward: 0,
      keyboardStrafe: 0,
      keyboardTurn: 0,
      touchForward: 0,
      touchRight: 0,
      sprint: false,
      walk: false,
      jump: false,
      orbitX: 0,
      orbitY: 0,
      zoom: 0,
      freeLook: false,
      mouseSteering: false,
      mouseSteeringPending: false,
      mouseForward: false,
      mouseSteeringOrbitX: 0,
    })
  })

  it('clears held controls and ignores every gameplay source while disabled', () => {
    const world = new EventTarget()
    const documentTarget = new EventTarget()
    vi.stubGlobal('window', world)
    vi.stubGlobal('document', documentTarget)
    const canvas = new FakeElement()
    const joystick = new FakeElement()
    const knob = new FakeElement()
    const sprint = new FakeElement()
    const jump = new FakeElement()
    const input = new WorldInput(
      canvas as unknown as HTMLCanvasElement,
      joystick as unknown as HTMLElement,
      knob as unknown as HTMLElement,
      sprint as unknown as HTMLButtonElement,
      jump as unknown as HTMLButtonElement,
    )

    world.dispatchEvent(event('keydown', { code: 'KeyW', repeat: false }))
    canvas.dispatchEvent(event('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }))
    canvas.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 30, clientY: 20 }))
    canvas.dispatchEvent(event('wheel', { deltaY: 10 }))
    joystick.dispatchEvent(event('pointerdown', { pointerId: 2, clientX: 85, clientY: 50 }))
    sprint.dispatchEvent(event('pointerdown', { pointerId: 3 }))
    jump.dispatchEvent(event('pointerdown', { pointerId: 4 }))
    const active = input.read()
    expect(active.keyboardForward).toBe(1)
    expect(active.orbitX).not.toBe(0)
    expect(active.zoom).not.toBe(0)
    expect(active.touchRight).not.toBe(0)
    expect(active.sprint).toBe(true)
    expect(active.jump).toBe(true)

    input.setEnabled(false)
    world.dispatchEvent(event('keydown', { code: 'KeyW', repeat: false }))
    canvas.dispatchEvent(event('pointerdown', { pointerId: 5, clientX: 0, clientY: 0 }))
    canvas.dispatchEvent(event('wheel', { deltaY: 20 }))
    joystick.dispatchEvent(event('pointerdown', { pointerId: 6, clientX: 90, clientY: 50 }))
    sprint.dispatchEvent(event('pointerdown', { pointerId: 7 }))
    jump.dispatchEvent(event('pointerdown', { pointerId: 8 }))
    expect(input.read()).toEqual(neutralInputFrame())

    input.setEnabled(true)
    expect(input.read()).toEqual(neutralInputFrame())
    world.dispatchEvent(event('keydown', { code: 'KeyW', repeat: false }))
    expect(input.read().keyboardForward).toBe(1)
  })

  it('rejects duplicate NPC placements before allocating character clones', () => {
    const duplicate = {
      id: 'npc_mara', name: 'Mara', label: 'Mara', x: -41, z: 22, facing: 0,
      castsShadow: false, interactionRadius: 3, kind: 'npc' as const,
    }
    expect(() => new QuestNpcView(new THREE.Scene(), {} as ApprovedCharacterTemplate, [duplicate, duplicate]))
      .toThrow(/duplicate quest NPC placement: npc_mara/)
  })

  it('resolves every player display-name token before dialogue reaches the screen', () => {
    const rendered = OPENING_QUESTS.filter((quest) => quest.status === 'playable')
      .flatMap((quest) => quest.scenes.flatMap((scene) => scene.lines.map((line) => formatDialogueText(line.text))))
    expect(rendered.some((line) => line.includes('{player}'))).toBe(false)
    expect(formatDialogueText('Thank you, `{player}`.')).toBe('Thank you, Ashbearer.')
  })
})

describe('focused HUD button input', () => {
  function hudInput(): { input: WorldInput; source: EventTarget } {
    const source = new EventTarget()
    const surface = new FakeElement()
    vi.stubGlobal('window', source)
    vi.stubGlobal('document', new EventTarget())
    const input = new WorldInput(
      surface as unknown as HTMLCanvasElement,
      surface as unknown as HTMLElement,
      surface as unknown as HTMLElement,
      surface as unknown as HTMLButtonElement,
      surface as unknown as HTMLButtonElement,
    )
    return { input, source }
  }

  const buttonTarget = { closest: (selector: string) => (selector.includes('button') ? buttonTarget : null) }
  const inputTarget = { closest: (selector: string) => (selector.includes('input') ? inputTarget : null) }

  it('accepts movement keys while a HUD button keeps focus', () => {
    const { input, source } = hudInput()
    source.dispatchEvent(event('keydown', { code: 'KeyW', repeat: false, target: buttonTarget }))
    expect(input.read().keyboardForward).toBe(1)
  })

  it('yields Space to a focused button instead of triggering jump', () => {
    const { input, source } = hudInput()
    const space = event('keydown', { code: 'Space', repeat: false, target: buttonTarget })
    source.dispatchEvent(space)
    expect(input.read().jump).toBe(false)
    expect(space.defaultPrevented).toBe(false)
  })

  it('still blocks gameplay keys for normal editable fields', () => {
    const { input, source } = hudInput()
    const key = event('keydown', { code: 'KeyW', repeat: false, target: inputTarget })
    source.dispatchEvent(key)
    expect(input.read().keyboardForward).toBe(0)
    expect(key.defaultPrevented).toBe(false)
  })
})
