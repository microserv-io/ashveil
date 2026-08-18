import * as THREE from 'three'
import type { Actor } from '../sim/types'
import { clipsOf, meshesOf, spawnModel, type ModelName } from './models'
import { PALETTE } from './palette'
import { Rig, rigStateOf } from './rig'

/** One actor's body: the model, the handles needed to tint it, and its animation. */
export interface ActorView {
  group: THREE.Group
  materials: THREE.MeshStandardMaterial[]
  baseColours: THREE.Color[]
  rig: Rig
  fadeLeft: number
}

export const DEATH_FADE = 1.6

/**
 * The kit's characters stand ~2.17 model units tall. Scaling by the collision radius
 * keeps the body the size the sim thinks it is, so a brute looks as wide as it walks.
 */
const HEIGHT_PER_RADIUS = 1.93
/** The models face +Z; the sim's zero facing is +X. */
const MODEL_FACING = Math.PI / 2

function modelFor(actor: Actor): ModelName {
  if (actor.kind === 'player') return 'player'
  switch (actor.archetype) {
    case 'swarm':
      return 'swarm'
    case 'ranged':
      return 'ranged'
    case 'brute':
      return 'brute'
    default:
      return 'swarm'
  }
}

export function createActorView(actor: Actor): ActorView {
  const group = new THREE.Group()
  const model = spawnModel(modelFor(actor))
  model.scale.setScalar(actor.radius * HEIGHT_PER_RADIUS)
  group.add(model)

  const materials = meshesOf(model).map((mesh) => mesh.material as THREE.MeshStandardMaterial)
  const baseColours = materials.map((material) => material.color.clone())
  const rig = new Rig(model, clipsOf(modelFor(actor)))
  rig.apply(rigStateOf(actor))

  if (actor.kind === 'player') {
    const lamp = new THREE.PointLight(PALETTE.playerAccent, 3.2, 9, 2)
    lamp.position.set(0, 1.6, 0)
    group.add(lamp)

    // A taller monster standing on top of you would otherwise hide you entirely.
    group.add(groundRing(actor.radius * 1.25, actor.radius * 1.5, PALETTE.playerAccent, 0.85, 5))
  }

  if (actor.rarity !== 'normal') {
    group.add(groundRing(actor.radius * 1.5, actor.radius * 1.9, rarityColour(actor), 0.65, 0))
  }

  return { group, materials, baseColours, rig, fadeLeft: 0 }
}

function rarityColour(actor: Actor): number {
  return actor.rarity === 'rare' ? PALETTE.rare : PALETTE.magic
}

function groundRing(inner: number, outer: number, colour: number, opacity: number, renderOrder: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 28),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthTest: renderOrder === 0,
      side: THREE.DoubleSide,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.05
  ring.renderOrder = renderOrder
  return ring
}

export function orientActorView(view: ActorView, actor: Actor): void {
  view.group.rotation.y = -actor.facing + MODEL_FACING
}

/**
 * Ailments recolour the whole body and a hit whites it out. Materials are cloned per
 * actor in `spawnModel`, so this cannot bleed onto anyone else wearing the same kit.
 */
export function applyHitFlash(view: ActorView, actor: Actor): void {
  const chilled = actor.ailments.some((ailment) => ailment.kind === 'chilled')
  const ignited = actor.ailments.some((ailment) => ailment.kind === 'ignited')

  view.materials.forEach((material, index) => {
    if (actor.hitFlash > 0) {
      material.emissive.setHex(0xffffff)
      material.emissiveIntensity = actor.hitFlash * 5
    } else {
      material.emissiveIntensity = 0
    }
    if (chilled) material.color.setHex(PALETTE.cold)
    else if (ignited) material.color.setHex(PALETTE.fire)
    else material.color.copy(view.baseColours[index]!)
  })
}

/** The wind-up tell: a monster swells right before it commits to a hit. */
export function applyWindupTell(view: ActorView, actor: Actor): void {
  if (actor.kind === 'player' || actor.windup <= 0 || !actor.pendingCast) {
    view.group.scale.setScalar(1)
    return
  }
  view.group.scale.setScalar(1 + Math.min(0.22, actor.windup * 0.35))
}

/** Corpses play their death clip, then dissolve so the floor does not fill up. */
export function applyDeathFade(view: ActorView, delta: number): void {
  view.fadeLeft = view.fadeLeft === 0 ? DEATH_FADE : Math.max(0, view.fadeLeft - delta)
  const remaining = view.fadeLeft / DEATH_FADE
  if (remaining > 0.55) return
  const opacity = remaining / 0.55
  for (const material of view.materials) {
    material.transparent = true
    material.opacity = opacity
  }
}

export function disposeActorView(view: ActorView): void {
  view.rig.dispose()
  for (const material of view.materials) material.dispose()
}
