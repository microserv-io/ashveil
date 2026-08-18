import * as THREE from 'three'
import type { Sim } from '../sim/sim'
import type { EntityId, GroundItem, Orb, Projectile, Vec2 } from '../sim/types'
import {
  applyDeathFade,
  applyHitFlash,
  applyWindupTell,
  createActorView,
  disposeActorView,
  orientActorView,
  type ActorView,
} from './actorview'
import { meshesOf, spawnModel } from './models'
import { PALETTE } from './palette'
import { rigStateOf } from './rig'

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

  constructor(scene: THREE.Scene) {
    scene.add(this.root)
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
    for (const view of this.actors.values()) this.root.remove(view.group)
    for (const mesh of this.projectiles.values()) this.root.remove(mesh)
    for (const mesh of this.loot.values()) this.root.remove(mesh)
    for (const mesh of this.orbs.values()) this.root.remove(mesh)
    this.actors.clear()
    this.projectiles.clear()
    this.loot.clear()
    this.orbs.clear()
  }

  sync(sim: Sim, delta: number): void {
    this.syncActors(sim, delta)
    this.syncProjectiles(sim)
    this.syncLoot(sim)
    this.syncOrbs(sim, delta)
  }

  private syncActors(sim: Sim, delta: number): void {
    const seen = new Set<EntityId>()

    for (const actor of sim.actors) {
      seen.add(actor.id)
      let view = this.actors.get(actor.id)
      if (!view) {
        view = createActorView(actor)
        this.actors.set(actor.id, view)
        this.root.add(view.group)
        view.group.position.set(actor.pos.x, 0, actor.pos.y)
      }

      // Smoothing hides the separation nudges that keep bodies from overlapping.
      const smoothing = 1 - Math.exp(-24 * delta)
      view.group.position.x += (actor.pos.x - view.group.position.x) * smoothing
      view.group.position.z += (actor.pos.y - view.group.position.z) * smoothing
      orientActorView(view, actor)

      view.rig.apply(rigStateOf(actor))
      // A fast weapon outruns its swing clip, which would freeze on the last frame.
      if (actor.state === 'acting' && actor.recovery > 0) view.rig.scaleToDuration(actor.recovery + actor.windup)
      view.rig.update(delta)

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
      disposeActorView(view)
      this.actors.delete(id)
    }
  }

  private syncProjectiles(sim: Sim): void {
    const live = new Set<EntityId>()
    for (const projectile of sim.projectiles) {
      live.add(projectile.id)
      let mesh = this.projectiles.get(projectile.id)
      if (!mesh) {
        mesh = createProjectileMesh(projectile)
        this.projectiles.set(projectile.id, mesh)
        this.root.add(mesh)
      }
      mesh.position.set(projectile.pos.x, 0.85, projectile.pos.y)
    }
    for (const [id, mesh] of this.projectiles) {
      if (live.has(id)) continue
      this.root.remove(mesh)
      mesh.geometry.dispose()
      this.projectiles.delete(id)
    }
  }

  private syncLoot(sim: Sim): void {
    const live = new Set<EntityId>()
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
    const live = new Set<EntityId>()
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
  const light = new THREE.PointLight(colour, 5, 6, 2)
  mesh.add(light)
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

  const glow = new THREE.PointLight(PALETTE.orb, 2.2, 4, 2)
  glow.position.y = 0.3
  group.add(glow)
  group.position.set(orb.pos.x, 0.55, orb.pos.y)
  return group
}
