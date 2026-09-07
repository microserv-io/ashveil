import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildScenery, disposeScenery } from '../src/world/scenery'
import { validateSceneryKit } from '../src/world/scenery-kit'
import { LANDMARKS, PATHS, SOLIDS } from '../src/world/world-data'
import { heightAt } from '../src/world/terrain'

describe('first-zone scenery', () => {
  const atlasSize = 2048
  const kit = (): ReturnType<typeof validateSceneryKit> => {
    const scene = new THREE.Scene()
    const texture = (name: string, colorSpace: THREE.ColorSpace = THREE.NoColorSpace): THREE.Texture => {
      const atlas = new THREE.Texture({ width: atlasSize, height: atlasSize })
      atlas.name = name
      atlas.colorSpace = colorSpace
      atlas.flipY = false
      return atlas
    }
    const baseColor = texture('scenery-atlas-basecolor.png', THREE.SRGBColorSpace)
    const normal = texture('scenery-atlas-normal.png')
    const orm = texture('scenery-atlas-orm.png')
    const material = new THREE.MeshStandardMaterial({
      map: baseColor,
      normalMap: normal,
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      vertexColors: true,
    })
    material.name = 'scenery_pbr_atlas'
    for (const [name, radius] of [['refuge_hall', 6], ['cottage', 4], ['alder_tree', 1.1], ['orchard_tree', 1.1]] as const) {
      const geometry = new THREE.BoxGeometry(radius, 3, radius)
      geometry.translate(0, 1, 0)
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5), 3))
      const mesh = new THREE.Mesh(geometry, material)
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
    let sourceMaterialDisposed = false
    let sourceTextureDisposals = 0
    sourceKit.refuge_hall.geometry.addEventListener('dispose', () => { templateDisposed = true })
    sourceKit.refuge_hall.material.addEventListener('dispose', () => { sourceMaterialDisposed = true })
    const sourceTextures = [
      sourceKit.refuge_hall.material.map!,
      sourceKit.refuge_hall.material.normalMap!,
      sourceKit.refuge_hall.material.roughnessMap!,
    ]
    sourceTextures.forEach((texture) => texture.addEventListener('dispose', () => { sourceTextureDisposals += 1 }))
    const scenery = buildScenery(scene, { heightAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS, kit: sourceKit })

    const meshes: THREE.Mesh[] = []
    scenery.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    expect(meshes.filter((mesh) => mesh instanceof THREE.InstancedMesh)).toHaveLength(4)
    const batches = meshes.filter((mesh): mesh is THREE.InstancedMesh => mesh instanceof THREE.InstancedMesh)
    let batchMaterialDisposals = 0
    for (const batch of batches) {
      const material = batch.material as THREE.MeshStandardMaterial
      expect(material).not.toBe(sourceKit.refuge_hall.material)
      expect([material.map, material.normalMap, material.roughnessMap]).toEqual(sourceTextures)
      material.addEventListener('dispose', () => { batchMaterialDisposals += 1 })
    }
    expect(scene.children).toContain(scenery.root)
    expect(scenery.cameraOccluders.map((object) => object.name)).toEqual([
      'first-zone-scenery', 'kit-refuge_hall', 'kit-cottage', 'camera-tree-proxies',
    ])

    disposeScenery(scenery)
    expect(scene.children).not.toContain(scenery.root)
    expect(templateDisposed).toBe(false)
    expect(sourceMaterialDisposed).toBe(false)
    expect(sourceTextureDisposals).toBe(0)
    expect(batchMaterialDisposals).toBe(4)

    const rebuilt = buildScenery(scene, { heightAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS, kit: sourceKit })
    expect(rebuilt.root.children).toHaveLength(2)
    const rebuiltCottage = rebuilt.root.getObjectByName('kit-cottage') as THREE.InstancedMesh
    expect((rebuiltCottage.material as THREE.MeshStandardMaterial).map).toBe(sourceTextures[0])
    disposeScenery(rebuilt)
    expect(sourceTextureDisposals).toBe(0)
  })
})
