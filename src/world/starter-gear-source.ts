import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const STARTER_GEAR_ID = 'starter-leather'
export const STARTER_GEAR_FOLDER = `/gear/${STARTER_GEAR_ID}/`
export const STARTER_GEAR_REQUIRED_SLOTS = ['chest', 'legs', 'boots'] as const
export const STARTER_GEAR_SLOTS = ['chest', 'waist', 'legs', 'boots'] as const
export type StarterGearSlot = (typeof STARTER_GEAR_SLOTS)[number]
export const STARTER_GEAR_DYE_CHANNELS = ['primary', 'trim'] as const
export type StarterGearDyeChannel = (typeof STARTER_GEAR_DYE_CHANNELS)[number]
export type StarterGearMaterial = THREE.MeshStandardMaterial
export type StarterGearMesh = THREE.SkinnedMesh<THREE.BufferGeometry, StarterGearMaterial | StarterGearMaterial[]>

const PRIMARY_MATERIAL_NAMES = new Set(['Starter Leather', 'Starter Dark Leather'])
const TRIM_MATERIAL_NAME = 'Starter Trim'
const MAX_TRIANGLES = 30_000
const MAX_MATERIALS = STARTER_GEAR_SLOTS.length * STARTER_GEAR_DYE_CHANNELS.length
const EPSILON = 1e-5

export interface StarterGearSlotManifest {
  readonly slot: StarterGearSlot
  readonly mesh: string
  readonly triangles: number
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
}

export interface StarterGearManifest {
  readonly schema: 'ashveil.starter-gear.v1'
  readonly body: 'masculine-clean-v1'
  readonly bodySha256: string
  readonly glb: { readonly file: 'starter-leather.glb'; readonly bytes: number; readonly sha256: string }
  readonly jointNames: readonly string[]
  readonly inverseBindSha256: string
  readonly slots: readonly StarterGearSlotManifest[]
  readonly budget: { readonly triangles: number; readonly materials: number }
}

export interface StarterGearTemplate {
  readonly scene: THREE.Object3D
  readonly meshes: ReadonlyMap<StarterGearSlot, readonly StarterGearMesh[]>
  readonly dyeChannels: ReadonlyMap<StarterGearSlot, ReadonlySet<StarterGearDyeChannel>>
  readonly manifest: StarterGearManifest
}

interface LoaderLike {
  parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>
}

interface FetchResponseLike {
  readonly ok: boolean
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

type FetchLike = (url: string) => Promise<FetchResponseLike>

export class StarterGearSource {
  private pending: Promise<StarterGearTemplate> | undefined

  constructor(
    private readonly loader: LoaderLike = new GLTFLoader(),
    private readonly fetcher: FetchLike = (url) => fetch(url),
  ) {}

  load(): Promise<StarterGearTemplate> {
    if (this.pending) return this.pending
    this.pending = this.loadGear().catch((cause: unknown) => {
      this.pending = undefined
      throw new Error('Could not load the starter leather gear.', { cause })
    })
    return this.pending
  }

  private async loadGear(): Promise<StarterGearTemplate> {
    const manifestResponse = await this.fetcher(`${STARTER_GEAR_FOLDER}${STARTER_GEAR_ID}.manifest.json`)
    if (!manifestResponse.ok) throw new Error('Starter gear manifest request failed.')
    const manifest = validateStarterGearManifest(await manifestResponse.json())
    const glbResponse = await this.fetcher(`${STARTER_GEAR_FOLDER}${manifest.glb.file}`)
    if (!glbResponse.ok) throw new Error('Starter gear model request failed.')
    const data = await glbResponse.arrayBuffer()
    if (data.byteLength !== manifest.glb.bytes) throw new Error('Starter gear model byte count does not match its manifest.')
    return validateStarterGearTemplate(await this.loader.parseAsync(data, STARTER_GEAR_FOLDER), manifest)
  }
}

const sharedSource = new StarterGearSource()
export function loadStarterGear(): Promise<StarterGearTemplate> { return sharedSource.load() }

export function validateStarterGearManifest(value: unknown): StarterGearManifest {
  if (!isRecord(value)) throw new Error('Starter gear manifest is not an object.')
  const manifest = value as unknown as StarterGearManifest
  if (manifest.schema !== 'ashveil.starter-gear.v1' || manifest.body !== 'masculine-clean-v1'
    || manifest.glb?.file !== 'starter-leather.glb' || !positiveInteger(manifest.glb.bytes)
    || !sha256(manifest.glb.sha256) || !sha256(manifest.bodySha256)
    || !sha256(manifest.inverseBindSha256)) {
    throw new Error('Starter gear manifest identity is invalid.')
  }
  if (!Array.isArray(manifest.jointNames) || manifest.jointNames.length !== 68
    || new Set(manifest.jointNames).size !== manifest.jointNames.length
    || manifest.jointNames.some((name) => typeof name !== 'string' || name.length === 0)) {
    throw new Error('Starter gear joint manifest is invalid.')
  }
  if (!Array.isArray(manifest.slots)
    || manifest.slots.length < STARTER_GEAR_REQUIRED_SLOTS.length
    || manifest.slots.length > STARTER_GEAR_SLOTS.length) {
    throw new Error('Starter gear slot is incomplete.')
  }
  if (manifest.slots.some((slot) => !isRecord(slot))) throw new Error('Starter gear slot manifest is invalid.')
  const slots = new Map(manifest.slots.map((slot) => [slot.slot, slot]))
  validateCompleteSlots(slots, manifest.slots.length)
  for (const slot of STARTER_GEAR_REQUIRED_SLOTS) {
    const record = slots.get(slot)
    if (!record) throw new Error(`Starter gear slot manifest is invalid: ${slot}.`)
  }
  for (const record of manifest.slots) {
    if (typeof record.mesh !== 'string' || record.mesh.length === 0 || !positiveInteger(record.triangles)
      || !validBounds(record.bounds)) throw new Error(`Starter gear slot manifest is invalid: ${record.slot}.`)
  }
  if (new Set(manifest.slots.map((slot) => slot.mesh)).size !== manifest.slots.length) {
    throw new Error('Starter gear mesh names must be unique.')
  }
  const triangles = manifest.slots.reduce((sum, slot) => sum + slot.triangles, 0)
  if (!isRecord(manifest.budget) || manifest.budget.triangles !== triangles || triangles > MAX_TRIANGLES
    || !positiveInteger(manifest.budget.materials) || manifest.budget.materials > MAX_MATERIALS) {
    throw new Error('Starter gear budget is invalid.')
  }
  return manifest
}

export function validateStarterGearTemplate(
  gltf: { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] },
  manifest: StarterGearManifest,
): StarterGearTemplate {
  if (gltf.animations.length !== 0) throw new Error('Starter gear must not contain animations.')
  if (!identityTransform(gltf.scene)) throw new Error('Starter gear scene root must have an identity transform.')
  gltf.scene.updateMatrixWorld(true)
  const sceneMeshes = new Set<StarterGearMesh>()
  let cameraOrLight = false
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Camera || object instanceof THREE.Light) cameraOrLight = true
    if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) {
      throw new Error(`Starter gear object ${object.name} must be a skinned mesh.`)
    }
    if (object instanceof THREE.SkinnedMesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (!(object.geometry instanceof THREE.BufferGeometry) || materials.length === 0
        || materials.length > STARTER_GEAR_DYE_CHANNELS.length
        || materials.some((material) => !(material instanceof THREE.MeshStandardMaterial))) {
        throw new Error(`Starter gear mesh ${object.name} must use one or two standard materials.`)
      }
      sceneMeshes.add(object as StarterGearMesh)
    }
  })
  if (cameraOrLight) throw new Error('Starter gear must not contain cameras or lights.')

  const meshes = new Map<StarterGearSlot, readonly StarterGearMesh[]>()
  const dyeChannels = new Map<StarterGearSlot, ReadonlySet<StarterGearDyeChannel>>()
  const claimedMeshes = new Set<StarterGearMesh>()
  const materials = new Set<THREE.Material>()
  for (const record of manifest.slots) {
    const roots: THREE.Object3D[] = []
    gltf.scene.traverse((object) => { if (object.name === record.mesh) roots.push(object) })
    if (roots.length !== 1) throw new Error(`Starter gear mesh root is missing or duplicated: ${record.mesh}.`)
    const root = roots[0]!
    if (!identityTransform(root) || !sameMatrix(root.matrixWorld, new THREE.Matrix4())) {
      throw new Error(`Starter gear mesh root ${record.mesh} must have an identity transform.`)
    }
    const slotMeshes: StarterGearMesh[] = []
    root.traverse((object) => { if (object instanceof THREE.SkinnedMesh) slotMeshes.push(object as StarterGearMesh) })
    if (slotMeshes.length === 0 || slotMeshes.length > STARTER_GEAR_DYE_CHANNELS.length) {
      throw new Error(`Starter gear slot ${record.slot} must contain one or two skinned primitives.`)
    }
    validateGearSlot(slotMeshes, record, manifest.jointNames)
    meshes.set(record.slot, slotMeshes)
    const channels = new Set<StarterGearDyeChannel>()
    for (const mesh of slotMeshes) {
      if (claimedMeshes.has(mesh)) throw new Error(`Starter gear primitive belongs to more than one slot: ${mesh.name}.`)
      claimedMeshes.add(mesh)
      for (const material of meshMaterials(mesh)) {
        const channel = materialDyeChannel(material)
        if (!channel) throw new Error(`Starter gear material name is not supported: ${material.name}.`)
        if (channels.has(channel)) throw new Error(`Starter gear slot ${record.slot} repeats its ${channel} material.`)
        channels.add(channel)
        materials.add(material)
      }
    }
    if (!channels.has('primary')) throw new Error(`Starter gear slot ${record.slot} has no primary material.`)
    dyeChannels.set(record.slot, channels)
  }
  if (claimedMeshes.size !== sceneMeshes.size) throw new Error('Starter gear contains a mesh outside its declared slots.')
  if (materials.size !== manifest.budget.materials) throw new Error('Starter gear material count does not match its manifest.')
  return { scene: gltf.scene, meshes, dyeChannels, manifest }
}

export function starterGearMaterialDyeChannel(material: StarterGearMaterial): StarterGearDyeChannel | undefined {
  return materialDyeChannel(material)
}

function validateGearSlot(meshes: readonly StarterGearMesh[], record: StarterGearSlotManifest, jointNames: readonly string[]): void {
  let triangles = 0
  const minimum = new THREE.Vector3(Infinity, Infinity, Infinity)
  const maximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (const mesh of meshes) {
    const bounds = validateGearMesh(mesh, jointNames)
    const position = mesh.geometry.getAttribute('position')!
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3
    minimum.min(bounds.min)
    maximum.max(bounds.max)
  }
  if (!Number.isInteger(triangles) || triangles !== record.triangles) {
    throw new Error(`Starter gear slot ${record.slot} triangle count does not match its manifest.`)
  }
  if (!sameVector(minimum, record.bounds.min) || !sameVector(maximum, record.bounds.max)) {
    throw new Error(`Starter gear slot ${record.slot} bounds do not match its manifest.`)
  }
}

function validateGearMesh(mesh: StarterGearMesh, jointNames: readonly string[]): THREE.Box3 {
  if (!identityTransform(mesh) || !sameMatrix(mesh.matrixWorld, new THREE.Matrix4())) {
    throw new Error(`Starter gear mesh ${mesh.name} must have an identity transform.`)
  }
  if (meshMaterials(mesh).some((material) => material.transparent || material.opacity !== 1 || material.alphaTest !== 0)) {
    throw new Error(`Starter gear mesh ${mesh.name} must use an opaque material.`)
  }
  if (Array.isArray(mesh.material) && mesh.geometry.groups.length !== mesh.material.length) {
    throw new Error(`Starter gear mesh ${mesh.name} material slots do not match its primitives.`)
  }
  const position = mesh.geometry.getAttribute('position')
  const normal = mesh.geometry.getAttribute('normal')
  const uv = mesh.geometry.getAttribute('uv')
  const indices = mesh.geometry.getAttribute('skinIndex')
  const weights = mesh.geometry.getAttribute('skinWeight')
  if (!position || !normal || !uv || !indices || !weights || normal.count !== position.count || uv.count !== position.count
    || indices.count !== position.count || weights.count !== position.count || indices.itemSize !== 4 || weights.itemSize !== 4) {
    throw new Error(`Starter gear mesh ${mesh.name} is missing compatible render or skin attributes.`)
  }
  validateFiniteAttribute(position, mesh.name)
  validateFiniteAttribute(normal, mesh.name)
  validateFiniteAttribute(uv, mesh.name)
  validateSkin(indices, weights, jointNames.length, mesh.name)
  const names = mesh.skeleton.bones.map((bone) => bone.name)
  const runtimeJointNames = jointNames.map((name) => THREE.PropertyBinding.sanitizeNodeName(name))
  if (names.length !== runtimeJointNames.length || names.some((name, index) => name !== runtimeJointNames[index])) {
    throw new Error(`Starter gear mesh ${mesh.name} joint order does not match its manifest.`)
  }
  if (mesh.skeleton.boneInverses.length !== jointNames.length
    || mesh.skeleton.boneInverses.some((matrix) => !matrix.elements.every(Number.isFinite))) {
    throw new Error(`Starter gear mesh ${mesh.name} has invalid inverse binds.`)
  }
  mesh.geometry.computeBoundingBox()
  const bounds = mesh.geometry.boundingBox
  if (!bounds) throw new Error(`Starter gear mesh ${mesh.name} has no bounds.`)
  return bounds
}

function meshMaterials(mesh: StarterGearMesh): readonly StarterGearMaterial[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function materialDyeChannel(material: StarterGearMaterial): StarterGearDyeChannel | undefined {
  if (PRIMARY_MATERIAL_NAMES.has(material.name)) return 'primary'
  return material.name === TRIM_MATERIAL_NAME ? 'trim' : undefined
}

function validateSkin(indices: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, weights: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, jointCount: number, mesh: string): void {
  for (let vertex = 0; vertex < weights.count; vertex += 1) {
    const skinIndices = [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)]
    const skinWeights = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)]
    if (skinIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= jointCount)
      || skinWeights.some((weight) => !Number.isFinite(weight) || weight < 0)
      || Math.abs(skinWeights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-4) {
      throw new Error(`Starter gear mesh ${mesh} has invalid skin indices or weights.`)
    }
  }
}

function validateFiniteAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, mesh: string): void {
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      if (!Number.isFinite(attribute.getComponent(vertex, component))) throw new Error(`Starter gear mesh ${mesh} has non-finite attributes.`)
    }
  }
}

function identityTransform(object: THREE.Object3D): boolean {
  return object.position.lengthSq() < 1e-10 && object.quaternion.angleTo(new THREE.Quaternion()) < EPSILON
    && object.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < EPSILON
}

function validBounds(bounds: unknown): bounds is StarterGearSlotManifest['bounds'] {
  if (!isRecord(bounds) || !validVector(bounds.min) || !validVector(bounds.max)) return false
  const minimum = bounds.min
  const maximum = bounds.max
  return minimum.every((value, index) => value <= maximum[index]!)
}

function validVector(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
}

function sameVector(vector: THREE.Vector3, expected: readonly [number, number, number]): boolean {
  return Math.abs(vector.x - expected[0]) <= EPSILON && Math.abs(vector.y - expected[1]) <= EPSILON
    && Math.abs(vector.z - expected[2]) <= EPSILON
}

function sameMatrix(left: THREE.Matrix4, right: THREE.Matrix4): boolean {
  return left.elements.every((value, index) => Number.isFinite(value)
    && Math.abs(value - right.elements[index]!) <= EPSILON)
}

function validateCompleteSlots(slots: Map<StarterGearSlot, StarterGearSlotManifest>, manifestSlotCount: number): void {
  if (slots.size !== manifestSlotCount
    || STARTER_GEAR_REQUIRED_SLOTS.some((slot) => !slots.has(slot))
    || [...slots.keys()].some((slot) => !STARTER_GEAR_SLOTS.includes(slot))) {
    throw new Error('Starter gear slot names are invalid.')
  }
}

function sha256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) }
function positiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
