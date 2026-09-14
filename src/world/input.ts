export interface InputFrame {
  readonly keyboardForward: number
  readonly keyboardStrafe: number
  readonly keyboardTurn: number
  readonly touchForward: number
  readonly touchRight: number
  readonly sprint: boolean
  readonly walk?: boolean
  readonly jump: boolean
  readonly orbitX: number
  readonly orbitY: number
  readonly zoom: number
  readonly freeLook: boolean
  readonly mouseSteering: boolean
  readonly mouseSteeringPending: boolean
  readonly mouseForward: boolean
  readonly mouseSteeringOrbitX: number
}

export interface KeyboardAxes {
  readonly forward: number
  readonly strafe: number
  readonly turn: number
}

export function neutralInputFrame(): InputFrame {
  return {
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
  }
}

export function keyboardAxes(keys: ReadonlySet<string>): KeyboardAxes {
  return {
    forward: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
    strafe: Number(keys.has('KeyE')) - Number(keys.has('KeyQ')),
    turn: Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight')),
  }
}

export function keyboardSteeringActive(input: Pick<InputFrame, 'keyboardForward' | 'keyboardStrafe' | 'keyboardTurn'>): boolean {
  return input.keyboardForward !== 0 || input.keyboardStrafe !== 0 || input.keyboardTurn !== 0
}

export class WorldInput {
  private enabled = true
  private readonly keys = new Set<string>()
  private orbitX = 0
  private orbitY = 0
  private zoom = 0
  private dragPointer: number | undefined
  private dragPointerType: string | undefined
  private mouseButtons = 0
  private mouseSteeringPending = false
  private mouseSteeringOrbitX = 0
  private lastX = 0
  private lastY = 0
  private joystickPointer: number | undefined
  private joystickX = 0
  private joystickY = 0
  private sprintTouch = false
  private sprintPointer: number | undefined
  private jumpQueued = false
  private readonly clearListeners = new Set<() => void>()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly joystick: HTMLElement,
    private readonly joystickKnob: HTMLElement,
    private readonly sprintButton: HTMLButtonElement,
    jumpButton: HTMLButtonElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clear)
    document.addEventListener('visibilitychange', this.clear)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('lostpointercapture', this.onPointerCancel)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', this.onContextMenu)
    joystick.addEventListener('pointerdown', this.onJoystickDown)
    joystick.addEventListener('pointermove', this.onJoystickMove)
    joystick.addEventListener('pointerup', this.onJoystickUp)
    joystick.addEventListener('pointercancel', this.onJoystickUp)
    joystick.addEventListener('lostpointercapture', this.onJoystickUp)
    sprintButton.addEventListener('pointerdown', (event) => {
      if (!this.enabled || this.sprintPointer !== undefined) return
      this.sprintPointer = event.pointerId
      this.sprintTouch = true
      sprintButton.setPointerCapture(event.pointerId)
    })
    const stopSprint = (event: PointerEvent): void => {
      if (event.pointerId !== this.sprintPointer) return
      this.sprintPointer = undefined
      this.sprintTouch = false
    }
    sprintButton.addEventListener('pointerup', stopSprint)
    sprintButton.addEventListener('pointercancel', stopSprint)
    sprintButton.addEventListener('lostpointercapture', stopSprint)
    jumpButton.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return
      event.preventDefault()
      this.jumpQueued = true
    })
  }

  read(): InputFrame {
    if (!this.enabled) return neutralInputFrame()
    const keyboard = keyboardAxes(this.keys)
    const frame = {
      keyboardForward: keyboard.forward,
      keyboardStrafe: keyboard.strafe,
      keyboardTurn: keyboard.turn,
      touchForward: this.joystickY === 0 ? 0 : -this.joystickY,
      touchRight: this.joystickX,
      sprint: this.sprintTouch || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      walk: this.keys.has('AltLeft') || this.keys.has('AltRight'),
      jump: this.jumpQueued,
      orbitX: this.orbitX,
      orbitY: this.orbitY,
      zoom: this.zoom,
      freeLook: (this.mouseButtons & 1) !== 0 && (this.mouseButtons & 2) === 0,
      mouseSteering: (this.mouseButtons & 2) !== 0,
      mouseSteeringPending: this.mouseSteeringPending,
      mouseForward: (this.mouseButtons & 3) === 3,
      mouseSteeringOrbitX: this.mouseSteeringOrbitX,
    }
    this.orbitX = 0
    this.orbitY = 0
    this.zoom = 0
    this.mouseSteeringPending = false
    this.mouseSteeringOrbitX = 0
    this.jumpQueued = false
    return frame
  }

  get isEnabled(): boolean { return this.enabled }

  addClearListener(listener: () => void): () => void {
    this.clearListeners.add(listener)
    return () => { this.clearListeners.delete(listener) }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.clear()
  }

  clear = (): void => {
    for (const listener of this.clearListeners) listener()
    const dragPointer = this.dragPointer
    const joystickPointer = this.joystickPointer
    const sprintPointer = this.sprintPointer
    this.keys.clear()
    this.dragPointer = undefined
    this.dragPointerType = undefined
    this.mouseButtons = 0
    this.joystickPointer = undefined
    this.joystickX = 0
    this.joystickY = 0
    this.sprintTouch = false
    this.sprintPointer = undefined
    this.orbitX = 0
    this.orbitY = 0
    this.zoom = 0
    this.mouseSteeringPending = false
    this.mouseSteeringOrbitX = 0
    this.jumpQueued = false
    this.joystickKnob.style.transform = 'translate(0, 0)'
    releasePointerCapture(this.canvas, dragPointer)
    releasePointerCapture(this.joystick, joystickPointer)
    releasePointerCapture(this.sprintButton, sprintPointer)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || isEditableTarget(event.target) || !GAMEPLAY_KEYS.has(event.code)) return
    event.preventDefault()
    if (event.code === 'Space') {
      if (!event.repeat) this.jumpQueued = true
      return
    }
    if (event.repeat && !this.keys.has(event.code)) return
    this.keys.add(event.code)
  }
  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.enabled) return
    if (!this.keys.delete(event.code)) return
    event.preventDefault()
  }
  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return
    event.preventDefault()
    this.zoom += event.deltaY * 0.012
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return
    if (event.pointerType === 'mouse') {
      const buttons = event.buttons & 3
      if (buttons === 0 || (this.dragPointer !== undefined && event.pointerId !== this.dragPointer)) return
      const acquiring = this.dragPointer === undefined
      this.dragPointer = event.pointerId
      this.dragPointerType = 'mouse'
      this.mouseButtons = buttons
      if ((buttons & 2) !== 0) {
        this.mouseSteeringPending = true
        this.mouseSteeringOrbitX = this.orbitX
      }
      this.lastX = event.clientX
      this.lastY = event.clientY
      if (acquiring) this.canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    if (this.dragPointer !== undefined) return
    this.dragPointer = event.pointerId
    this.dragPointerType = event.pointerType
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.canvas.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || event.pointerId !== this.dragPointer) return
    if (this.dragPointerType === 'mouse') {
      this.mouseButtons = event.buttons & 3
      if (this.mouseButtons === 0) {
        this.dragPointer = undefined
        this.dragPointerType = undefined
        return
      }
    }
    this.orbitX += event.clientX - this.lastX
    this.orbitY += event.clientY - this.lastY
    if (this.dragPointerType === 'mouse' && (this.mouseButtons & 2) !== 0) {
      this.mouseSteeringPending = true
      this.mouseSteeringOrbitX = this.orbitX
    }
    this.lastX = event.clientX
    this.lastY = event.clientY
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return
    if (this.dragPointerType === 'mouse') {
      this.mouseButtons = event.buttons & 3
      if (this.mouseButtons !== 0) return
    }
    this.dragPointer = undefined
    this.dragPointerType = undefined
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return
    this.dragPointer = undefined
    this.dragPointerType = undefined
    this.mouseButtons = 0
    this.orbitX = 0
    this.orbitY = 0
    this.mouseSteeringPending = false
    this.mouseSteeringOrbitX = 0
  }

  private onContextMenu = (event: MouseEvent): void => { event.preventDefault() }

  private onJoystickDown = (event: PointerEvent): void => {
    event.preventDefault()
    if (!this.enabled || this.joystickPointer !== undefined) return
    this.joystickPointer = event.pointerId
    this.joystick.setPointerCapture(event.pointerId)
    this.updateJoystick(event)
  }

  private onJoystickMove = (event: PointerEvent): void => {
    if (this.enabled && event.pointerId === this.joystickPointer) this.updateJoystick(event)
  }

  private onJoystickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointer) return
    this.joystickPointer = undefined
    this.joystickX = 0
    this.joystickY = 0
    this.joystickKnob.style.transform = 'translate(0, 0)'
  }

  private updateJoystick(event: PointerEvent): void {
    const bounds = this.joystick.getBoundingClientRect()
    const radius = bounds.width * 0.32
    let x = event.clientX - (bounds.left + bounds.width / 2)
    let y = event.clientY - (bounds.top + bounds.height / 2)
    const distance = Math.hypot(x, y)
    if (distance > radius) { x *= radius / distance; y *= radius / distance }
    this.joystickX = x / radius
    this.joystickY = y / radius
    this.joystickKnob.style.transform = `translate(${x}px, ${y}px)`
  }
}

const GAMEPLAY_KEYS = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'Space',
])

function releasePointerCapture(element: Element, pointerId: number | undefined): void {
  if (pointerId === undefined || typeof element.releasePointerCapture !== 'function') return
  try {
    if (typeof element.hasPointerCapture !== 'function' || element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId)
    }
  } catch {
    // Capture may already have been released by the browser during cancellation.
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return (target as Element).closest('input, select, textarea, button, [contenteditable]') !== null
}
