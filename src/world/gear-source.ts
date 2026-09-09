import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  starterGearMaterialDyeChannel,
  validateStarterGearManifest,
  validateStarterGearTemplate,
  type StarterGearTemplate,
} from './starter-gear-source'

export const GEAR_SET_IDS = ['starter-leather', 'arcane-mage-tier'] as const
export type GearSetId = (typeof GEAR_SET_IDS)[number]

export const VISUAL_GEAR_SLOTS = [
  'head', 'shoulders', 'chest', 'hands', 'waist', 'legs', 'boots', 'back',
] as const
export type VisualGearSlot = (typeof VISUAL_GEAR_SLOTS)[number]

export const GEAR_DYE_CHANNELS = ['primary', 'trim'] as const
export type GearDyeChannel = (typeof GEAR_DYE_CHANNELS)[number]
export type GearMaterial = THREE.MeshStandardMaterial
export type GearMesh = THREE.Mesh<THREE.BufferGeometry, GearMaterial | GearMaterial[]>

export const MAX_GEAR_SET_TRIANGLES = 120_000
export const MAX_GEAR_SET_MATERIALS = 64
export const MAX_GEAR_SET_DRAW_CALLS = 256
export const MAX_GEAR_SET_INSTANCE_MATERIALS = 128

const STARTER_VISUAL_SLOTS = ['chest', 'waist', 'legs', 'boots'] as const
const EXPECTED_SLOTS: Readonly<Record<GearSetId, readonly VisualGearSlot[]>> = {
  'starter-leather': STARTER_VISUAL_SLOTS,
  'arcane-mage-tier': VISUAL_GEAR_SLOTS,
}
const BODY_ID = 'masculine-clean-v1'
const EPSILON = 1e-5

export interface GearPartManifest {
  readonly node: string
  readonly deformation: { readonly kind: 'skinned' } | { readonly kind: 'rigid'; readonly joint: string }
  readonly triangles: number
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
}

export interface GearSlotManifest {
  readonly slot: VisualGearSlot
  readonly parts: readonly GearPartManifest[]
}

export interface GearMaterialManifest {
  readonly name: string
  readonly dye: GearDyeChannel | null
}

export interface GearSetManifest {
  readonly schema: 'ashveil.gear-set.v2'
  readonly id: GearSetId
  readonly body: typeof BODY_ID
  readonly bodySha256: string
  readonly glb: { readonly file: string; readonly bytes: number; readonly sha256: string }
  readonly jointNames: readonly string[]
  readonly inverseBindSha256: string
  readonly materials: readonly GearMaterialManifest[]
  readonly slots: readonly GearSlotManifest[]
  readonly budget: {
    readonly triangles: number
    readonly sourceMaterials: number
    readonly drawCalls: number
    readonly instanceMaterials: number
  }
}

export interface GearPartTemplate {
  readonly root: THREE.Object3D
  readonly meshes: readonly GearMesh[]
  readonly manifest: GearPartManifest
}

export interface GearSetTemplate {
  readonly scene: THREE.Object3D
  readonly parts: ReadonlyMap<VisualGearSlot, readonly GearPartTemplate[]>
  readonly dyeMaterials: ReadonlyMap<VisualGearSlot, ReadonlyMap<GearDyeChannel, readonly GearMaterial[]>>
  readonly manifest: GearSetManifest
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

export class GearSetSource {
  private readonly pending = new Map<GearSetId, Promise<GearSetTemplate>>()

  constructor(
    private readonly loader: LoaderLike = new GLTFLoader(),
    private readonly fetcher: FetchLike = (url) => fetch(url),
  ) {}

  load(id: GearSetId): Promise<GearSetTemplate> {
    if (!GEAR_SET_IDS.includes(id)) return Promise.reject(new Error(`Gear set id is not in the trusted catalog: ${String(id)}.`))
    const existing = this.pending.get(id)
    if (existing) return existing
    const pending = this.loadSet(id).catch((cause: unknown) => {
      this.pending.delete(id)
      const detail = cause instanceof Error ? ` ${cause.message}` : ''
      throw new Error(`Could not load gear set ${id}.${detail}`, { cause })
    })
    this.pending.set(id, pending)
    return pending
  }

  private async loadSet(id: GearSetId): Promise<GearSetTemplate> {
    const folder = `/gear/${id}/`
    const manifestResponse = await this.fetcher(`${folder}${id}.manifest.json`)
    if (!manifestResponse.ok) throw new Error(`Gear manifest request failed: ${id}.`)
    const rawManifest = await manifestResponse.json()
    const legacy = id === 'starter-leather' && isRecord(rawManifest) && rawManifest.schema === 'ashveil.starter-gear.v1'
    if (legacy) {
      const manifest = validateStarterGearManifest(rawManifest)
      const glbResponse = await this.fetcher(`${folder}${manifest.glb.file}`)
      if (!glbResponse.ok) throw new Error(`Gear model request failed: ${id}.`)
      const data = await glbResponse.arrayBuffer()
      if (data.byteLength !== manifest.glb.bytes) throw new Error(`Gear model byte count does not match its manifest: ${id}.`)
      if (sha256Hex(data) !== manifest.glb.sha256) throw new Error(`Gear model SHA-256 does not match its manifest: ${id}.`)
      const gltf = await this.loader.parseAsync(data, folder)
      return adaptStarterGearTemplate(validateStarterGearTemplate(gltf, manifest))
    }
    const manifest = validateGearSetManifest(rawManifest, id)
    const glbResponse = await this.fetcher(`${folder}${manifest.glb.file}`)
    if (!glbResponse.ok) throw new Error(`Gear model request failed: ${id}.`)
    const data = await glbResponse.arrayBuffer()
    if (data.byteLength !== manifest.glb.bytes) throw new Error(`Gear model byte count does not match its manifest: ${id}.`)
    if (sha256Hex(data) !== manifest.glb.sha256) throw new Error(`Gear model SHA-256 does not match its manifest: ${id}.`)
    validateGearGlbBytes(data, manifest)
    const gltf = await this.loader.parseAsync(data, folder)
    return validateGearSetTemplate(gltf, manifest)
  }
}

const sharedSource = new GearSetSource()
export function loadGearSet(id: GearSetId): Promise<GearSetTemplate> { return sharedSource.load(id) }

export function validateGearSetManifest(value: unknown, expectedId?: GearSetId): GearSetManifest {
  if (!isRecord(value)) throw new Error('Gear set manifest is not an object.')
  const manifest = value as unknown as GearSetManifest
  if (manifest.schema !== 'ashveil.gear-set.v2' || !GEAR_SET_IDS.includes(manifest.id)
    || (expectedId !== undefined && manifest.id !== expectedId) || manifest.body !== BODY_ID
    || manifest.glb?.file !== `${manifest.id}.glb` || !positiveInteger(manifest.glb.bytes)
    || !validSha256(manifest.glb.sha256) || !validSha256(manifest.bodySha256)
    || !validSha256(manifest.inverseBindSha256)) {
    throw new Error('Gear set manifest identity is invalid.')
  }
  if (!Array.isArray(manifest.jointNames) || manifest.jointNames.length !== 68
    || manifest.jointNames.some((name) => typeof name !== 'string' || name.length === 0)
    || new Set(manifest.jointNames).size !== manifest.jointNames.length
    || new Set(manifest.jointNames.map(runtimeName)).size !== manifest.jointNames.length) {
    throw new Error('Gear set joint manifest is invalid.')
  }
  if (!Array.isArray(manifest.slots) || manifest.slots.length !== EXPECTED_SLOTS[manifest.id].length
    || manifest.slots.some((slot) => !isRecord(slot))) {
    throw new Error('Gear set slot manifest is incomplete.')
  }
  const slots = new Map(manifest.slots.map((slot) => [slot.slot, slot]))
  if (slots.size !== manifest.slots.length || EXPECTED_SLOTS[manifest.id].some((slot) => !slots.has(slot))
    || [...slots.keys()].some((slot) => !VISUAL_GEAR_SLOTS.includes(slot))) {
    throw new Error('Gear set slot names are invalid.')
  }
  const nodes = new Set<string>()
  let triangles = 0
  for (const slot of manifest.slots) {
    if (!Array.isArray(slot.parts) || slot.parts.length === 0 || slot.parts.some((part: unknown) => !isRecord(part))) {
      throw new Error(`Gear set slot has no valid parts: ${slot.slot}.`)
    }
    for (const part of slot.parts) {
      if (typeof part.node !== 'string' || part.node.length === 0 || nodes.has(part.node)
        || !positiveInteger(part.triangles) || !validBounds(part.bounds) || !isRecord(part.deformation)
        || (part.deformation.kind !== 'skinned' && part.deformation.kind !== 'rigid')
        || (part.deformation.kind === 'rigid'
          && (typeof part.deformation.joint !== 'string' || !manifest.jointNames.includes(part.deformation.joint)))) {
        throw new Error(`Gear set part manifest is invalid: ${slot.slot}.`)
      }
      nodes.add(part.node)
      triangles += part.triangles
    }
  }
  if (new Set([...nodes].map(runtimeName)).size !== nodes.size) throw new Error('Gear set part names collide at runtime.')
  if (!Array.isArray(manifest.materials) || manifest.materials.length === 0
    || manifest.materials.some((material) => !isRecord(material)
      || typeof material.name !== 'string' || material.name.length === 0
      || (material.dye !== null && !GEAR_DYE_CHANNELS.includes(material.dye as GearDyeChannel)))) {
    throw new Error('Gear set material manifest is invalid.')
  }
  if (new Set(manifest.materials.map((material) => material.name)).size !== manifest.materials.length) {
    throw new Error('Gear set material names must be unique.')
  }
  if (!isRecord(manifest.budget) || manifest.budget.triangles !== triangles
    || manifest.budget.sourceMaterials !== manifest.materials.length
    || !positiveInteger(manifest.budget.drawCalls) || !positiveInteger(manifest.budget.instanceMaterials)
    || triangles > MAX_GEAR_SET_TRIANGLES || manifest.budget.sourceMaterials > MAX_GEAR_SET_MATERIALS
    || manifest.budget.drawCalls > MAX_GEAR_SET_DRAW_CALLS
    || manifest.budget.instanceMaterials > MAX_GEAR_SET_INSTANCE_MATERIALS) {
    throw new Error('Gear set budget is invalid.')
  }
  return manifest
}

export function validateGearSetTemplate(
  gltf: { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] },
  manifest: GearSetManifest,
): GearSetTemplate {
  if (gltf.animations.length !== 0) throw new Error('Gear sets must not contain animations.')
  if (!identityTransform(gltf.scene)) throw new Error('Gear set scene root must have an identity transform.')
  gltf.scene.updateMatrixWorld(true)
  const sceneMeshes: GearMesh[] = []
  let cameraOrLight = false
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Camera || object instanceof THREE.Light) cameraOrLight = true
    if (object instanceof THREE.Mesh) sceneMeshes.push(object as GearMesh)
  })
  if (cameraOrLight) throw new Error('Gear sets must not contain cameras or lights.')

  const materialRecords = new Map(manifest.materials.map((record) => [record.name, record]))
  const sourceMaterials = new Set<GearMaterial>()
  const claimedMeshes = new Set<GearMesh>()
  const claimedRoots = new Set<THREE.Object3D>()
  const parts = new Map<VisualGearSlot, readonly GearPartTemplate[]>()
  const dyeMaterials = new Map<VisualGearSlot, ReadonlyMap<GearDyeChannel, readonly GearMaterial[]>>()
  let triangles = 0
  let drawCalls = 0
  let instanceMaterials = 0

  for (const slot of manifest.slots) {
    const slotParts: GearPartTemplate[] = []
    const slotDyes = new Map<GearDyeChannel, GearMaterial[]>(GEAR_DYE_CHANNELS.map((channel) => [channel, []]))
    for (const record of slot.parts) {
      const matches: THREE.Object3D[] = []
      gltf.scene.traverse((object) => { if (object.name === runtimeName(record.node)) matches.push(object) })
      if (matches.length !== 1) throw new Error(`Gear part root is missing or duplicated: ${record.node}.`)
      const root = matches[0]!
      for (const claimed of claimedRoots) {
        if (isAncestor(claimed, root) || isAncestor(root, claimed)) throw new Error(`Gear part roots overlap: ${record.node}.`)
      }
      claimedRoots.add(root)
      const meshes: GearMesh[] = []
      root.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object as GearMesh) })
      if (meshes.length === 0) throw new Error(`Gear part contains no renderable meshes: ${record.node}.`)
      validatePart(root, meshes, record, manifest.jointNames)
      const actual = partMetrics(meshes)
      if (actual.triangles !== record.triangles || !sameVector(actual.bounds.min, record.bounds.min)
        || !sameVector(actual.bounds.max, record.bounds.max)) {
        throw new Error(`Gear part geometry does not match its manifest: ${record.node}.`)
      }
      triangles += actual.triangles
      drawCalls += actual.drawCalls
      for (const mesh of meshes) {
        if (claimedMeshes.has(mesh)) throw new Error(`Gear mesh belongs to more than one part: ${mesh.name}.`)
        claimedMeshes.add(mesh)
        validateRenderableMesh(mesh)
        for (const material of meshMaterials(mesh)) {
          if (!(material instanceof THREE.MeshStandardMaterial) || material.transparent
            || material.opacity !== 1 || material.alphaTest !== 0) {
            throw new Error(`Gear mesh ${mesh.name} must use opaque standard materials.`)
          }
          const materialRecord = materialRecords.get(material.name)
          if (!materialRecord) throw new Error(`Gear material is not declared: ${material.name}.`)
          sourceMaterials.add(material)
          if (materialRecord.dye) slotDyes.get(materialRecord.dye)!.push(material)
        }
      }
      slotParts.push({ root, meshes, manifest: record })
    }
    parts.set(slot.slot, slotParts)
    instanceMaterials += new Set(slotParts.flatMap((part) => part.meshes.flatMap(meshMaterials))).size
    dyeMaterials.set(slot.slot, new Map(GEAR_DYE_CHANNELS.flatMap((channel) => {
      const unique = [...new Set(slotDyes.get(channel)!)]
      return unique.length > 0 ? [[channel, unique] as const] : []
    })))
  }
  if (claimedMeshes.size !== sceneMeshes.length) throw new Error('Gear set contains a mesh outside its declared parts.')
  if (sourceMaterials.size !== manifest.budget.sourceMaterials || triangles !== manifest.budget.triangles
    || drawCalls !== manifest.budget.drawCalls || instanceMaterials !== manifest.budget.instanceMaterials) {
    throw new Error('Gear set runtime budget does not match its manifest.')
  }
  if (new Set([...sourceMaterials].map((material) => material.name)).size !== manifest.materials.length) {
    throw new Error('Gear set material records do not match its loaded materials.')
  }
  return { scene: gltf.scene, parts, dyeMaterials, manifest }
}

export function adaptStarterGearTemplate(template: StarterGearTemplate): GearSetTemplate {
  if (template.manifest.slots.length !== STARTER_VISUAL_SLOTS.length
    || STARTER_VISUAL_SLOTS.some((slot) => !template.meshes.has(slot))) {
    throw new Error('Legacy starter gear must provide exactly four runtime slots.')
  }
  const materials = new Set<GearMaterial>()
  const parts = new Map<VisualGearSlot, readonly GearPartTemplate[]>()
  const dyeMaterials = new Map<VisualGearSlot, ReadonlyMap<GearDyeChannel, readonly GearMaterial[]>>()
  let drawCalls = 0
  let instanceMaterials = 0
  for (const record of template.manifest.slots) {
    const meshes = template.meshes.get(record.slot) ?? []
    const root = template.scene.getObjectByName(runtimeName(record.mesh)) ?? meshes[0]
    if (!root) throw new Error(`Legacy starter gear part is missing: ${record.mesh}.`)
    const gearMeshes = meshes as readonly GearMesh[]
    for (const mesh of gearMeshes) {
      drawCalls += meshMaterials(mesh).length
      for (const material of meshMaterials(mesh)) materials.add(material)
    }
    instanceMaterials += new Set(gearMeshes.flatMap(meshMaterials)).size
    parts.set(record.slot, [{
      root,
      meshes: gearMeshes,
      manifest: { node: record.mesh, deformation: { kind: 'skinned' }, triangles: record.triangles, bounds: record.bounds },
    }])
    const channels = new Map<GearDyeChannel, readonly GearMaterial[]>()
    for (const channel of GEAR_DYE_CHANNELS) {
      const matching = [...materials].filter((material) => starterGearMaterialDyeChannel(material) === channel
        && gearMeshes.some((mesh) => meshMaterials(mesh).includes(material)))
      if (matching.length > 0) channels.set(channel, matching)
    }
    dyeMaterials.set(record.slot, channels)
  }
  const manifest: GearSetManifest = {
    schema: 'ashveil.gear-set.v2',
    id: 'starter-leather',
    body: BODY_ID,
    bodySha256: template.manifest.bodySha256,
    glb: template.manifest.glb,
    jointNames: template.manifest.jointNames,
    inverseBindSha256: template.manifest.inverseBindSha256,
    materials: [...materials].map((material) => ({ name: material.name, dye: starterGearMaterialDyeChannel(material) ?? null })),
    slots: template.manifest.slots.map((record) => ({
      slot: record.slot,
      parts: [{ node: record.mesh, deformation: { kind: 'skinned' }, triangles: record.triangles, bounds: record.bounds }],
    })),
    budget: {
      triangles: template.manifest.budget.triangles,
      sourceMaterials: materials.size,
      drawCalls,
      instanceMaterials,
    },
  }
  return { scene: template.scene, parts, dyeMaterials, manifest }
}

export function sha256Hex(data: ArrayBuffer | Uint8Array): string {
  return bytesToHex(sha256(data instanceof Uint8Array ? data : new Uint8Array(data)))
}

function validatePart(root: THREE.Object3D, meshes: readonly GearMesh[], record: GearPartManifest, jointNames: readonly string[]): void {
  if (record.deformation.kind === 'skinned') {
    let transformedDescendant = false
    root.traverse((object) => { if (!identityTransform(object)) transformedDescendant = true })
    if (transformedDescendant || !sameMatrix(root.matrixWorld, new THREE.Matrix4())) {
      throw new Error(`Skinned gear part ${record.node} must have an identity bind transform.`)
    }
    for (const mesh of meshes) {
      if (!(mesh instanceof THREE.SkinnedMesh)) throw new Error(`Skinned gear part ${record.node} contains a rigid mesh.`)
      validateSkinnedMesh(mesh, jointNames)
    }
    return
  }
  if (root.parent?.name !== runtimeName(record.deformation.joint)) {
    throw new Error(`Rigid gear part ${record.node} is not parented to ${record.deformation.joint}.`)
  }
  let invalidTransform = false
  root.traverse((object) => { if (!finiteTransform(object)) invalidTransform = true })
  if (invalidTransform || meshes.some((mesh) => mesh instanceof THREE.SkinnedMesh)) {
    throw new Error(`Rigid gear part ${record.node} has invalid transform or skinning.`)
  }
}

function validateSkinnedMesh(mesh: THREE.SkinnedMesh, jointNames: readonly string[]): void {
  if (!identityTransform(mesh) || !sameMatrix(mesh.matrixWorld, new THREE.Matrix4())) {
    throw new Error(`Skinned gear mesh ${mesh.name} must have an identity bind transform.`)
  }
  const position = mesh.geometry.getAttribute('position')
  const normal = mesh.geometry.getAttribute('normal')
  const uv = mesh.geometry.getAttribute('uv')
  const indices = mesh.geometry.getAttribute('skinIndex')
  const weights = mesh.geometry.getAttribute('skinWeight')
  if (!position || !normal || !uv || !indices || !weights || normal.count !== position.count || uv.count !== position.count
    || indices.count !== position.count || weights.count !== position.count || indices.itemSize !== 4 || weights.itemSize !== 4) {
    throw new Error(`Skinned gear mesh ${mesh.name} is missing compatible render or skin attributes.`)
  }
  validateFiniteAttribute(position, mesh.name)
  validateFiniteAttribute(normal, mesh.name)
  validateFiniteAttribute(uv, mesh.name)
  validateSkin(indices, weights, jointNames.length, mesh.name)
  const expected = jointNames.map(runtimeName)
  const names = mesh.skeleton.bones.map((bone) => bone.name)
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new Error(`Skinned gear mesh ${mesh.name} joint order does not match its manifest.`)
  }
  if (mesh.skeleton.boneInverses.length !== expected.length
    || mesh.skeleton.boneInverses.some((matrix) => !matrix.elements.every(Number.isFinite))) {
    throw new Error(`Skinned gear mesh ${mesh.name} has invalid inverse binds.`)
  }
}

function partMetrics(meshes: readonly GearMesh[]): { triangles: number; drawCalls: number; bounds: THREE.Box3 } {
  const bounds = new THREE.Box3()
  let triangles = 0
  let drawCalls = 0
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    if (!position) throw new Error(`Gear mesh ${mesh.name} has no positions.`)
    const meshTriangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3
    if (!Number.isInteger(meshTriangles)) throw new Error(`Gear mesh ${mesh.name} has invalid triangles.`)
    triangles += meshTriangles
    drawCalls += Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1
    mesh.geometry.computeBoundingBox()
    if (!mesh.geometry.boundingBox) throw new Error(`Gear mesh ${mesh.name} has no bounds.`)
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
  }
  return { triangles, drawCalls, bounds }
}

function validateRenderableMesh(mesh: GearMesh): void {
  if (Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0)
    || (mesh.morphTargetInfluences?.length ?? 0) > 0) {
    throw new Error(`Gear mesh ${mesh.name} must not contain morph targets.`)
  }
  if (!Array.isArray(mesh.material)) return
  const groups = mesh.geometry.groups
  const elementCount = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0
  if (mesh.material.length === 0 || groups.length !== mesh.material.length
    || new Set(groups.map((group) => group.materialIndex)).size !== mesh.material.length) {
    throw new Error(`Gear mesh ${mesh.name} material groups do not match its materials.`)
  }
  let cursor = 0
  for (const group of [...groups].sort((left, right) => left.start - right.start)) {
    if (!Number.isInteger(group.start) || !Number.isInteger(group.count) || group.start !== cursor
      || group.count <= 0 || group.count % 3 !== 0 || !Number.isInteger(group.materialIndex)
      || group.materialIndex! < 0 || group.materialIndex! >= mesh.material.length) {
      throw new Error(`Gear mesh ${mesh.name} has invalid material groups.`)
    }
    cursor += group.count
  }
  if (cursor !== elementCount) throw new Error(`Gear mesh ${mesh.name} material groups do not cover its geometry.`)
}

interface RawGlb {
  readonly json: RawGlbDocument
  readonly binary: Uint8Array
}

interface RawGlbDocument {
  readonly nodes: readonly {
    readonly name?: string
    readonly mesh?: number
    readonly skin?: number
    readonly children?: readonly number[]
    readonly matrix?: readonly number[]
    readonly translation?: readonly number[]
    readonly rotation?: readonly number[]
    readonly scale?: readonly number[]
  }[]
  readonly meshes: readonly { readonly primitives: readonly RawPrimitive[] }[]
  readonly materials?: readonly { readonly name?: string }[]
  readonly buffers?: readonly { readonly uri?: string }[]
  readonly images?: readonly { readonly uri?: string; readonly bufferView?: number }[]
  readonly skins: readonly { readonly joints: readonly number[]; readonly inverseBindMatrices?: number }[]
  readonly accessors: readonly RawAccessor[]
  readonly bufferViews: readonly { readonly buffer?: number; readonly byteOffset?: number; readonly byteLength: number; readonly byteStride?: number }[]
  readonly animations?: readonly unknown[]
  readonly cameras?: readonly unknown[]
}

interface RawPrimitive {
  readonly mode?: number
  readonly material?: number
  readonly indices?: number
  readonly targets?: readonly Readonly<Record<string, number>>[]
  readonly attributes: Readonly<Record<string, number>>
}

interface RawAccessor {
  readonly bufferView: number
  readonly byteOffset?: number
  readonly componentType: number
  readonly count: number
  readonly type: string
  readonly normalized?: boolean
  readonly sparse?: unknown
}

function validateGearGlbBytes(data: ArrayBuffer, manifest: GearSetManifest): void {
  const { json, binary } = parseGlb(data)
  if (json.animations?.length || json.cameras?.length) throw new Error('Gear GLB must not contain animations or cameras.')
  validateSelfContainedGearDocument(json)
  const parents = validateRawNodeHierarchy(json.nodes)
  const claimedRenderNodes = new Set<number>()
  const claimedSubtreeNodes = new Set<number>()
  const usedMaterials = new Set<number>()
  const usedSkins = new Set<number>()
  let drawCalls = 0

  for (const slot of manifest.slots) for (const part of slot.parts) {
    const matches = json.nodes.flatMap((node, index) => node.name === part.node ? [index] : [])
    if (matches.length !== 1) throw new Error(`Gear GLB part root is missing or duplicated: ${part.node}.`)
    const root = matches[0]!
    const subtree = rawSubtree(json, root)
    if (subtree.some((node) => claimedSubtreeNodes.has(node))) throw new Error(`Gear GLB part roots overlap: ${part.node}.`)
    subtree.forEach((node) => claimedSubtreeNodes.add(node))
    if (part.deformation.kind === 'skinned' && subtree.some((node) => !identityRawTransform(json.nodes[node]!))) {
      throw new Error(`Skinned gear GLB part ${part.node} has a non-identity bind transform.`)
    }
    if (part.deformation.kind === 'rigid' && subtree.some((node) => !finiteRawTransform(json.nodes[node]!))) {
      throw new Error(`Rigid gear GLB part ${part.node} has a non-finite transform.`)
    }
    if (part.deformation.kind === 'rigid') {
      const parent = parents.get(root)
      if (parent === undefined || json.nodes[parent]?.name !== part.deformation.joint) {
        throw new Error(`Rigid gear GLB part ${part.node} is not parented to ${part.deformation.joint}.`)
      }
    }
    for (const nodeIndex of subtree) {
      const node = json.nodes[nodeIndex]!
      if (node.mesh === undefined) continue
      claimedRenderNodes.add(nodeIndex)
      const mesh = json.meshes[node.mesh]
      if (!mesh?.primitives.length) throw new Error(`Gear GLB node has no primitives: ${node.name ?? nodeIndex}.`)
      if (part.deformation.kind === 'skinned' && node.skin === undefined) throw new Error(`Skinned gear GLB node has no skin: ${node.name}.`)
      if (part.deformation.kind === 'rigid' && node.skin !== undefined) throw new Error(`Rigid gear GLB node has a skin: ${node.name}.`)
      if (node.skin !== undefined) usedSkins.add(node.skin)
      for (const primitive of mesh.primitives) {
        if ((primitive.mode ?? 4) !== 4 || primitive.material === undefined || primitive.targets?.length) {
          throw new Error(`Gear GLB node has an invalid primitive or morph target: ${node.name}.`)
        }
        usedMaterials.add(primitive.material)
        drawCalls += 1
        if (part.deformation.kind === 'skinned') validateRawSkinAttributes(json, binary, primitive, json.skins[node.skin!]!.joints.length)
      }
    }
  }
  const renderNodes = json.nodes.flatMap((node, index) => node.mesh === undefined ? [] : [index])
  if (claimedRenderNodes.size !== renderNodes.length || renderNodes.some((node) => !claimedRenderNodes.has(node))) {
    throw new Error('Gear GLB contains a mesh outside its declared parts.')
  }
  if (usedSkins.size !== 1) throw new Error('Gear GLB skinned parts must share exactly one skin.')
  for (const skinIndex of usedSkins) {
    const skin = json.skins[skinIndex]
    if (!skin || skin.inverseBindMatrices === undefined) throw new Error('Gear GLB skin has no inverse binds.')
    const names = skin.joints.map((node) => json.nodes[node]?.name ?? '')
    if (names.length !== manifest.jointNames.length || names.some((name, index) => name !== manifest.jointNames[index])) {
      throw new Error('Gear GLB joint order does not match its manifest.')
    }
    validateRawInverseBinds(json, binary, skin.inverseBindMatrices, skin.joints.length)
    if (sha256Hex(concatBytes(...accessorRows(json, binary, skin.inverseBindMatrices))) !== manifest.inverseBindSha256) {
      throw new Error('Gear GLB inverse binds do not match its manifest.')
    }
    for (const slot of manifest.slots) for (const part of slot.parts) {
      if (part.deformation.kind !== 'rigid') continue
      const root = json.nodes.findIndex((node) => node.name === part.node)
      const jointIndex = manifest.jointNames.indexOf(part.deformation.joint)
      if (parents.get(root) !== skin.joints[jointIndex]) {
        throw new Error(`Rigid gear GLB part ${part.node} is not parented to its declared exported joint.`)
      }
    }
  }
  const materialNames = [...usedMaterials].map((index) => json.materials?.[index]?.name ?? '')
  if (new Set(materialNames).size !== materialNames.length
    || materialNames.some((name) => !manifest.materials.some((record) => record.name === name))
    || manifest.materials.some((record) => !materialNames.includes(record.name))) {
    throw new Error('Gear GLB materials do not match its manifest.')
  }
  const instanceMaterials = manifest.slots.reduce((total, slot) => total + new Set(slot.parts.flatMap((part) => {
    const root = json.nodes.findIndex((node) => node.name === part.node)
    return rawSubtree(json, root).flatMap((nodeIndex) => {
      const meshIndex = json.nodes[nodeIndex]?.mesh
      return meshIndex === undefined ? [] : json.meshes[meshIndex]?.primitives.map((primitive) => primitive.material!) ?? []
    })
  })).size, 0)
  if (usedMaterials.size !== manifest.budget.sourceMaterials || drawCalls !== manifest.budget.drawCalls
    || instanceMaterials !== manifest.budget.instanceMaterials) {
    throw new Error('Gear GLB budget does not match its manifest.')
  }
}

function validateRawSkinAttributes(json: RawGlbDocument, binary: Uint8Array, primitive: RawPrimitive, jointCount: number): void {
  const positionIndex = primitive.attributes.POSITION
  const jointIndex = primitive.attributes.JOINTS_0
  const weightIndex = primitive.attributes.WEIGHTS_0
  if (positionIndex === undefined || jointIndex === undefined || weightIndex === undefined
    || primitive.attributes.JOINTS_1 !== undefined || primitive.attributes.WEIGHTS_1 !== undefined) {
    throw new Error('Gear GLB primitive has incompatible raw skin attributes.')
  }
  const position = json.accessors[positionIndex]
  const joints = json.accessors[jointIndex]
  const weights = json.accessors[weightIndex]
  if (!position || !joints || !weights
    || joints.type !== 'VEC4' || weights.type !== 'VEC4' || ![5121, 5123].includes(joints.componentType)
    || !(weights.componentType === 5126 || ([5121, 5123].includes(weights.componentType) && weights.normalized))
    || joints.count !== position.count || weights.count !== position.count || !positiveInteger(jointCount)) {
    throw new Error('Gear GLB primitive has incompatible raw skin attributes.')
  }
  const jointRows = accessorRows(json, binary, jointIndex)
  const weightRows = accessorRows(json, binary, weightIndex)
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    let sum = 0
    for (let component = 0; component < 4; component += 1) {
      const joint = readComponent(jointRows[vertex]!, component, joints.componentType, false)
      const weight = readComponent(weightRows[vertex]!, component, weights.componentType, !!weights.normalized)
      if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount || !Number.isFinite(weight) || weight < 0) {
        throw new Error(`Gear GLB primitive has malformed raw skin data at vertex ${vertex}.`)
      }
      sum += weight
    }
    if (Math.abs(sum - 1) > 1e-4) throw new Error(`Gear GLB primitive has non-unit raw skin weights at vertex ${vertex}.`)
  }
}

function parseGlb(data: ArrayBuffer): RawGlb {
  const bytes = new Uint8Array(data)
  const view = new DataView(data)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength) throw new Error('Gear file is not a valid GLB 2.0 container.')
  let json: RawGlbDocument | undefined
  let binary: Uint8Array | undefined
  const decoder = new TextDecoder()
  for (let offset = 12; offset < bytes.byteLength;) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const chunk = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(decoder.decode(chunk).trim()) as RawGlbDocument
    if (type === 0x004e4942) binary = chunk
    offset += 8 + length
  }
  if (!json || !binary) throw new Error('Gear GLB must contain JSON and binary chunks.')
  return { json, binary }
}

function accessorRows(json: RawGlbDocument, binary: Uint8Array, accessorIndex: number): Uint8Array[] {
  const accessor = json.accessors[accessorIndex]
  if (!accessor || accessor.sparse) throw new Error(`Gear GLB accessor is missing or sparse: ${accessorIndex}.`)
  const bufferView = json.bufferViews[accessor.bufferView]
  if (!bufferView || (bufferView.buffer ?? 0) !== 0) throw new Error(`Gear GLB accessor has an unsupported buffer: ${accessorIndex}.`)
  const elementBytes = componentBytes(accessor.componentType) * componentCount(accessor.type)
  const stride = bufferView.byteStride ?? elementBytes
  if (stride < elementBytes) throw new Error(`Gear GLB accessor has an invalid stride: ${accessorIndex}.`)
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return Array.from({ length: accessor.count }, (_unused, index) => binary.subarray(
    start + index * stride,
    start + index * stride + elementBytes,
  ))
}

function rawSubtree(json: RawGlbDocument, root: number): number[] {
  const result: number[] = []
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()!
    result.push(node)
    pending.push(...(json.nodes[node]?.children ?? []))
  }
  return result
}

export function validateRawNodeHierarchy(
  nodes: readonly { readonly children?: readonly number[] }[],
): Map<number, number> {
  const parents = new Map<number, number>()
  const indegree = Array.from({ length: nodes.length }, () => 0)
  nodes.forEach((node, parent) => {
    if (node.children !== undefined && !Array.isArray(node.children)) {
      throw new Error(`Gear GLB node ${parent} has invalid children.`)
    }
    for (const child of node.children ?? []) {
      if (!Number.isInteger(child) || child < 0 || child >= nodes.length) {
        throw new Error(`Gear GLB node ${parent} has an invalid child index.`)
      }
      if (parents.has(child)) throw new Error(`Gear GLB node ${child} has more than one parent.`)
      parents.set(child, parent)
      indegree[child]! += 1
    }
  })
  const pending = indegree.flatMap((count, index) => count === 0 ? [index] : [])
  let visited = 0
  while (pending.length > 0) {
    const node = pending.pop()!
    visited += 1
    for (const child of nodes[node]?.children ?? []) {
      indegree[child]! -= 1
      if (indegree[child] === 0) pending.push(child)
    }
  }
  if (visited !== nodes.length) throw new Error('Gear GLB node hierarchy contains a cycle.')
  return parents
}

export function validateSelfContainedGearDocument(document: {
  readonly buffers?: readonly { readonly uri?: string }[]
  readonly images?: readonly { readonly uri?: string; readonly bufferView?: number }[]
}): void {
  if (document.buffers?.length !== 1 || document.buffers.some((buffer) => buffer.uri !== undefined)
    || document.images?.some((image) => image.uri !== undefined || !Number.isInteger(image.bufferView))) {
    throw new Error('Gear GLB must keep buffers and images inside its binary chunk.')
  }
}

function validateRawInverseBinds(
  json: RawGlbDocument,
  binary: Uint8Array,
  accessorIndex: number,
  jointCount: number,
): void {
  const accessor = json.accessors[accessorIndex]
  if (!accessor || accessor.type !== 'MAT4' || accessor.componentType !== 5126 || accessor.count !== jointCount) {
    throw new Error('Gear GLB inverse binds are incompatible with its joints.')
  }
  for (const row of accessorRows(json, binary, accessorIndex)) {
    const view = new DataView(row.buffer, row.byteOffset, row.byteLength)
    for (let offset = 0; offset < row.byteLength; offset += 4) {
      if (!Number.isFinite(view.getFloat32(offset, true))) throw new Error('Gear GLB inverse binds contain non-finite values.')
    }
  }
}

function identityRawTransform(node: RawGlbDocument['nodes'][number]): boolean {
  if (node.matrix !== undefined) return node.matrix.length === 16
    && node.matrix.every((value, index) => Number.isFinite(value) && Math.abs(value - (index % 5 === 0 ? 1 : 0)) <= EPSILON)
  return sameRawVector(node.translation, [0, 0, 0]) && sameRawVector(node.rotation, [0, 0, 0, 1])
    && sameRawVector(node.scale, [1, 1, 1])
}

function finiteRawTransform(node: RawGlbDocument['nodes'][number]): boolean {
  if (node.matrix !== undefined) return node.matrix.length === 16 && node.matrix.every(Number.isFinite)
  return [node.translation, node.rotation, node.scale].every((values) => values === undefined || values.every(Number.isFinite))
}

function sameRawVector(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  if (actual === undefined) return true
  return actual.length === expected.length && actual.every((value, index) => Number.isFinite(value)
    && Math.abs(value - expected[index]!) <= EPSILON)
}

function readComponent(row: Uint8Array, component: number, type: number, normalized: boolean): number {
  const view = new DataView(row.buffer, row.byteOffset, row.byteLength)
  if (type === 5121) { const value = view.getUint8(component); return normalized ? value / 255 : value }
  if (type === 5123) { const value = view.getUint16(component * 2, true); return normalized ? value / 65535 : value }
  if (type === 5126) return view.getFloat32(component * 4, true)
  throw new Error(`Unsupported gear GLB component type: ${type}.`)
}

function componentBytes(type: number): number {
  if (type === 5120 || type === 5121) return 1
  if (type === 5122 || type === 5123) return 2
  if (type === 5125 || type === 5126) return 4
  throw new Error(`Unsupported gear GLB component type: ${type}.`)
}

function componentCount(type: string): number {
  const counts: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  const count = counts[type]
  if (!count) throw new Error(`Unsupported gear GLB accessor type: ${type}.`)
  return count
}

function meshMaterials(mesh: GearMesh): readonly GearMaterial[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function validateSkin(indices: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, weights: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, jointCount: number, mesh: string): void {
  for (let vertex = 0; vertex < weights.count; vertex += 1) {
    const skinIndices = [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)]
    const skinWeights = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)]
    if (skinIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= jointCount)
      || skinWeights.some((weight) => !Number.isFinite(weight) || weight < 0)
      || Math.abs(skinWeights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-4) {
      throw new Error(`Skinned gear mesh ${mesh} has invalid skin indices or weights.`)
    }
  }
}

function validateFiniteAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, mesh: string): void {
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      if (!Number.isFinite(attribute.getComponent(vertex, component))) throw new Error(`Gear mesh ${mesh} has non-finite attributes.`)
    }
  }
}

function isAncestor(parent: THREE.Object3D, child: THREE.Object3D): boolean {
  for (let current = child.parent; current; current = current.parent) if (current === parent) return true
  return false
}

function runtimeName(name: string): string { return THREE.PropertyBinding.sanitizeNodeName(name) }
function finiteTransform(object: THREE.Object3D): boolean {
  return [...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()].every(Number.isFinite)
}
function identityTransform(object: THREE.Object3D): boolean {
  return object.position.lengthSq() < 1e-10 && object.quaternion.angleTo(new THREE.Quaternion()) < EPSILON
    && object.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < EPSILON
}
function sameMatrix(left: THREE.Matrix4, right: THREE.Matrix4): boolean {
  return left.elements.every((value, index) => Number.isFinite(value) && Math.abs(value - right.elements[index]!) <= EPSILON)
}
function sameVector(vector: THREE.Vector3, expected: readonly [number, number, number]): boolean {
  return Math.abs(vector.x - expected[0]) <= EPSILON && Math.abs(vector.y - expected[1]) <= EPSILON
    && Math.abs(vector.z - expected[2]) <= EPSILON
}
function validBounds(value: unknown): value is GearPartManifest['bounds'] {
  if (!isRecord(value) || !validVector(value.min) || !validVector(value.max)) return false
  const minimum = value.min
  const maximum = value.max
  return minimum.every((entry, index) => entry <= maximum[index]!)
}
function validVector(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
}
function validSha256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) }
function positiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
