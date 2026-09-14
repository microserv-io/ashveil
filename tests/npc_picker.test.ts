import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { pickNpc, pickNpcFromCamera, type NpcPickCandidate } from '../src/world/npc-picker'

function candidate(id: string, name: string, z: number): NpcPickCandidate {
  const root = new THREE.Group()
  root.position.z = z
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()))
  root.updateMatrixWorld(true)
  return { id, name, root }
}

function blocker(z: number): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1), new THREE.MeshBasicMaterial())
  mesh.position.z = z
  mesh.updateMatrixWorld(true)
  return mesh
}

function ray(): THREE.Raycaster {
  return new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
}

describe('NPC picker', () => {
  it('returns the nearest visible NPC body and its authored name', () => {
    const near = candidate('npc_mara', 'Mara', -4)
    const far = candidate('npc_iven', 'Iven', -7)

    expect(pickNpc(ray(), [far, near], [])).toEqual({ id: 'npc_mara', name: 'Mara' })
  })

  it('does not select an NPC behind a nearer solid or an invisible NPC', () => {
    const hidden = candidate('npc_hidden', 'Hidden', -2)
    hidden.root.visible = false
    const mara = candidate('npc_mara', 'Mara', -5)

    expect(pickNpc(ray(), [hidden, mara], [blocker(-3)])).toBeNull()
  })

  it('does not inherit the short camera-collision ray range', () => {
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600)
    camera.updateMatrixWorld(true)
    const mara = candidate('npc_mara', 'Mara', -18)

    expect(pickNpcFromCamera(camera, new THREE.Vector2(0, 0), [mara], [])).toEqual({ id: 'npc_mara', name: 'Mara' })
  })

  it('ignores blocker geometry whose material is not visible', () => {
    const mara = candidate('npc_mara', 'Mara', -5)
    const proxy = blocker(-3) as THREE.Mesh
    ;(proxy.material as THREE.Material).visible = false

    expect(pickNpc(ray(), [mara], [proxy])).toEqual({ id: 'npc_mara', name: 'Mara' })
  })
})
