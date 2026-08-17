import * as THREE from 'three'
import type { Sim } from '../sim/sim'
import type { EntityId, SimEvent } from '../sim/types'
import { DAMAGE_CSS, RARITY_CSS } from './palette'
import type { SceneHost } from './scene'

interface FloatingNumber {
  element: HTMLElement
  world: THREE.Vector3
  life: number
  maxLife: number
  drift: number
}

const DAMAGE_NUMBER_LIFE = 0.9

/**
 * Screen-space furniture: damage numbers, loot labels and monster health bars.
 * DOM handles crisp text and hit-testing better than sprites, and it keeps the
 * three.js scene to things that are actually in the world.
 */
export class WorldOverlay {
  private readonly numbers: FloatingNumber[] = []
  private readonly lootLabels = new Map<EntityId, HTMLElement>()
  private readonly healthBars = new Map<EntityId, { root: HTMLElement; fill: HTMLElement }>()

  constructor(
    private readonly root: HTMLElement,
    private readonly host: SceneHost,
    private readonly onLootClick: (groundItemId: EntityId) => void,
  ) {}

  consume(sim: Sim, events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.kind === 'hit') {
        const dominant = dominantType(event.damage.byType)
        this.addNumber(
          `${Math.round(event.damage.total)}${event.damage.crit ? '!' : ''}`,
          new THREE.Vector3(event.pos.x, 1.5, event.pos.y),
          DAMAGE_CSS[dominant] ?? '#fff',
          event.damage.crit,
          event.targetId === sim.player.id,
        )
      } else if (event.kind === 'orb_collected' && event.healed > 0) {
        this.addNumber(`+${Math.round(event.healed)}`, new THREE.Vector3(event.pos.x, 1.5, event.pos.y), '#7dd88a', false, false)
      }
    }
  }

  private addNumber(text: string, world: THREE.Vector3, colour: string, crit: boolean, incoming: boolean): void {
    const element = document.createElement('div')
    element.className = 'floating-number'
    element.textContent = text
    element.style.color = incoming ? '#ff6b5e' : colour
    element.style.fontSize = crit ? '1.62rem' : incoming ? '1.25rem' : '1.06rem'
    element.style.fontWeight = crit ? '800' : '600'
    this.root.appendChild(element)
    this.numbers.push({
      element,
      world: world.clone(),
      life: DAMAGE_NUMBER_LIFE,
      maxLife: DAMAGE_NUMBER_LIFE,
      drift: (world.x * 37 + world.z * 17) % 1.4 - 0.7,
    })
  }

  update(sim: Sim, delta: number): void {
    this.updateNumbers(delta)
    this.updateLoot(sim)
    this.updateHealthBars(sim)
  }

  private updateNumbers(delta: number): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const number = this.numbers[i]!
      number.life -= delta
      if (number.life <= 0) {
        number.element.remove()
        this.numbers.splice(i, 1)
        continue
      }
      const progress = 1 - number.life / number.maxLife
      const world = number.world.clone()
      world.y += progress * 1.5
      world.x += number.drift * progress
      const screen = this.host.project(world)
      number.element.style.transform = `translate(-50%, -50%) translate(${screen.x}px, ${screen.y}px)`
      number.element.style.opacity = String(Math.min(1, (1 - progress) * 2.2))
    }
  }

  private updateLoot(sim: Sim): void {
    const live = new Set<EntityId>()

    for (const ground of sim.groundItems) {
      live.add(ground.id)
      let label = this.lootLabels.get(ground.id)
      if (!label) {
        label = document.createElement('button')
        label.className = 'loot-label'
        label.textContent = ground.item.name
        label.style.color = RARITY_CSS[ground.item.rarity] ?? '#fff'
        label.style.borderColor = `${RARITY_CSS[ground.item.rarity] ?? '#fff'}66`
        label.addEventListener('click', (clickEvent) => {
          clickEvent.stopPropagation()
          this.onLootClick(ground.id)
        })
        this.root.appendChild(label)
        this.lootLabels.set(ground.id, label)
      }
      const screen = this.host.project(new THREE.Vector3(ground.pos.x, 1.1, ground.pos.y))
      label.style.transform = `translate(-50%, -50%) translate(${screen.x}px, ${screen.y}px)`
      const inRange = Math.hypot(ground.pos.x - sim.player.pos.x, ground.pos.y - sim.player.pos.y) <= 2.6
      label.classList.toggle('in-range', inRange)
      label.style.display = screen.visible ? '' : 'none'
    }

    for (const [id, label] of this.lootLabels) {
      if (live.has(id)) continue
      label.remove()
      this.lootLabels.delete(id)
    }
  }

  private updateHealthBars(sim: Sim): void {
    const live = new Set<EntityId>()

    for (const actor of sim.actors) {
      if (actor.kind !== 'monster' || actor.dead) continue
      const damaged = actor.life < actor.stats.maxLife
      if (!damaged && !actor.aggroed) continue

      live.add(actor.id)
      let bar = this.healthBars.get(actor.id)
      if (!bar) {
        const root = document.createElement('div')
        root.className = `health-bar rarity-${actor.rarity}`
        const fill = document.createElement('div')
        fill.className = 'health-bar-fill'
        root.appendChild(fill)
        this.root.appendChild(root)
        bar = { root, fill }
        this.healthBars.set(actor.id, bar)
      }

      const height = actor.radius * 2.6 + 0.7
      const screen = this.host.project(new THREE.Vector3(actor.pos.x, height, actor.pos.y))
      bar.root.style.transform = `translate(-50%, -50%) translate(${screen.x}px, ${screen.y}px)`
      bar.root.style.display = screen.visible ? '' : 'none'
      bar.fill.style.width = `${Math.max(0, (actor.life / actor.stats.maxLife) * 100)}%`
    }

    for (const [id, bar] of this.healthBars) {
      if (live.has(id)) continue
      bar.root.remove()
      this.healthBars.delete(id)
    }
  }

  clearArea(): void {
    for (const label of this.lootLabels.values()) label.remove()
    for (const bar of this.healthBars.values()) bar.root.remove()
    for (const number of this.numbers) number.element.remove()
    this.lootLabels.clear()
    this.healthBars.clear()
    this.numbers.length = 0
  }
}

function dominantType(byType: Record<string, number>): string {
  let best = 'physical'
  let value = -1
  for (const [type, amount] of Object.entries(byType)) {
    if (amount > value) {
      value = amount
      best = type
    }
  }
  return best
}
