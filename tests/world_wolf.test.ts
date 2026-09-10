import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { WolfView } from '../src/world/wolf'
import {
  WOLF_CLIPS,
  WOLF_DIRECTORY,
  WolfSource,
  validateWolfManifest,
  validateWolfTemplate,
  type WolfTemplate,
} from '../src/world/wolf-source'
import { WanderingWolfController } from '../src/world/wandering-wolf'

const ROOT = join(import.meta.dirname, '..')
const DIRECTORY = join(ROOT, 'public', 'creatures', 'wolf')
const MODEL = readFileSync(join(DIRECTORY, 'wolf.glb'))
const MANIFEST = validateWolfManifest(JSON.parse(readFileSync(join(DIRECTORY, 'wolf.manifest.json'), 'utf8')))

function textureLoader(): GLTFLoader {
  return new GLTFLoader().register((parser: GLTFParser) => ({
    name: 'ASHVEIL_test_embedded_wolf_image',
    loadTexture: (textureIndex: number) => {
      const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
      texture.needsUpdate = true
      parser.associations.set(texture, { textures: textureIndex })
      return Promise.resolve(texture)
    },
  }))
}

async function actualTemplate(): Promise<WolfTemplate> {
  const data = MODEL.buffer.slice(MODEL.byteOffset, MODEL.byteOffset + MODEL.byteLength)
  return validateWolfTemplate(await textureLoader().parseAsync(data, ''), MANIFEST)
}

describe('ambient wolf asset and view', () => {
  it('pins the exact reviewed export, clips, material, skeleton, orientation, and rest frame', async () => {
    expect(MODEL.byteLength).toBe(4_561_180)
    expect(createHash('sha256').update(MODEL).digest('hex')).toBe('33834135c5c5856afef9783939b4917f22097170becd527bfe9096a45c71e77d')
    expect(MANIFEST.glb).toEqual({ file: 'wolf.glb', bytes: MODEL.byteLength, sha256: createHash('sha256').update(MODEL).digest('hex') })
    expect(MANIFEST.clips).toEqual([
      { name: 'attack', duration: 1, loop: false },
      { name: 'run', duration: 2 / 3, loop: true },
      { name: 'walk', duration: 1, loop: true },
    ])
    expect(WOLF_CLIPS).toEqual(['attack', 'run', 'walk'])

    const template = await actualTemplate()
    const meshes: THREE.SkinnedMesh[] = []
    template.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
    expect(meshes).toHaveLength(1)
    expect(meshes[0]!.skeleton.bones).toHaveLength(23)
    expect(meshes[0]!.geometry.getAttribute('position').count).toBe(12_901)
    expect(meshes[0]!.geometry.index!.count / 3).toBe(10_536)
    expect(meshes[0]!.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect((meshes[0]!.material as THREE.MeshStandardMaterial).map).toBeTruthy()
    expect(template.restBounds.min.x).toBeCloseTo(-0.16569, 4)
    expect(template.restBounds.min.y).toBeCloseTo(0, 4)
    expect(template.restBounds.min.z).toBeCloseTo(-0.17163, 4)
    expect(template.restBounds.max.x).toBeCloseTo(0.16569, 4)
    expect(template.restBounds.max.y).toBeCloseTo(0.69644, 4)
    expect(template.restBounds.max.z).toBeCloseTo(0.8274, 4)
    expect(template.restCenterZ).toBeCloseTo(0.32789, 4)
    const expectedRootQuaternion = new THREE.Quaternion(...MANIFEST.frame.rootNodeQuaternion)
    expect(template.scene.getObjectByName('RootNode')!.quaternion.angleTo(expectedRootQuaternion)).toBeLessThan(1e-5)
    expect(template.scene.getObjectByName('tripoRoot')).toBeDefined()
    expect(template.animations.every((clip) => clip.tracks.every((track) => track.times[0] === 0))).toBe(true)
    const attack = template.animations.find((clip) => clip.name === 'attack')!
    const rigRoot = template.scene.getObjectByName('tripoRoot')!
    const mixer = new THREE.AnimationMixer(template.scene)
    const action = mixer.clipAction(attack).play()
    action.paused = true
    action.time = 0
    mixer.update(0)
    const start = rigRoot.getWorldPosition(new THREE.Vector3())
    action.time = 0.5
    mixer.update(0)
    const strikeDelta = rigRoot.getWorldPosition(new THREE.Vector3()).sub(start)
    expect(strikeDelta.y).toBeCloseTo(0.054, 3)
    expect(strikeDelta.z).toBeCloseTo(0.15, 3)
    mixer.stopAllAction()
  }, 30_000)

  it('keeps the walk in place while every paw swings forward and lifts', async () => {
    const template = await actualTemplate()
    const mesh = template.scene.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh
    const walk = template.animations.find((clip) => clip.name === 'walk')!
    const mixer = new THREE.AnimationMixer(template.scene)
    const action = mixer.clipAction(walk).play()
    action.paused = true
    action.time = 0
    mixer.update(0)

    const paws = [
      ['fore left', 'tripo0_Left_Limb_3'],
      ['fore right', 'tripo0_Right_Limb_3'],
      ['hind left', 'tripo1_Left_Limb_2'],
      ['hind right', 'tripo1_Right_Limb_1'],
    ] as const
    const patches = paws.map(([name, bone]) => ({ name, vertices: lowWeightedVertices(mesh, bone) }))
    const ranges = patches.map(({ name }) => ({ name, min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity) }))
    const root = template.scene.getObjectByName('tripoRoot')!
    const rootStart = root.getWorldPosition(new THREE.Vector3())

    for (let sample = 0; sample <= 96; sample += 1) {
      action.time = walk.duration * sample / 96
      mixer.update(0)
      template.scene.updateMatrixWorld(true)
      mesh.skeleton.update()
      patches.forEach(({ vertices }, index) => {
        const center = skinnedCenter(mesh, vertices)
        ranges[index]!.min.min(center)
        ranges[index]!.max.max(center)
      })
      expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(rootStart)).toBeLessThan(1e-6)
    }

    for (const { name, min, max } of ranges) {
      const travel = max.clone().sub(min)
      expect(travel.z, `${name} fore-aft stroke`).toBeGreaterThanOrEqual(0.14)
      expect(travel.y, `${name} lift`).toBeGreaterThanOrEqual(0.015)
      expect(travel.z, `${name} sagittal motion`).toBeGreaterThanOrEqual(travel.x * 2)
    }
    for (const track of walk.tracks) {
      const width = track.getValueSize()
      for (let component = 0; component < width; component += 1) {
        expect(Math.abs(track.values[component]! - track.values[track.values.length - width + component]!)).toBeLessThanOrEqual(1e-6)
      }
    }
    mixer.stopAllAction()
  }, 30_000)

  it('evicts a failed load and shares a successful retry', async () => {
    const parsed = await actualTemplate()
    let fail = true
    const fetcher = vi.fn(async (url: string) => {
      if (fail) throw new Error('offline')
      return url.endsWith('.json')
        ? { ok: true, json: async () => MANIFEST, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(MANIFEST.glb.bytes) }
    })
    const loader = { parseAsync: vi.fn(async () => ({ scene: parsed.scene, animations: [...parsed.animations] })) }
    const source = new WolfSource(loader, fetcher)
    await expect(source.load()).rejects.toThrow(/wolf/i)
    fail = false
    const first = source.load()
    expect(source.load()).toBe(first)
    await expect(first).resolves.toMatchObject({ manifest: MANIFEST })
    expect(loader.parseAsync).toHaveBeenCalledWith(expect.any(ArrayBuffer), WOLF_DIRECTORY)
  })

  it('clones the rig and materials, freezes its pose with zero delta, transitions, and resets', async () => {
    const template = await actualTemplate()
    const controller = new WanderingWolfController({ seed: 7 })
    const view = new WolfView(template, controller.state)
    const sourceMesh = template.scene.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh
    const mesh = view.root.getObjectByProperty('type', 'SkinnedMesh') as THREE.SkinnedMesh
    expect(mesh.skeleton.bones[0]).not.toBe(sourceMesh.skeleton.bones[0])
    expect(mesh.geometry).toBe(sourceMesh.geometry)
    expect(mesh.material).not.toBe(sourceMesh.material)
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe((sourceMesh.material as THREE.MeshStandardMaterial).map)
    const restBounds = new THREE.Box3().setFromObject(view.root)
    expect(restBounds.min.y).toBeCloseTo(controller.state.y, 4)
    expect((restBounds.min.z + restBounds.max.z) / 2).toBeCloseTo(controller.state.z, 4)

    view.update(controller.state, 0.1)
    expect(view.animationState.dominantClip).toBe('walk')
    const pose = mesh.skeleton.bones.map((bone) => bone.quaternion.clone())
    view.update(controller.state, 0)
    expect(mesh.skeleton.bones.every((bone, index) => bone.quaternion.equals(pose[index]!))).toBe(true)

    while (controller.state.action !== 'attack') controller.advance(0.1)
    view.update(controller.state, 0.1)
    expect(view.animationState).toMatchObject({ dominantClip: 'attack' })
    const anchor = view.root.position.clone()
    view.update({ ...controller.state, actionTime: 0.5 }, 0.1)
    expect(view.root.position).toEqual(anchor)
    for (let index = 0; index < 10; index += 1) { controller.advance(0.1); view.update(controller.state, 0.1) }
    expect(view.animationState.dominantClip).toBe('walk')
    view.reset(controller.reset())
    expect(view.animationState).toEqual({ dominantClip: 'walk', time: 0 })
    expect(view.root.position.toArray()).toEqual([controller.state.x, controller.state.y, controller.state.z])
    expect(view.root.rotation.y).toBe(controller.state.facing)
    view.dispose()
  }, 30_000)
})

function lowWeightedVertices(mesh: THREE.SkinnedMesh, boneName: string): number[] {
  const boneIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === boneName)
  expect(boneIndex, `missing ${boneName}`).toBeGreaterThanOrEqual(0)
  const positions = mesh.geometry.getAttribute('position')
  const skinIndices = mesh.geometry.getAttribute('skinIndex')
  const skinWeights = mesh.geometry.getAttribute('skinWeight')
  const candidates: { index: number; height: number }[] = []
  mesh.updateMatrixWorld(true)
  mesh.skeleton.update()
  for (let index = 0; index < positions.count; index += 1) {
    let weight = 0
    for (let component = 0; component < 4; component += 1) {
      if (skinIndices.getComponent(index, component) === boneIndex) weight = skinWeights.getComponent(index, component)
    }
    if (weight >= 0.7) candidates.push({ index, height: skinnedVertex(mesh, index).y })
  }
  candidates.sort((left, right) => left.height - right.height)
  const vertices = candidates.slice(0, 24).map(({ index }) => index)
  expect(vertices.length, `low weighted patch for ${boneName}`).toBe(24)
  return vertices
}

function skinnedCenter(mesh: THREE.SkinnedMesh, vertices: readonly number[]): THREE.Vector3 {
  mesh.updateMatrixWorld(true)
  const center = new THREE.Vector3()
  for (const index of vertices) center.add(skinnedVertex(mesh, index))
  return center.multiplyScalar(1 / vertices.length)
}

function skinnedVertex(mesh: THREE.SkinnedMesh, index: number): THREE.Vector3 {
  const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), index)
  mesh.applyBoneTransform(index, vertex)
  return mesh.localToWorld(vertex)
}
