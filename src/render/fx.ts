import * as THREE from 'three'
import { skill as skillDef } from '../sim/skills'
import type { Sim } from '../sim/sim'
import type { SimEvent } from '../sim/types'
import { PALETTE } from './palette'

interface Effect {
  object: THREE.Object3D
  life: number
  maxLife: number
  update: (effect: Effect, progress: number) => void
  dispose: () => void
}

/**
 * Transient visuals driven entirely by sim events. Nothing here feeds back into
 * the sim, so dropping a frame of effects can never change the outcome of a run.
 */
export class Effects {
  private readonly effects: Effect[] = []

  constructor(private readonly scene: THREE.Scene) {}

  consume(sim: Sim, events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'skill_used':
          this.onSkillUsed(sim, event)
          break
        case 'hit':
          this.spark(event.pos.x, event.pos.y, event.damage.crit)
          break
        case 'death':
          this.burst(event.pos.x, event.pos.y)
          break
        default:
          break
      }
    }
  }

  private onSkillUsed(sim: Sim, event: Extract<SimEvent, { kind: 'skill_used' }>): void {
    const actor = sim.actorById(event.actorId)
    if (!actor) return
    const def = skillDef(event.skill)

    if (def.shape === 'nova') {
      const radius = (def.radius ?? 3) * actor.stats.areaRadius
      this.ring(actor.pos.x, actor.pos.y, radius, event.skill === 'frost_nova' ? PALETTE.cold : PALETTE.physical)
    } else if (def.shape === 'melee_arc') {
      this.arc(actor.pos.x, actor.pos.y, actor.facing, def.range, def.arcDegrees ?? 90)
    }
  }

  /** The nova footprint: it lands where the ring ends, so the ring is the tell. */
  private ring(x: number, y: number, radius: number, colour: number): void {
    const geometry = new THREE.RingGeometry(radius * 0.15, radius, 40)
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.12, y)
    this.scene.add(mesh)

    this.push({
      object: mesh,
      life: 0.45,
      maxLife: 0.45,
      update: (_, progress) => {
        mesh.scale.setScalar(0.55 + progress * 0.6)
        material.opacity = 0.75 * (1 - progress)
      },
      dispose: () => {
        geometry.dispose()
        material.dispose()
      },
    })
  }

  private arc(x: number, y: number, facing: number, range: number, degrees: number): void {
    const half = (degrees * Math.PI) / 360
    const geometry = new THREE.RingGeometry(range * 0.3, range, 20, 1, -half, half * 2)
    const material = new THREE.MeshBasicMaterial({ color: PALETTE.playerAccent, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.z = facing
    mesh.position.set(x, 0.14, y)
    this.scene.add(mesh)

    this.push({
      object: mesh,
      life: 0.22,
      maxLife: 0.22,
      update: (_, progress) => {
        material.opacity = 0.5 * (1 - progress)
      },
      dispose: () => {
        geometry.dispose()
        material.dispose()
      },
    })
  }

  private spark(x: number, y: number, crit: boolean): void {
    const geometry = new THREE.SphereGeometry(crit ? 0.4 : 0.24, 8, 6)
    const material = new THREE.MeshBasicMaterial({ color: crit ? PALETTE.rare : 0xffffff, transparent: true, opacity: 0.9 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, 0.9, y)
    this.scene.add(mesh)

    this.push({
      object: mesh,
      life: 0.18,
      maxLife: 0.18,
      update: (_, progress) => {
        mesh.scale.setScalar(1 + progress * 1.8)
        material.opacity = 0.9 * (1 - progress)
      },
      dispose: () => {
        geometry.dispose()
        material.dispose()
      },
    })
  }

  private burst(x: number, y: number): void {
    const geometry = new THREE.IcosahedronGeometry(0.55, 0)
    const material = new THREE.MeshBasicMaterial({ color: 0x8a2f24, transparent: true, opacity: 0.8, wireframe: true })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, 0.6, y)
    this.scene.add(mesh)

    this.push({
      object: mesh,
      life: 0.5,
      maxLife: 0.5,
      update: (_, progress) => {
        mesh.scale.setScalar(1 + progress * 2.2)
        mesh.rotation.y = progress * 3
        material.opacity = 0.8 * (1 - progress)
      },
      dispose: () => {
        geometry.dispose()
        material.dispose()
      },
    })
  }

  private push(effect: Effect): void {
    this.effects.push(effect)
  }

  update(delta: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]!
      effect.life -= delta
      if (effect.life <= 0) {
        this.scene.remove(effect.object)
        effect.dispose()
        this.effects.splice(i, 1)
        continue
      }
      effect.update(effect, 1 - effect.life / effect.maxLife)
    }
  }
}
