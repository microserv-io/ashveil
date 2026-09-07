import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import {
  buildSceneryKitInstances,
  buildTreeCameraProxies,
  SceneryKitSource,
  validateSceneryKit,
} from '../src/world/scenery-kit'
import { SOLIDS } from '../src/world/world-data'
import { BUILDING_STYLES } from '../src/world/scenery-layout'

const ROOT = join(import.meta.dirname, '..')
const KIT_PATH = join(ROOT, 'public/world/first-zone/scenery-kit.glb')

function prototype(name: string, footprintRadius: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(footprintRadius, 3, footprintRadius)
  geometry.translate(0, 1, 0)
  const color = new Float32Array(geometry.getAttribute('position').count * 3).fill(0.7)
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }))
  mesh.name = name
  mesh.userData = { footprintRadius, templateKind: name, groundedY: 0 }
  return mesh
}

function kitScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.add(prototype('refuge_hall', 6), prototype('cottage', 4), prototype('alder_tree', 1.1), prototype('orchard_tree', 1.1))
  return scene
}

describe('first-zone Blender scenery kit', () => {
  it('parses and validates the shipped GLB', async () => {
    const file = readFileSync(KIT_PATH)
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const gltf = await new GLTFLoader().parseAsync(buffer, '')
    const kit = validateSceneryKit(gltf.scene)
    expect(Object.keys(kit)).toEqual(['refuge_hall', 'cottage', 'alder_tree', 'orchard_tree'])
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public/world/first-zone/scenery-kit.manifest.json'), 'utf8')) as {
      asset: { sha256: string }
    }
    expect(createHash('sha256').update(file).digest('hex')).toBe(manifest.asset.sha256)
  })

  it('creates four instance batches at authoritative solid anchors', () => {
    const kit = validateSceneryKit(kitScene())
    const group = buildSceneryKitInstances(kit, { heightAt: (x, z) => x * 0.01 + z * 0.02, solids: SOLIDS })
    const batches = group.children as THREE.InstancedMesh[]
    expect(batches.map((batch) => [batch.name, batch.count])).toEqual([
      ['kit-refuge_hall', 2], ['kit-cottage', 4], ['kit-alder_tree', 21], ['kit-orchard_tree', 12],
    ])
    const buildingYaws = new Map<string, number>(BUILDING_STYLES.map((building) => [building.id, building.yaw]))
    const expected = [
      SOLIDS.filter((solid) => solid.id === 'refuge-hall' || solid.id === 'farm-barn'),
      SOLIDS.filter((solid) => buildingYaws.has(solid.id) && solid.id !== 'refuge-hall' && solid.id !== 'farm-barn'),
      SOLIDS.filter((solid) => solid.id.startsWith('grove-tree-') || solid.id.startsWith('wild-tree-')),
      SOLIDS.filter((solid) => solid.id.startsWith('orchard-tree-')),
    ]
    expect(expected.flat()).toHaveLength(39)
    batches.forEach((batch, batchIndex) => expected[batchIndex]!.forEach((solid, index) => {
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      const rotation = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      batch.getMatrixAt(index, matrix)
      matrix.decompose(position, rotation, scale)
      expect(position.x).toBeCloseTo(solid.x)
      expect(position.y).toBeCloseTo(solid.x * 0.01 + solid.z * 0.02)
      expect(position.z).toBeCloseTo(solid.z)
      const template = kit[batches[batchIndex]!.name.replace('kit-', '') as keyof typeof kit]
      const expectedScale = Math.min(1, solid.radius / Number(template.userData.footprintRadius))
      expect(scale.x).toBeCloseTo(expectedScale)
      expect(scale.y).toBeCloseTo(scale.x)
      expect(scale.z).toBeCloseTo(scale.x)
      const yaw = new THREE.Euler().setFromQuaternion(rotation, 'YXZ').y
      expect(yaw).toBeCloseTo(buildingYaws.get(solid.id) ?? 0)
    }))
  })

  it('uses raycastable trunk proxies without treating canopies as camera walls', () => {
    const proxies = buildTreeCameraProxies({ heightAt: () => 0, solids: SOLIDS })
    const tree = SOLIDS.find((solid) => solid.id === 'orchard-tree-01')!
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(tree.x, 2.2, tree.z - 8),
      new THREE.Vector3(0, 0, 1),
      0,
      16,
    )
    expect(raycaster.intersectObjects(proxies.children, true).length).toBeGreaterThan(0)
    expect(((proxies.children[0] as THREE.InstancedMesh).material as THREE.Material).visible).toBe(false)
  })

  it('rejects malformed roots before placing any scenery', () => {
    const scene = kitScene()
    const cottage = scene.getObjectByName('cottage') as THREE.Mesh
    cottage.geometry.deleteAttribute('color')
    expect(() => validateSceneryKit(scene)).toThrow(/cottage.*vertex colours/i)
  })

  it('rejects extra or nested template mesh roots', () => {
    const extra = kitScene()
    extra.add(prototype('unused', 1))
    expect(() => validateSceneryKit(extra)).toThrow(/exactly the four direct/i)

    const nested = kitScene()
    const cottage = nested.getObjectByName('cottage')!
    const parent = new THREE.Group()
    parent.position.x = 1
    parent.add(cottage)
    nested.add(parent)
    expect(() => validateSceneryKit(nested)).toThrow(/exactly the four direct/i)
  })

  it('checks real grounding instead of trusting extras', () => {
    const scene = kitScene()
    const hall = scene.getObjectByName('refuge_hall') as THREE.Mesh
    hall.geometry.translate(0, 3, 0)
    expect(() => validateSceneryKit(scene)).toThrow(/ground plane/i)
  })

  it('clears a rejected cached load and retries once requested', async () => {
    let attempts = 0
    const loader = {
      loadAsync: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network unavailable')
        return { scene: kitScene() }
      },
    }
    const source = new SceneryKitSource(loader)
    await expect(source.load()).rejects.toThrow(/could not load/i)
    await expect(source.load()).resolves.toBeDefined()
    await source.load()
    expect(attempts).toBe(2)
  })
})
