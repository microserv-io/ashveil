import { describe, expect, it } from 'vitest'
import { PrimaryClickGesture, type PointerGestureSample } from '../src/world/primary-click-gesture'

const sample = (overrides: Partial<PointerGestureSample> = {}): PointerGestureSample => ({
  pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 20, clientY: 30, ...overrides,
})

describe('primary click gesture', () => {
  it('accepts a matching left-button release within five CSS pixels', () => {
    const gesture = new PrimaryClickGesture()
    gesture.begin(sample())
    gesture.move(sample({ clientX: 23, clientY: 34 }))

    expect(gesture.end(sample({ buttons: 0, clientX: 23, clientY: 34 }))).toEqual({ clientX: 23, clientY: 34 })
  })

  it('does not become a click after dragging away and back', () => {
    const gesture = new PrimaryClickGesture()
    gesture.begin(sample())
    gesture.move(sample({ clientX: 26 }))
    gesture.move(sample())

    expect(gesture.end(sample({ buttons: 0 }))).toBeNull()
  })

  it('rejects pointer changes, button chords, cancellation, and non-mouse input', () => {
    const changedPointer = new PrimaryClickGesture()
    changedPointer.begin(sample())
    expect(changedPointer.end(sample({ pointerId: 2, buttons: 0 }))).toBeNull()

    const chorded = new PrimaryClickGesture()
    chorded.begin(sample())
    chorded.move(sample({ button: 2, buttons: 3 }))
    expect(chorded.end(sample({ buttons: 0 }))).toBeNull()

    const cancelled = new PrimaryClickGesture()
    cancelled.begin(sample())
    cancelled.cancel()
    expect(cancelled.end(sample({ buttons: 0 }))).toBeNull()

    const touch = new PrimaryClickGesture()
    touch.begin(sample({ pointerType: 'touch' }))
    expect(touch.end(sample({ pointerType: 'touch', buttons: 0 }))).toBeNull()
  })
})
