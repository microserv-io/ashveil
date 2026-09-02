import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

/**
 * The CC0 model set, fetched by `npm run assets` into `public/models`.
 *
 * Names are the role each fills in the sim, never the file it came from, so
 * swapping the underlying kit is a change to `scripts/fetch-assets.mjs` alone.
 */
export const MODEL_NAMES = [
  'player',
  'swarm',
  'ranged',
  'brute',
  'floor',
  'floor_rocks',
  'wall',
  'portal',
  'loot_normal',
  'loot_magic',
  'loot_rare',
  'orb',
] as const

export type ModelName = (typeof MODEL_NAMES)[number]

interface Model {
  scene: THREE.Object3D
  animations: THREE.AnimationClip[]
}

let registry: Map<ModelName, Model> | null = null

/**
 * Must finish before the first frame: every actor and tile needs a mesh, and a
 * half-loaded world is worse than a loading pause.
 */
export async function loadModels(base = 'models', onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader()
  let done = 0
  const loaded = await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${base}/${name}.glb`)
      onProgress?.(++done, MODEL_NAMES.length)
      return [name, { scene: gltf.scene, animations: gltf.animations }] as const
    }),
  )
  registry = new Map(loaded)
}

function model(name: ModelName): Model {
  const found = registry?.get(name)
  if (!found) throw new Error(`model "${name}" used before loadModels() resolved`)
  return found
}

/** The model's bounds in its own units, so a floor can be laid with its top at ground level. */
export function boundsOf(name: ModelName): THREE.Box3 {
  return new THREE.Box3().setFromObject(model(name).scene)
}

export function clipsOf(name: ModelName): THREE.AnimationClip[] {
  return model(name).animations
}

/**
 * A rigged clone: `Object3D.clone()` shares the skeleton, so every copy would be
 * puppeted by whichever mixer ran last.
 */
export function spawnModel(name: ModelName, { castShadow = true } = {}): THREE.Object3D {
  const root = cloneSkinned(model(name).scene)
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = castShadow
    child.receiveShadow = true
    // Cloned so per-actor tinting (hit flash, death fade) cannot bleed across actors.
    child.material = (child.material as THREE.Material).clone()
  })
  return root
}

/** Every mesh in a spawned model, for tinting and fading the whole body at once. */
export function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child)
  })
  return meshes
}

/** One instanced draw per mesh in the source model. Terrain is thousands of tiles. */
export function instancedModel(name: ModelName, placements: readonly THREE.Matrix4[], castShadow: boolean): THREE.Group {
  const group = new THREE.Group()
  if (placements.length === 0) return group

  const source = model(name).scene
  source.updateMatrixWorld(true)
  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mesh = new THREE.InstancedMesh(child.geometry, child.material, placements.length)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    const offset = child.matrixWorld
    placements.forEach((placement, index) => mesh.setMatrixAt(index, placement.clone().multiply(offset)))
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  })
  return group
}
