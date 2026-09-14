import { describe, expect, it, vi } from 'vitest'
import { NpcTargetController } from '../src/world/npc-target-controller'
import type { PickedNpc } from '../src/world/npc-picker'

function pointer(type: string, overrides: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: type === 'pointerup' ? 0 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: 20, clientY: 30 }, overrides)
  return event
}

function key(code: string, repeat = false): Event {
  const event = new Event('keydown', { cancelable: true })
  Object.assign(event, { code, repeat })
  return event
}

function setup(eventSource = new EventTarget(), externalModal?: () => boolean) {
  const canvas = new EventTarget()
  const show = vi.fn()
  const pick = vi.fn((_clientX: number, _clientY: number): PickedNpc | null => ({ id: 'npc_mara', name: 'Mara' }))
  const clearListeners = new Set<() => void>()
  let enabled = true
  let modal = false
  const controller = new NpcTargetController({
    canvas: canvas as HTMLCanvasElement,
    eventSource: eventSource as Window,
    activeElement: () => null,
    inputEnabled: () => enabled,
    modalOpen: externalModal ?? (() => modal),
    onInputClear: (listener) => {
      clearListeners.add(listener)
      return () => { clearListeners.delete(listener) }
    },
    pick,
    show,
  })
  return {
    canvas, eventSource, show, pick, controller,
    clearInput: () => { for (const listener of clearListeners) listener() },
    clearListeners,
    setEnabled: (value: boolean) => { enabled = value },
    setModal: (value: boolean) => { modal = value },
  }
}

describe('NPC target controller', () => {
  it('selects an NPC through the installed canvas listeners and clears on an empty click', () => {
    const target = setup()
    target.canvas.dispatchEvent(pointer('pointerdown'))
    target.canvas.dispatchEvent(pointer('pointerup'))
    expect(target.show).toHaveBeenLastCalledWith({ id: 'npc_mara', name: 'Mara' })

    target.pick.mockReturnValueOnce(null)
    target.canvas.dispatchEvent(pointer('pointerdown'))
    target.canvas.dispatchEvent(pointer('pointerup'))
    expect(target.show).toHaveBeenLastCalledWith(null)
  })

  it('retains selection when the modal Escape was already handled', () => {
    const source = new EventTarget()
    let modal = true
    source.addEventListener('keydown', (event) => {
      if (!modal) return
      event.preventDefault()
      modal = false
    })
    const target = setup(source, () => modal)

    source.dispatchEvent(key('Escape'))

    expect(target.show).not.toHaveBeenCalled()
  })

  it('clears selection with an unhandled Escape and ignores repeats', () => {
    const target = setup()
    target.eventSource.dispatchEvent(key('Escape', true))
    expect(target.show).not.toHaveBeenCalled()

    target.eventSource.dispatchEvent(key('Escape'))
    expect(target.show).toHaveBeenLastCalledWith(null)
  })

  it('clears selection when a menu button still owns focus', () => {
    class FakeElement {
      closest(selector: string): FakeElement | null { return selector.includes('button') ? this : null }
    }
    vi.stubGlobal('Element', FakeElement)
    const button = new FakeElement() as unknown as Element
    const source = new EventTarget()
    const target = setup(source)
    target.controller.dispose()
    const replacement = new NpcTargetController({
      canvas: target.canvas as HTMLCanvasElement,
      eventSource: source as Window,
      activeElement: () => button,
      inputEnabled: () => true,
      modalOpen: () => false,
      onInputClear: () => () => {},
      pick: target.pick,
      show: target.show,
    })

    source.dispatchEvent(key('Escape'))
    replacement.dispose()
    vi.unstubAllGlobals()

    expect(target.show).toHaveBeenLastCalledWith(null)
  })

  it('cancels an active gesture when input is cleared or disabled', () => {
    const target = setup()
    target.canvas.dispatchEvent(pointer('pointerdown'))
    target.clearInput()
    target.canvas.dispatchEvent(pointer('pointerup'))
    expect(target.show).not.toHaveBeenCalled()

    target.canvas.dispatchEvent(pointer('pointerdown'))
    target.setEnabled(false)
    target.canvas.dispatchEvent(pointer('pointerup'))
    expect(target.show).not.toHaveBeenCalled()
  })

  it('keeps the controller receiver when the canvas cancels pointer capture', () => {
    const target = setup()
    target.canvas.dispatchEvent(pointer('pointerdown'))

    expect(() => target.canvas.dispatchEvent(pointer('pointercancel'))).not.toThrow()
    target.canvas.dispatchEvent(pointer('pointerup'))
    expect(target.show).not.toHaveBeenCalled()
  })

  it('rejects a fast drag recorded only in coalesced pointer samples', () => {
    const target = setup()
    target.canvas.dispatchEvent(pointer('pointerdown'))
    const move = pointer('pointermove', { clientX: 21 })
    Object.assign(move, { getCoalescedEvents: () => [pointer('pointermove', { clientX: 40 })] })
    target.canvas.dispatchEvent(move)
    target.canvas.dispatchEvent(pointer('pointerup'))

    expect(target.show).not.toHaveBeenCalled()
  })

  it('removes its listeners on dispose', () => {
    const target = setup()
    target.controller.dispose()
    expect(target.clearListeners.size).toBe(0)
    target.canvas.dispatchEvent(pointer('pointerdown'))
    target.canvas.dispatchEvent(pointer('pointerup'))
    target.eventSource.dispatchEvent(key('Escape'))

    expect(target.pick).not.toHaveBeenCalled()
    expect(target.show).not.toHaveBeenCalled()
  })
})
