import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ProceduralDriver } from '../render/proceduraldriver'
import { MASCULINE_PROFILE } from '../render/profiles/masculine'
import type { RigInput } from '../render/riginput'
import { MAX_FRAME_DELTA, type Explorer } from './movement'

export const WORLD_CHARACTER_URL = '/bodies/masculine-v3/masculine-v3.glb'

const EXPECTED_MESHES = ['Body', 'Facial_Feature_01', 'Facial_Feature_02', 'Facial_Feature_03', 'Facial_Feature_04', 'Head'] as const
const EXPECTED_BONES = [
  ...Object.values(MASCULINE_PROFILE.bones),
  ...Object.values(MASCULINE_PROFILE.optional),
  ...Object.values(MASCULINE_PROFILE.helpers ?? {}),
] as const
const MOVING_SPEED = 0.05

interface LoaderLike {
  loadAsync(url: string): Promise<{ scene: THREE.Object3D }>
}

export interface WorldCharacterTemplate {
  readonly scene: THREE.Object3D
}

export interface CharacterAnimationState {
  readonly state: 'idle' | 'moving'
  readonly speed: number
  readonly time: number
}

export class WorldCharacterSource {
  private pending: Promise<WorldCharacterTemplate> | undefined

  constructor(private readonly loader: LoaderLike = new GLTFLoader()) {}

  load(): Promise<WorldCharacterTemplate> {
    if (this.pending) return this.pending
    this.pending = this.loader.loadAsync(WORLD_CHARACTER_URL)
      .then((gltf) => validateWorldCharacterTemplate(gltf.scene))
      .catch((cause: unknown) => {
        this.pending = undefined
        throw new Error('Could not load the Alderbank explorer.', { cause })
      })
    return this.pending
  }
}

const sharedSource = new WorldCharacterSource()
export function loadWorldCharacter(): Promise<WorldCharacterTemplate> { return sharedSource.load() }

export function validateWorldCharacterTemplate(scene: THREE.Object3D): WorldCharacterTemplate {
  if (!identityTransform(scene)) throw new Error('World character scene root must have an identity transform.')
  scene.updateMatrixWorld(true)

  const meshes: THREE.SkinnedMesh[] = []
  scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
  if (meshes.length !== EXPECTED_MESHES.length
    || meshes.some((mesh) => !EXPECTED_MESHES.includes(mesh.name as (typeof EXPECTED_MESHES)[number]))) {
    throw new Error('World character must contain the six masculine-v3 skinned meshes.')
  }

  const materials = new Set<THREE.MeshStandardMaterial>()
  const textures = new Set<THREE.Texture>()
  for (const mesh of meshes) {
    if (!(mesh.geometry instanceof THREE.BufferGeometry)
      || !mesh.geometry.getAttribute('position') || !mesh.geometry.getAttribute('normal')
      || !mesh.geometry.getAttribute('uv') || !mesh.geometry.getAttribute('skinIndex')
      || !mesh.geometry.getAttribute('skinWeight')) {
      throw new Error(`World character mesh ${mesh.name} is missing skin or render geometry.`)
    }
    if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial) || !mesh.material.map) {
      throw new Error(`World character mesh ${mesh.name} must use its loaded base-colour material.`)
    }
    if (mesh.skeleton.bones.length !== 24) throw new Error(`World character mesh ${mesh.name} has an invalid skeleton.`)
    materials.add(mesh.material)
    textures.add(mesh.material.map)
  }
  if (materials.size !== 1 || textures.size !== 1) throw new Error('World character meshes must share one loaded material and texture.')

  const texture = [...textures][0]!
  const image = texture.image as { width?: unknown; height?: unknown } | undefined
  if (typeof image?.width !== 'number' || !Number.isInteger(image.width) || image.width <= 0
    || typeof image.height !== 'number' || !Number.isInteger(image.height) || image.height <= 0
    || texture.colorSpace !== THREE.SRGBColorSpace) {
    throw new Error('World character must contain its decoded sRGB base-colour texture.')
  }
  const boneNames = new Set<string>()
  scene.traverse((object) => { if (object instanceof THREE.Bone) boneNames.add(object.name) })
  if (boneNames.size !== 24 || EXPECTED_BONES.some((name) => !boneNames.has(name))) {
    throw new Error('World character skeleton does not match masculine-v3.')
  }

  const bounds = new THREE.Box3().setFromObject(scene)
  const size = bounds.getSize(new THREE.Vector3())
  if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    || Math.abs(bounds.min.y) > 1e-4 || Math.abs(size.y - MASCULINE_PROFILE.standingHeight) > 1e-4) {
    throw new Error('World character must stand on the ground at its canonical height.')
  }
  return { scene }
}

export class WorldCharacter {
  readonly root = new THREE.Group()
  private readonly body: THREE.Object3D
  private readonly driver = new ProceduralDriver()
  private readonly materials = new Set<THREE.Material>()
  private readonly input: RigInput = {
    state: 'idle', speed: 0, dashing: false, facingDelta: 0, phase: null,
    hitAge: null, ailments: [], time: 0, seed: 0, castLeft: 0, recovering: false,
  }
  private previousX = 0
  private previousZ = 0
  private previousFacing = 0

  constructor(template: WorldCharacterTemplate, explorer: Explorer) {
    this.root.name = 'world-character'
    this.body = cloneSkinned(template.scene)
    const clonedMaterials = new Map<THREE.Material, THREE.Material>()
    this.body.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      const sourceMaterial = object.material as THREE.Material
      let material = clonedMaterials.get(sourceMaterial)
      if (!material) {
        material = sourceMaterial.clone()
        clonedMaterials.set(sourceMaterial, material)
        this.materials.add(material)
      }
      object.material = material
      object.castShadow = true
      object.receiveShadow = true
      object.frustumCulled = false
    })
    this.root.add(this.body)
    this.driver.bind(this.body, MASCULINE_PROFILE)
    this.reset(explorer)
  }

  get animationState(): CharacterAnimationState {
    return { state: this.input.state === 'moving' ? 'moving' : 'idle', speed: this.input.speed, time: this.input.time }
  }

  update(explorer: Explorer, delta: number): void {
    const seconds = Math.min(Math.max(delta, 0), MAX_FRAME_DELTA)
    const distance = Math.hypot(explorer.x - this.previousX, explorer.z - this.previousZ)
    const speed = seconds > 0 ? distance / seconds : 0
    this.input.state = speed > MOVING_SPEED ? 'moving' : 'idle'
    this.input.speed = speed
    this.input.facingDelta = Math.atan2(
      Math.sin(explorer.facing - this.previousFacing),
      Math.cos(explorer.facing - this.previousFacing),
    )
    this.input.time += seconds
    this.root.position.set(explorer.x, explorer.y, explorer.z)
    this.root.rotation.y = explorer.facing
    this.driver.update(this.input, seconds)
    this.previousX = explorer.x
    this.previousZ = explorer.z
    this.previousFacing = explorer.facing
  }

  reset(explorer: Explorer): void {
    this.driver.reset()
    this.input.state = 'idle'
    this.input.speed = 0
    this.input.facingDelta = 0
    this.input.time = 0
    this.previousX = explorer.x
    this.previousZ = explorer.z
    this.previousFacing = explorer.facing
    this.root.position.set(explorer.x, explorer.y, explorer.z)
    this.root.rotation.y = explorer.facing
    this.driver.update(this.input, 0)
  }

  dispose(): void {
    this.driver.dispose()
    for (const material of this.materials) material.dispose()
    this.root.removeFromParent()
  }
}

function identityTransform(object: THREE.Object3D): boolean {
  return object.position.lengthSq() < 1e-10
    && object.quaternion.angleTo(new THREE.Quaternion()) < 1e-5
    && object.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5
}
