export interface PointerGestureSample {
  readonly pointerId: number
  readonly pointerType: string
  readonly button: number
  readonly buttons: number
  readonly clientX: number
  readonly clientY: number
}

export interface PrimaryClick {
  readonly clientX: number
  readonly clientY: number
}

export class PrimaryClickGesture {
  private candidate: { readonly pointerId: number; readonly startX: number; readonly startY: number } | null = null
  private exceededTravel = false

  constructor(private readonly maximumTravel = 5) {}

  begin(sample: PointerGestureSample): void {
    if (sample.pointerType !== 'mouse' || sample.button !== 0 || sample.buttons !== 1 || this.candidate) {
      this.cancel()
      return
    }
    this.candidate = { pointerId: sample.pointerId, startX: sample.clientX, startY: sample.clientY }
    this.exceededTravel = false
  }

  move(sample: PointerGestureSample): void {
    const candidate = this.candidate
    if (!candidate || sample.pointerId !== candidate.pointerId || sample.buttons !== 1) {
      this.cancel()
      return
    }
    const distance = Math.hypot(sample.clientX - candidate.startX, sample.clientY - candidate.startY)
    if (distance > this.maximumTravel) this.exceededTravel = true
  }

  end(sample: PointerGestureSample): PrimaryClick | null {
    const candidate = this.candidate
    if (!candidate || sample.pointerId !== candidate.pointerId || sample.button !== 0 || sample.buttons !== 0) {
      this.cancel()
      return null
    }
    const distance = Math.hypot(sample.clientX - candidate.startX, sample.clientY - candidate.startY)
    const clicked = !this.exceededTravel && distance <= this.maximumTravel
    this.cancel()
    return clicked ? { clientX: sample.clientX, clientY: sample.clientY } : null
  }

  cancel(): void {
    this.candidate = null
    this.exceededTravel = false
  }
}
