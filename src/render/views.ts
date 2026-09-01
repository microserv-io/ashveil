import * as THREE from 'three'
import type { Sim } from '../sim/sim'
import type { EntityId, GroundItem, Orb, Projectile, Vec2 } from '../sim/types'
import {
  applyDeathFade,
  applyHitFlash,
  applyWindupTell,
  orientActorView,
  type ActorView,
} from './actorview'
import { ActorViewPool } from './actorpool'
import { LightPool } from './lights'
import { meshesOf, spawnModel } from './models'
import { PALETTE } from './palette'
import { buildRigInput } from './riginput'

/** Intensities the lights had when they were parented to the things that cast them. */
const PLAYER_LAMP = 3.2
const PROJECTILE_LIGHT = 5
const ORB_LIGHT = 2.2

/**
 * Meshes are a projection of sim state, never a source of truth. Anything the
 * renderer knows it learned from `Sim` this frame.
 */
export class WorldView {
  private readonly actors = new Map<EntityId, ActorView>()
  private readonly projectiles = new Map<EntityId, THREE.Mesh>()
  private readonly loot = new Map<EntityId, THREE.Object3D>()
  private readonly orbs = new Map<EntityId, THREE.Object3D>()
  private readonly root = new THREE.Group()
  private aimArrow: THREE.Mesh | null = null
  private targetRing: THREE.Mesh | null = null

  private readonly lights: LightPool
  private readonly bodies = new ActorViewPool()

  constructor(scene: THREE.Scene) {
    scene.add(this.root)
    this.lights = new LightPool(scene)
  }

  /**
   * A controller has no cursor, so the aim has to be visible: an arrow for the
   * direction a skill will take, and a ring on whatever the soft target picked.
   */
  updateAimIndicator(sim: Sim, aim: Vec2 | null, targetId: EntityId | null): void {
    if (!this.aimArrow) {
      this.aimArrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 0.85, 3),
        new THREE.MeshBasicMaterial({ color: PALETTE.playerAccent, transparent: true, opacity: 0.75, depthTest: false }),
      )
      this.aimArrow.rotation.x = Math.PI / 2
      this.aimArrow.renderOrder = 6
      this.root.add(this.aimArrow)

      this.targetRing = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.8, 26),
        new THREE.MeshBasicMaterial({
          color: PALETTE.playerAccent,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      )
      this.targetRing.rotation.x = -Math.PI / 2
      this.targetRing.renderOrder = 6
      this.root.add(this.targetRing)
    }

    const arrow = this.aimArrow
    const ring = this.targetRing!

    if (!aim || sim.player.dead) {
      arrow.visible = false
      ring.visible = false
      return
    }

    const player = sim.player
    const dx = aim.x - player.pos.x
    const dy = aim.y - player.pos.y
    const length = Math.hypot(dx, dy)
    arrow.visible = length > 0.05
    if (arrow.visible) {
      const reach = Math.min(2.1, Math.max(1.2, length))
      arrow.position.set(player.pos.x + (dx / length) * reach, 0.12, player.pos.y + (dy / length) * reach)
      arrow.rotation.z = -Math.atan2(dy, dx) - Math.PI / 2
    }

    const target = targetId === null ? null : sim.actorById(targetId)
    ring.visible = target !== undefined && target !== null && !target.dead
    if (ring.visible && target) {
      ring.position.set(target.pos.x, 0.08, target.pos.y)
      ring.scale.setScalar(Math.max(0.7, target.radius / 0.5))
    }
  }

  clearArea(): void {
    // Bodies go back to the pool rather than being dropped: the next area is built
    // from the same archetypes, so rebuilding them would be pure waste.
    for (const view of this.actors.values()) {
      this.root.remove(view.group)
      this.bodies.release(view)
    }
    for (const mesh of this.projectiles.values()) this.root.remove(mesh)
    for (const mesh of this.loot.values()) this.root.remove(mesh)
    for (const mesh of this.orbs.values()) this.root.remove(mesh)
    this.actors.clear()
    this.projectiles.clear()
    this.loot.clear()
    this.orbs.clear()
  }

  /** One scratch set for all four passes: each fills and drains it before the next runs. */
  private readonly live = new Set<EntityId>()

  sync(sim: Sim, delta: number): void {
    // The player's lamp is claimed first so a volley can never leave them unlit.
    this.lights.begin()
    this.lights.place(sim.player.pos.x, 1.6, sim.player.pos.y, PALETTE.playerAccent, PLAYER_LAMP, 9)
    this.syncActors(sim, delta)
    this.syncProjectiles(sim)
    this.syncLoot(sim)
    this.syncOrbs(sim, delta)
    this.lights.end()
  }

  private syncActors(sim: Sim, delta: number): void {
    const seen = this.live
    seen.clear()

    for (const actor of sim.actors) {
      seen.add(actor.id)
      let view = this.actors.get(actor.id)
      if (!view) {
        view = this.bodies.acquire(actor)
        this.actors.set(actor.id, view)
        this.root.add(view.group)
        view.group.position.set(actor.pos.x, 0, actor.pos.y)
      }

      // Smoothing hides the separation nudges that keep bodies from overlapping.
      const smoothing = 1 - Math.exp(-24 * delta)
      view.group.position.x += (actor.pos.x - view.group.position.x) * smoothing
      view.group.position.z += (actor.pos.y - view.group.position.z) * smoothing
      orientActorView(view, actor)

      view.driver.update(buildRigInput(actor, sim, view), delta)

      if (actor.dead) {
        applyDeathFade(view, delta)
        continue
      }

      applyHitFlash(view, actor)
      applyWindupTell(view, actor)
    }

    for (const [id, view] of this.actors) {
      const actor = sim.actorById(id)
      if (seen.has(id) && actor && !(actor.dead && view.fadeLeft <= 0)) continue
      this.root.remove(view.group)
      this.bodies.release(view)
      this.actors.delete(id)
    }
  }

  private syncProjectiles(sim: Sim): void {
    const live = this.live
    live.clear()
    for (const projectile of sim.projectiles) {
      live.add(projectile.id)
      let mesh = this.projectiles.get(projectile.id)
      if (!mesh) {
        mesh = createProjectileMesh(projectile)
        this.projectiles.set(projectile.id, mesh)
        this.root.add(mesh)
      }
      mesh.position.set(projectile.pos.x, 0.85, projectile.pos.y)
      const colour = projectile.hostile ? PALETTE.lightning : PALETTE.fire
      this.lights.place(projectile.pos.x, 0.85, projectile.pos.y, colour, PROJECTILE_LIGHT, 6)
    }
    for (const [id, mesh] of this.projectiles) {
      if (live.has(id)) continue
      this.root.remove(mesh)
      mesh.geometry.dispose()
      this.projectiles.delete(id)
    }
  }

  private syncLoot(sim: Sim): void {
    const live = this.live
    live.clear()
    for (const ground of sim.groundItems) {
      live.add(ground.id)
      if (this.loot.has(ground.id)) continue
      const mesh = createLootMesh(ground)
      this.loot.set(ground.id, mesh)
      this.root.add(mesh)
    }
    for (const [id, mesh] of this.loot) {
      if (live.has(id)) continue
      this.root.remove(mesh)
      this.loot.delete(id)
    }
  }

  private syncOrbs(sim: Sim, delta: number): void {
    const live = this.live
    live.clear()
    for (const orb of sim.orbs) {
      live.add(orb.id)
      let mesh = this.orbs.get(orb.id)
      if (!mesh) {
        mesh = createOrbMesh(orb)
        this.orbs.set(orb.id, mesh)
        this.root.add(mesh)
      }
      mesh.rotation.y += delta * 2
      mesh.position.y = 0.55 + Math.sin(sim.time * 3 + orb.id) * 0.08
      this.lights.place(orb.pos.x, mesh.position.y + 0.3, orb.pos.y, PALETTE.orb, ORB_LIGHT, 4)
    }
    for (const [id, mesh] of this.orbs) {
      if (live.has(id)) continue
      this.root.remove(mesh)
      this.orbs.delete(id)
    }
  }
}

function createProjectileMesh(projectile: Projectile): THREE.Mesh {
  const colour = projectile.hostile ? PALETTE.lightning : PALETTE.fire
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(projectile.radius * 1.5, 10, 8),
    new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 2.4 }),
  )
  return mesh
}

function createLootMesh(ground: GroundItem): THREE.Object3D {
  const rarity = ground.item.rarity
  const group = new THREE.Group()
  group.position.set(ground.pos.x, 0, ground.pos.y)

  const container = spawnModel(rarity === 'rare' ? 'loot_rare' : rarity === 'magic' ? 'loot_magic' : 'loot_normal')
  container.scale.setScalar(0.4)
  group.add(container)

  // The beam is what makes a drop findable across a dark room; the model alone is not.
  const colour = rarity === 'rare' ? PALETTE.rare : rarity === 'magic' ? PALETTE.magic : 0xa9a396
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 }),
  )
  beam.position.y = 0.7
  group.add(beam)
  return group
}

function createOrbMesh(orb: Orb): THREE.Object3D {
  const group = new THREE.Group()
  const bottle = spawnModel('orb')
  bottle.scale.setScalar(0.5)
  // The kit's bottle is green; an orb restores life, and the glow has to agree.
  for (const mesh of meshesOf(bottle)) {
    const material = mesh.material as THREE.MeshStandardMaterial
    material.color.setHex(PALETTE.orb)
    material.emissive.setHex(PALETTE.orb)
    material.emissiveIntensity = 1.4
  }
  group.add(bottle)

  group.position.set(orb.pos.x, 0.55, orb.pos.y)
  return group
}
