export interface InputFrame {
  readonly forward: number
  readonly right: number
  readonly sprint: boolean
  readonly orbitX: number
  readonly orbitY: number
  readonly zoom: number
}

export class WorldInput {
  private readonly keys = new Set<string>()
  private orbitX = 0
  private orbitY = 0
  private zoom = 0
  private dragPointer: number | undefined
  private lastX = 0
  private lastY = 0
  private joystickPointer: number | undefined
  private joystickX = 0
  private joystickY = 0
  private sprintTouch = false
  private sprintPointer: number | undefined

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly joystick: HTMLElement,
    private readonly joystickKnob: HTMLElement,
    sprintButton: HTMLButtonElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clear)
    document.addEventListener('visibilitychange', this.clear)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('lostpointercapture', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    joystick.addEventListener('pointerdown', this.onJoystickDown)
    joystick.addEventListener('pointermove', this.onJoystickMove)
    joystick.addEventListener('pointerup', this.onJoystickUp)
    joystick.addEventListener('pointercancel', this.onJoystickUp)
    joystick.addEventListener('lostpointercapture', this.onJoystickUp)
    sprintButton.addEventListener('pointerdown', (event) => {
      if (this.sprintPointer !== undefined) return
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
  }

  read(): InputFrame {
    const keyboardForward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'))
    const keyboardRight = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
    const frame = {
      forward: Math.max(-1, Math.min(1, keyboardForward - this.joystickY)),
      right: Math.max(-1, Math.min(1, keyboardRight + this.joystickX)),
      sprint: this.sprintTouch || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      orbitX: this.orbitX,
      orbitY: this.orbitY,
      zoom: this.zoom,
    }
    this.orbitX = 0
    this.orbitY = 0
    this.zoom = 0
    return frame
  }

  clear = (): void => {
    this.keys.clear()
    this.dragPointer = undefined
    this.joystickPointer = undefined
    this.joystickX = 0
    this.joystickY = 0
    this.sprintTouch = false
    this.sprintPointer = undefined
    this.orbitX = 0
    this.orbitY = 0
    this.zoom = 0
    this.joystickKnob.style.transform = 'translate(0, 0)'
  }

  private onKeyDown = (event: KeyboardEvent): void => { this.keys.add(event.code) }
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code) }
  private onWheel = (event: WheelEvent): void => { event.preventDefault(); this.zoom += event.deltaY * 0.012 }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.dragPointer !== undefined) return
    this.dragPointer = event.pointerId
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.canvas.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointer) return
    this.orbitX += event.clientX - this.lastX
    this.orbitY += event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.dragPointer) this.dragPointer = undefined
  }

  private onJoystickDown = (event: PointerEvent): void => {
    event.preventDefault()
    if (this.joystickPointer !== undefined) return
    this.joystickPointer = event.pointerId
    this.joystick.setPointerCapture(event.pointerId)
    this.updateJoystick(event)
  }

  private onJoystickMove = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) this.updateJoystick(event)
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
