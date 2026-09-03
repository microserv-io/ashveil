import { readFileSync } from 'node:fs'
import * as THREE from 'three'

/**
 * Reading a fitted GLB from Node, without a DOM or a fetch.
 *
 * The asset gates and the clipping gate both have to look at the bytes the browser
 * will load, and `GLTFLoader` cannot run here. This is the smallest reader that
 * answers the two questions they ask: what does the bone tree look like, and where
 * does every skinned vertex sit.
 */

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

interface GltfNode {
  name?: string
  mesh?: number
  skin?: number
  children?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
}

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  normalized?: boolean
}

interface GltfPrimitive {
  attributes: Record<string, number>
  indices?: number
}

interface Gltf {
  nodes: GltfNode[]
  skins: { joints: number[]; inverseBindMatrices?: number }[]
  meshes: { name?: string; primitives: GltfPrimitive[] }[]
  accessors: GltfAccessor[]
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
}

export interface GlbSkinnedMesh {
  /** The glTF *node* name, which is what `GLTFLoader` puts on the `SkinnedMesh`. */
  readonly name: string
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly indices: Uint32Array
  readonly joints: Uint16Array
  readonly weights: Float32Array
}

export interface GlbSkin {
  /** Joint node names in the skin's own order, which is the order weights index into. */
  readonly jointNames: readonly string[]
  /** Sixteen floats per joint, column-major as glTF stores them. */
  readonly inverseBinds: Float32Array
}

export interface GlbContents {
  readonly meshes: readonly GlbSkinnedMesh[]
  readonly skin: GlbSkin
}

const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

/**
 * The bone tree `GLTFLoader` would build, without a DOM or a fetch.
 *
 * glTF nodes carry their authored TRS, and that is exactly the rest pose the
 * loader hands the renderer before any mixer runs — so a binding tested against
 * this is tested against the skeleton the browser binds against.
 */
export function loadGlbSkeleton(path: string): THREE.Object3D {
  const { json } = parse(path)
  const skinned = new Set((json.skins ?? []).flatMap((skin) => skin.joints))
  const nodes = json.nodes.map((node, at) => {
    const object = skinned.has(at) ? new THREE.Bone() : new THREE.Object3D()
    object.name = node.name ?? ''
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix))
    if (node.translation) object.position.fromArray(node.translation)
    if (node.rotation) object.quaternion.fromArray(node.rotation)
    if (node.scale) object.scale.fromArray(node.scale)
    return object
  })

  const parented = new Set(json.nodes.flatMap((node) => node.children ?? []))
  const root = new THREE.Object3D()
  json.nodes.forEach((node, at) => {
    for (const child of node.children ?? []) nodes[at]!.add(nodes[child]!)
    if (!parented.has(at)) root.add(nodes[at]!)
  })
  root.updateMatrixWorld(true)
  return root
}

/** Every skinned primitive in the file, plus the one skin they all share. */
export function readGlb(path: string): GlbContents {
  const { json, bin } = parse(path)
  const skins = json.skins ?? []
  if (skins.length !== 1) throw new Error(`${path} has ${skins.length} skins, expected exactly one`)
  const skin = skins[0]!

  const meshes: GlbSkinnedMesh[] = []
  json.nodes.forEach((node) => {
    if (node.mesh === undefined || node.skin === undefined) return
    const primitives = json.meshes[node.mesh]!.primitives
    primitives.forEach((primitive, at) => {
      const name = primitives.length === 1 ? (node.name ?? '') : `${node.name ?? ''}#${at}`
      meshes.push(readPrimitive(path, json, bin, name, primitive))
    })
  })

  return {
    meshes,
    skin: {
      jointNames: skin.joints.map((joint) => json.nodes[joint]!.name ?? ''),
      inverseBinds: skin.inverseBindMatrices === undefined
        ? identityBinds(skin.joints.length)
        : new Float32Array(read(json, bin, skin.inverseBindMatrices)),
    },
  }
}

function readPrimitive(
  path: string,
  json: Gltf,
  bin: Buffer,
  name: string,
  primitive: GltfPrimitive,
): GlbSkinnedMesh {
  const attribute = (key: string): number => {
    const at = primitive.attributes[key]
    if (at === undefined) throw new Error(`${path}: mesh "${name}" has no ${key}`)
    return at
  }
  if (primitive.indices === undefined) throw new Error(`${path}: mesh "${name}" is not indexed`)
  return {
    name,
    positions: new Float32Array(read(json, bin, attribute('POSITION'))),
    normals: new Float32Array(read(json, bin, attribute('NORMAL'))),
    indices: new Uint32Array(read(json, bin, primitive.indices)),
    joints: new Uint16Array(read(json, bin, attribute('JOINTS_0'))),
    weights: new Float32Array(read(json, bin, attribute('WEIGHTS_0'))),
  }
}

/** Accessor values, de-interleaved into a plain array so callers can retype freely. */
function read(json: Gltf, bin: Buffer, at: number): number[] {
  const accessor = json.accessors[at]!
  const lanes = COMPONENTS[accessor.type]
  if (lanes === undefined) throw new Error(`unsupported accessor type ${accessor.type}`)
  const out = new Array<number>(accessor.count * lanes).fill(0)
  if (accessor.bufferView === undefined) return out

  const view = json.bufferViews[accessor.bufferView]!
  const size = componentSize(accessor.componentType)
  const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : lanes * size
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  // A normalized accessor stores 0..1 as the integer range, which is how an exporter
  // packs skin weights: read raw and they come back as hundreds.
  const scale = accessor.normalized ? 1 / normalDivisor(accessor.componentType) : 1
  for (let element = 0; element < accessor.count; element++) {
    for (let lane = 0; lane < lanes; lane++) {
      const at = start + element * stride + lane * size
      out[element * lanes + lane] = readComponent(bin, accessor.componentType, at) * scale
    }
  }
  return out
}

function normalDivisor(componentType: number): number {
  switch (componentType) {
    case 5120:
      return 127
    case 5121:
      return 255
    case 5122:
      return 32767
    case 5123:
      return 65535
    default:
      throw new Error(`component type ${componentType} cannot be normalized`)
  }
}

function componentSize(componentType: number): number {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1
    case 5122:
    case 5123:
      return 2
    case 5125:
    case 5126:
      return 4
    default:
      throw new Error(`unsupported component type ${componentType}`)
  }
}

function readComponent(bin: Buffer, componentType: number, at: number): number {
  switch (componentType) {
    case 5120:
      return bin.readInt8(at)
    case 5121:
      return bin.readUInt8(at)
    case 5122:
      return bin.readInt16LE(at)
    case 5123:
      return bin.readUInt16LE(at)
    case 5125:
      return bin.readUInt32LE(at)
    default:
      return bin.readFloatLE(at)
  }
}

function identityBinds(joints: number): Float32Array {
  const out = new Float32Array(joints * 16)
  for (let joint = 0; joint < joints; joint++) {
    for (let lane = 0; lane < 4; lane++) out[joint * 16 + lane * 5] = 1
  }
  return out
}

function parse(path: string): { json: Gltf; bin: Buffer } {
  const file = readFileSync(path)
  let offset = 12
  let json: Gltf | null = null
  let bin: Buffer | null = null
  while (offset + 8 <= file.length) {
    const length = file.readUInt32LE(offset)
    const kind = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (kind === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8').trim())
    else if (kind === BIN_CHUNK) bin = chunk
    offset += 8 + length
  }
  if (!json) throw new Error(`${path} has no JSON chunk`)
  return { json, bin: bin ?? Buffer.alloc(0) }
}
