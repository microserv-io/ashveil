import type { Sim } from '../sim/sim'
import { skill as skillDef } from '../sim/skills'
import type { Actor, Intent, Vec2 } from '../sim/types'
import type { SceneHost } from './scene'

const MONSTER_PICK_RADIUS = 1.1

export interface InputCallbacks {
  toggleInventory: () => void
  togglePassives: () => void
}

/**
 * Mouse and keyboard become Intents — the same queue the headless bot writes to.
 * Nothing here touches sim state directly, so anything reachable by hand is also
 * reachable by a test.
 */
export class InputController {
  private pointer: Vec2 | null = null
  private pointerNdc = { x: 0, y: 0 }
  private readonly held = new Set<number>()
  private readonly pressed = new Set<string>()
  private readonly tapped: string[] = []

  constructor(
    private readonly element: HTMLElement,
    private readonly host: SceneHost,
    private readonly callbacks: InputCallbacks,
  ) {
    element.addEventListener('contextmenu', (event) => event.preventDefault())

    element.addEventListener('pointerdown', (event) => {
      this.held.add(event.button)
      this.updatePointer(event)
    })
    globalThis.addEventListener('pointerup', (event) => this.held.delete(event.button))
    element.addEventListener('pointermove', (event) => this.updatePointer(event))
    element.addEventListener('pointerleave', () => this.held.clear())

    globalThis.addEventListener('keydown', (event) => {
      if (event.repeat) return
      const key = event.key.toLowerCase()
      this.pressed.add(key)
      this.tapped.push(key)
      if (key === 'tab') {
        event.preventDefault()
        this.callbacks.toggleInventory()
      }
      if (key === 'p') this.callbacks.togglePassives()
    })
    globalThis.addEventListener('keyup', (event) => this.pressed.delete(event.key.toLowerCase()))
    globalThis.addEventListener('blur', () => {
      this.held.clear()
      this.pressed.clear()
    })
  }

  private lastMoveAt = -1
  private lastMoveTarget: Vec2 | null = null

  /**
   * A held mouse button would otherwise request a fresh A* every frame. Repath
   * only when the destination actually moved, or after a short interval.
   */
  private shouldRepath(sim: Sim, destination: Vec2): boolean {
    const drifted =
      !this.lastMoveTarget ||
      Math.hypot(destination.x - this.lastMoveTarget.x, destination.y - this.lastMoveTarget.y) > 0.75
    if (!drifted && sim.time - this.lastMoveAt < 0.12) return false
    this.lastMoveAt = sim.time
    this.lastMoveTarget = { ...destination }
    return true
  }

  private updatePointer(event: PointerEvent): void {
    const bounds = this.element.getBoundingClientRect()
    this.pointerNdc = {
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    }
    this.pointer = this.host.pointerToGround(this.pointerNdc.x, this.pointerNdc.y)
  }

  get groundPoint(): Vec2 | null {
    return this.pointer
  }

  monsterUnderCursor(sim: Sim): Actor | null {
    if (!this.pointer) return null
    let best: Actor | null = null
    let bestGap = MONSTER_PICK_RADIUS
    for (const actor of sim.actors) {
      if (actor.kind !== 'monster' || actor.dead) continue
      const gap = Math.hypot(actor.pos.x - this.pointer.x, actor.pos.y - this.pointer.y) - actor.radius
      if (gap < bestGap) {
        best = actor
        bestGap = gap
      }
    }
    return best
  }

  /** Intents for this frame. Held buttons repeat, tapped keys fire once. */
  poll(sim: Sim): Intent[] {
    const intents: Intent[] = []
    const taps = this.tapped.splice(0, this.tapped.length)
    const aim = this.pointer

    if (taps.includes('f') && sim.areaCleared) intents.push({ kind: 'enter_portal' })
    if (aim) {
      if (taps.includes('q')) intents.push({ kind: 'use_skill', skill: 'frost_nova', aim: sim.player.pos })
      if (taps.includes(' ')) intents.push({ kind: 'use_skill', skill: 'dash', aim })
      if (this.held.has(2)) intents.push({ kind: 'use_skill', skill: 'firebolt', aim })

      if (this.held.has(0)) {
        const target = this.monsterUnderCursor(sim)
        const reach = skillDef('cleave').range
        if (target && Math.hypot(target.pos.x - sim.player.pos.x, target.pos.y - sim.player.pos.y) <= reach + target.radius) {
          intents.push({ kind: 'use_skill', skill: 'cleave', aim: target.pos })
        } else {
          const destination = target ? target.pos : aim
          if (this.shouldRepath(sim, destination)) intents.push({ kind: 'move', to: destination })
        }
      }
    }

    // Walking over loot does not collect it, so give the keyboard a grab-all.
    if (taps.includes('e')) {
      for (const ground of sim.groundItems) {
        if (Math.hypot(ground.pos.x - sim.player.pos.x, ground.pos.y - sim.player.pos.y) <= 2.6) {
          intents.push({ kind: 'pickup', itemId: ground.id })
        }
      }
    }

    return intents
  }
}
