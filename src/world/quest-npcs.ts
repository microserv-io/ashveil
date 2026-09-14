import * as THREE from 'three'
import type { QuestCategory } from '../quests'
import { ApprovedWorldCharacter, type ApprovedCharacterTemplate } from './approved-character'
import { createExplorer } from './movement'
import { heightAt } from './terrain'
import type { WorldQuestNpcPlacement } from './quest-world-data'
import type { WorldPoint } from './world-data'

export type QuestMarkerStatus = 'available' | 'active' | 'ready'

interface QuestNpcActor {
  readonly character: ApprovedWorldCharacter
  readonly marker: THREE.Group
  readonly label: THREE.Sprite
  readonly placement: WorldQuestNpcPlacement
  readonly mainShape: THREE.Mesh
  readonly sideShape: THREE.Mesh
  readonly statusShapes: Readonly<Record<QuestMarkerStatus, THREE.Group>>
}

export class QuestNpcView {
  private readonly actors = new Map<string, QuestNpcActor>()

  constructor(scene: THREE.Scene, template: ApprovedCharacterTemplate, placements: readonly WorldQuestNpcPlacement[]) {
    const ids = new Set<string>()
    for (const placement of placements) {
      if (ids.has(placement.id)) throw new Error(`duplicate quest NPC placement: ${placement.id}`)
      ids.add(placement.id)
    }
    for (const placement of placements) {
      const character = new ApprovedWorldCharacter(template, {
        ...createExplorer(placement),
        facing: placement.facing,
      })
      character.root.name = `quest-npc-${placement.id}`
      character.root.traverse((object) => {
        if (!(object instanceof THREE.SkinnedMesh)) return
        object.castShadow = placement.castsShadow
        object.frustumCulled = true
      })
      const { marker, mainShape, sideShape, statusShapes } = createMarker()
      marker.name = `quest-marker-${placement.id}`
      marker.position.set(placement.x, heightAt(placement.x, placement.z) + 2.75, placement.z)
      marker.visible = false
      const label = createNameLabel(placement.name)
      label.position.set(placement.x, heightAt(placement.x, placement.z) + 2.22, placement.z)
      label.visible = false
      scene.add(character.root, marker, label)
      this.actors.set(placement.id, { character, marker, label, placement, mainShape, sideShape, statusShapes })
    }
  }

  setMarker(id: string, category: QuestCategory, status: QuestMarkerStatus | null): void {
    const actor = this.actors.get(id)
    if (!actor) return
    actor.marker.visible = status !== null
    if (!status) return
    const color = category === 'main' ? 0xf5c451 : 0x43c7bd
    actor.mainShape.visible = category === 'main'
    actor.sideShape.visible = category === 'side'
    for (const shape of [actor.mainShape, actor.sideShape]) (shape.material as THREE.MeshBasicMaterial).color.setHex(color)
    for (const [kind, shape] of Object.entries(actor.statusShapes)) shape.visible = kind === status
  }

  clearMarkers(): void {
    for (const actor of this.actors.values()) actor.marker.visible = false
  }

  updateLabels(position: WorldPoint): void {
    let first: QuestNpcActor | null = null
    let second: QuestNpcActor | null = null
    let firstDistance = Infinity
    let secondDistance = Infinity
    for (const actor of this.actors.values()) {
      actor.label.visible = false
      if (actor.placement.kind !== 'npc') continue
      const distance = Math.hypot(actor.placement.x - position.x, actor.placement.z - position.z)
      if (distance > 7) continue
      if (distance < firstDistance) {
        second = first
        secondDistance = firstDistance
        first = actor
        firstDistance = distance
      } else if (distance < secondDistance) {
        second = actor
        secondDistance = distance
      }
    }
    if (first) first.label.visible = true
    if (second) second.label.visible = true
  }

  dispose(): void {
    for (const actor of this.actors.values()) {
      actor.character.dispose()
      actor.marker.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      })
      actor.marker.removeFromParent()
      actor.label.material.map?.dispose()
      actor.label.material.dispose()
      actor.label.removeFromParent()
    }
    this.actors.clear()
  }
}

function createNameLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create NPC name label.')
  context.fillStyle = 'rgba(20, 20, 18, 0.82)'
  context.fillRect(0, 6, canvas.width, 52)
  context.strokeStyle = 'rgba(245, 231, 199, 0.35)'
  context.strokeRect(1, 7, canvas.width - 2, 50)
  context.fillStyle = '#faf7ef'
  context.font = '600 25px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(name, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }))
  sprite.scale.set(2.8, 0.7, 1)
  sprite.renderOrder = 10
  return sprite
}

function createMarker(): {
  marker: THREE.Group
  mainShape: THREE.Mesh
  sideShape: THREE.Mesh
  statusShapes: Readonly<Record<QuestMarkerStatus, THREE.Group>>
} {
  const marker = new THREE.Group()
  const material = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false })
  const mainShape = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), material())
  const sideShape = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 8, 20), material())
  mainShape.visible = false
  sideShape.visible = false
  const available = statusGlyph('available')
  const active = statusGlyph('active')
  const ready = statusGlyph('ready')
  marker.add(mainShape, sideShape, available, active, ready)
  return { marker, mainShape, sideShape, statusShapes: { available, active, ready } }
}

function statusGlyph(status: QuestMarkerStatus): THREE.Group {
  const group = new THREE.Group()
  group.position.y = 0.42
  const ink = new THREE.MeshBasicMaterial({ color: 0xfafaf9, depthTest: false, depthWrite: false })
  if (status === 'available') {
    const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 2, 6), ink)
    stem.position.y = 0.08
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ink.clone())
    dot.position.y = -0.1
    group.add(stem, dot)
  } else if (status === 'ready') {
    const upper = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 12, Math.PI * 1.35), ink)
    upper.rotation.z = -0.3
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), ink.clone())
    dot.position.y = -0.12
    group.add(upper, dot)
  } else {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.045), ink)
    group.add(bar)
  }
  return group
}
