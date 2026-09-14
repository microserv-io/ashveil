import { PrimaryClickGesture } from './primary-click-gesture'
import type { PickedNpc } from './npc-picker'

export interface NpcTargetControllerOptions {
  readonly canvas: HTMLCanvasElement
  readonly inputEnabled: () => boolean
  readonly modalOpen: () => boolean
  readonly pick: (clientX: number, clientY: number) => PickedNpc | null
  readonly show: (target: PickedNpc | null) => void
  readonly onInputClear: (listener: () => void) => () => void
  readonly eventSource?: Window
  readonly activeElement?: () => Element | null
}

export class NpcTargetController {
  private readonly gesture = new PrimaryClickGesture()
  private readonly eventSource: Window
  private readonly removeInputClearListener: () => void

  constructor(private readonly options: NpcTargetControllerOptions) {
    this.eventSource = options.eventSource ?? window
    this.removeInputClearListener = options.onInputClear(this.cancel)
    options.canvas.addEventListener('pointerdown', this.onPointerDown)
    options.canvas.addEventListener('pointermove', this.onPointerMove)
    options.canvas.addEventListener('pointerup', this.onPointerUp)
    options.canvas.addEventListener('pointercancel', this.cancel)
    options.canvas.addEventListener('lostpointercapture', this.cancel)
    this.eventSource.addEventListener('keydown', this.onKeyDown)
  }

  dispose(): void {
    const { canvas } = this.options
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.cancel)
    canvas.removeEventListener('lostpointercapture', this.cancel)
    this.eventSource.removeEventListener('keydown', this.onKeyDown)
    this.removeInputClearListener()
  }

  cancel = (): void => { this.gesture.cancel() }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.options.inputEnabled() || this.options.modalOpen()) {
      this.gesture.cancel()
      return
    }
    this.gesture.begin(event)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.options.inputEnabled() || this.options.modalOpen()) {
      this.gesture.cancel()
      return
    }
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    for (const sample of coalesced) this.gesture.move(sample)
    this.gesture.move(event)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.options.inputEnabled() || this.options.modalOpen()) {
      this.gesture.cancel()
      return
    }
    const click = this.gesture.end(event)
    if (click) this.options.show(this.options.pick(click.clientX, click.clientY))
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.code !== 'Escape' || !this.options.inputEnabled()
      || this.options.modalOpen() || isEditable(event.target) || isEditable(this.activeElement())) return
    this.options.show(null)
  }

  private activeElement(): Element | null {
    if (this.options.activeElement) return this.options.activeElement()
    return typeof document === 'undefined' ? null : document.activeElement
  }
}

function isEditable(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element
    && target.closest('input, select, textarea, [contenteditable]') !== null
}
