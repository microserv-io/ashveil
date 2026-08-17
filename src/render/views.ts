import * as THREE from 'three'
import type { Sim } from '../sim/sim'
import type { Actor, EntityId, GroundItem, Orb, Projectile, Vec2 } from '../sim/types'
import { PALETTE } from './palette'

const DEATH_FADE = 1.1

interface ActorView {
  group: THREE.Group
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  baseColour: THREE.Color
  fadeLeft: number
}

/**
 * Meshes are a projection of sim state, never a source of truth. Anything the
 * renderer knows it learned from `Sim` this frame.
 */
export class WorldView {
  private readonly actors = new Map<EntityId, ActorView>()
  private readonly projectiles = new Map<EntityId, THREE.Mesh>()
  private readonly loot = new Map<EntityId, THREE.Object3D>()
  private readonly orbs = new Map<EntityId, THREE.Mesh>()
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
      view.group.rotation.y = -actor.facing + Math.PI / 2

      if (actor.dead) {
        view.fadeLeft = view.fadeLeft === 0 ? DEATH_FADE : Math.max(0, view.fadeLeft - delta)
        const t = view.fadeLeft / DEATH_FADE
        view.group.position.y = -0.9 * (1 - t)
        view.group.scale.setScalar(Math.max(0.05, t))
        view.body.material.opacity = t
        view.body.material.transparent = true
        continue
      }

      applyHitFlash(view, actor)
      applyWindupTell(view, actor)
    }

    for (const [id, view] of this.actors) {
      const actor = sim.actorById(id)
      if (seen.has(id) && actor && !(actor.dead && view.fadeLeft <= 0)) continue
      this.root.remove(view.group)
      view.body.geometry.dispose()
      view.body.material.dispose()
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
      mesh.geometry.dispose()
      this.orbs.delete(id)
    }
  }
}

function createActorView(actor: Actor): ActorView {
  const group = new THREE.Group()
  const colour = new THREE.Color(bodyColour(actor))
  const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7, metalness: 0.1 })
  const body = new THREE.Mesh(bodyGeometry(actor), material)
  body.castShadow = true
  body.position.y = actor.radius * 1.9
  group.add(body)

  if (actor.kind === 'player') {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 1),
      new THREE.MeshStandardMaterial({ color: PALETTE.playerAccent, emissive: PALETTE.playerAccent, emissiveIntensity: 0.7 }),
    )
    blade.position.set(0.34, 0.85, 0.45)
    group.add(blade)

    const lamp = new THREE.PointLight(PALETTE.playerAccent, 3.2, 9, 2)
    lamp.position.set(0, 1.6, 0)
    group.add(lamp)

    // A taller monster standing on top of you would otherwise hide you entirely.
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(actor.radius * 1.25, actor.radius * 1.5, 28),
      new THREE.MeshBasicMaterial({
        color: PALETTE.playerAccent,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.position.y = 0.05
    marker.renderOrder = 5
    group.add(marker)
  }

  if (actor.rarity !== 'normal') {
    const aura = new THREE.Mesh(
      new THREE.RingGeometry(actor.radius * 1.5, actor.radius * 1.9, 24),
      new THREE.MeshBasicMaterial({
        color: actor.rarity === 'rare' ? PALETTE.rare : PALETTE.magic,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
    )
    aura.rotation.x = -Math.PI / 2
    aura.position.y = 0.06
    group.add(aura)
  }

  return { group, body, baseColour: colour, fadeLeft: 0 }
}

function bodyGeometry(actor: Actor): THREE.BufferGeometry {
  if (actor.kind === 'player') return new THREE.CapsuleGeometry(actor.radius, 0.85, 6, 14)
  switch (actor.archetype) {
    case 'swarm':
      return new THREE.ConeGeometry(actor.radius * 1.15, actor.radius * 2.6, 12)
    case 'ranged':
      return new THREE.CapsuleGeometry(actor.radius * 0.8, 1.1, 5, 10)
    case 'brute':
      return new THREE.BoxGeometry(actor.radius * 1.9, actor.radius * 2.6, actor.radius * 1.7)
    default:
      return new THREE.SphereGeometry(actor.radius, 12, 10)
  }
}

function bodyColour(actor: Actor): number {
  if (actor.kind === 'player') return PALETTE.player
  switch (actor.archetype) {
    case 'swarm':
      return PALETTE.swarm
    case 'ranged':
      return PALETTE.ranged
    case 'brute':
      return PALETTE.brute
    default:
      return PALETTE.player
  }
}

function applyHitFlash(view: ActorView, actor: Actor): void {
  const material = view.body.material
  if (actor.hitFlash > 0) {
    material.emissive.setHex(0xffffff)
    material.emissiveIntensity = actor.hitFlash * 5
  } else {
    material.emissiveIntensity = 0
  }
  const chilled = actor.ailments.some((a) => a.kind === 'chilled')
  const ignited = actor.ailments.some((a) => a.kind === 'ignited')
  if (chilled) material.color.setHex(PALETTE.cold)
  else if (ignited) material.color.setHex(PALETTE.fire)
  else material.color.copy(view.baseColour)
}

/** The wind-up tell: a monster swells right before it commits to a hit. */
function applyWindupTell(view: ActorView, actor: Actor): void {
  if (actor.kind === 'player' || actor.windup <= 0 || !actor.pendingCast) {
    view.group.scale.setScalar(1)
    return
  }
  view.group.scale.setScalar(1 + Math.min(0.22, actor.windup * 0.35))
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
  const colour = ground.item.rarity === 'rare' ? PALETTE.rare : ground.item.rarity === 'magic' ? PALETTE.magic : 0xa9a396
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 }),
  )
  beam.position.set(ground.pos.x, 0.7, ground.pos.y)
  return beam
}

function createOrbMesh(orb: Orb): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.24, 0),
    new THREE.MeshStandardMaterial({ color: PALETTE.orb, emissive: PALETTE.orb, emissiveIntensity: 1.8 }),
  )
  mesh.position.set(orb.pos.x, 0.55, orb.pos.y)
  return mesh
}
