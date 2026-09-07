import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildScenery, disposeScenery } from '../src/world/scenery'
import { validateSceneryKit } from '../src/world/scenery-kit'
import { LANDMARKS, PATHS, SOLIDS } from '../src/world/world-data'
import { heightAt } from '../src/world/terrain'

describe('first-zone scenery', () => {
  const kit = (): ReturnType<typeof validateSceneryKit> => {
    const scene = new THREE.Scene()
    for (const [name, radius] of [['refuge_hall', 6], ['cottage', 4], ['alder_tree', 1.1], ['orchard_tree', 1.1]] as const) {
      const geometry = new THREE.BoxGeometry(radius, 3, radius)
      geometry.translate(0, 1, 0)
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5), 3))
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }))
      mesh.name = name
      mesh.userData = { footprintRadius: radius, templateKind: name, groundedY: 0 }
      scene.add(mesh)
    }
    return validateSceneryKit(scene)
  }

  it('builds one merged mesh per material and disposes cleanly', () => {
    const scene = new THREE.Scene()
    const sourceKit = kit()
    let templateDisposed = false
    sourceKit.refuge_hall.geometry.addEventListener('dispose', () => { templateDisposed = true })
    const scenery = buildScenery(scene, { heightAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS, kit: sourceKit })

    const meshes: THREE.Mesh[] = []
    scenery.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    expect(meshes.filter((mesh) => mesh instanceof THREE.InstancedMesh)).toHaveLength(4)
    expect(scene.children).toContain(scenery.root)
    expect(scenery.cameraOccluders.map((object) => object.name)).toEqual([
      'first-zone-scenery', 'kit-refuge_hall', 'kit-cottage', 'camera-tree-proxies',
    ])

    disposeScenery(scenery)
    expect(scene.children).not.toContain(scenery.root)
    expect(templateDisposed).toBe(false)

    const rebuilt = buildScenery(scene, { heightAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS, kit: sourceKit })
    expect(rebuilt.root.children).toHaveLength(2)
    disposeScenery(rebuilt)
  })
})
