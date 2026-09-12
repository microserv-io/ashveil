import * as THREE from 'three'
import type { QuestCategory } from '../quests'
import { heightAt } from './terrain'
import type { WorldQuestTarget } from './quest-host'
import type { QuestMarkerStatus } from './quest-npcs'

export interface VisibleQuestMarker {
  readonly id: string
  readonly category: QuestCategory
  readonly status: QuestMarkerStatus
}

export class QuestTargetView {
  private readonly markers = new Map<string, THREE.Group>()

  constructor(scene: THREE.Scene, targets: readonly WorldQuestTarget[]) {
    for (const target of targets) {
      if (target.kind !== 'prop') continue
      const marker = createAffordance()
      marker.name = `quest-target-${target.id}`
      marker.position.set(target.x, heightAt(target.x, target.z) + 0.08, target.z)
      marker.visible = false
      scene.add(marker)
      this.markers.set(target.id, marker)
    }
  }

  show(visible: readonly VisibleQuestMarker[]): void {
    for (const marker of this.markers.values()) marker.visible = false
    for (const item of visible) {
      const marker = this.markers.get(item.id)
      if (!marker) continue
      marker.visible = true
      const color = item.category === 'main' ? 0xf5c451 : 0x43c7bd
      marker.traverse((object) => {
        if (object instanceof THREE.Mesh) (object.material as THREE.MeshBasicMaterial).color.setHex(color)
      })
      marker.scale.setScalar(item.status === 'ready' ? 1.1 : item.status === 'active' ? 0.9 : 1)
    }
  }
}

function createAffordance(): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 20), material)
  ring.rotation.x = -Math.PI / 2
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.65, 6), material.clone())
  stem.position.y = 0.34
  group.add(ring, stem)
  return group
}
