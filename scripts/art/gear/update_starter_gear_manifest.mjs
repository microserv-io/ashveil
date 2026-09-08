import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const GEAR_DIRECTORY = join(REPOSITORY, 'public', 'gear', 'starter-leather')
const GLB_PATH = join(GEAR_DIRECTORY, 'starter-leather.glb')
const MANIFEST_PATH = join(GEAR_DIRECTORY, 'starter-leather.manifest.json')
const BODY_MANIFEST_PATH = join(REPOSITORY, 'public', 'bodies', 'masculine-clean-v1', 'masculine-clean-v1.manifest.json')
const REQUIRED_SLOTS = ['chest', 'legs', 'boots']
const OPTIONAL_SLOTS = ['waist']
const ALL_SLOTS = ['chest', 'waist', 'legs', 'boots']
const PRIMARY_MATERIALS = new Set(['Starter Leather', 'Starter Dark Leather'])
const TRIM_MATERIAL = 'Starter Trim'

let json
let binary

function updateManifest() {
const file = readFileSync(GLB_PATH)
const parsed = readGlb(file)
json = parsed.json
binary = parsed.binary
const slots = ALL_SLOTS.flatMap((slot) => {
  const matches = json.nodes.filter((node) => node.mesh !== undefined && inferredSlot(node.name) === slot)
  if (matches.length === 0 && OPTIONAL_SLOTS.includes(slot)) return []
  if (matches.length !== 1) throw new Error(`Expected exactly one ${slot} mesh node, found ${matches.length}.`)
  return [inspectSlot(slot, matches[0])]
})
if (json.nodes.filter((node) => node.mesh !== undefined).length !== slots.length) {
  throw new Error('Every exported mesh node must map to one starter gear slot.')
}
if (json.animations?.length) throw new Error('Starter gear GLB must not contain animations.')
if (json.cameras?.length) throw new Error('Starter gear GLB must not contain cameras.')

const skinIndices = new Set(slots.map((slot) => slot.skin))
if (skinIndices.size !== 1) throw new Error('All starter gear slots must share one exported skin.')
const skin = json.skins[[...skinIndices][0]]
if (!skin || skin.inverseBindMatrices === undefined) throw new Error('Starter gear skin has no inverse-bind accessor.')
const jointNames = skin.joints.map((nodeIndex) => json.nodes[nodeIndex]?.name ?? '')
if (jointNames.some((name) => !name) || new Set(jointNames).size !== jointNames.length) {
  throw new Error('Starter gear skin has missing or duplicate joint names.')
}

const bodyManifest = JSON.parse(readFileSync(BODY_MANIFEST_PATH, 'utf8'))
const manifest = {
  schema: 'ashveil.starter-gear.v1',
  body: 'masculine-clean-v1',
  bodySha256: bodyManifest.glb.sha256,
  glb: {
    file: 'starter-leather.glb',
    bytes: file.byteLength,
    sha256: sha256(file),
  },
  jointNames,
  inverseBindSha256: sha256(accessorBytes(skin.inverseBindMatrices)),
  slots: slots.map(({ slot, mesh, triangles, bounds }) => ({ slot, mesh, triangles, bounds })),
  budget: {
    triangles: slots.reduce((total, slot) => total + slot.triangles, 0),
    materials: new Set(slots.flatMap((slot) => slot.materials)).size,
  },
}
const output = `${JSON.stringify(manifest, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(MANIFEST_PATH, 'utf8') !== output) throw new Error('Starter gear manifest is stale. Run npm run art:gear-manifest.')
  console.log('Starter gear manifest matches the manual GLB export.')
} else {
  writeFileSync(MANIFEST_PATH, output)
  console.log(`Updated ${MANIFEST_PATH}`)
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) updateManifest()

function inspectSlot(slot, node) {
  if (node.skin === undefined) throw new Error(`Starter gear slot ${slot} is not skinned.`)
  const mesh = json.meshes[node.mesh]
  if (!mesh?.primitives?.length) throw new Error(`Starter gear slot ${slot} has no mesh primitives.`)
  if (mesh.primitives.length > 2) throw new Error(`Starter gear slot ${slot} has more than two material primitives.`)
  const channels = new Set()
  const materials = []
  let triangles = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) !== 4) throw new Error(`Starter gear slot ${slot} must use triangle primitives.`)
    if (primitive.material === undefined) throw new Error(`Starter gear slot ${slot} has an unassigned material.`)
    const materialName = json.materials[primitive.material]?.name
    const channel = PRIMARY_MATERIALS.has(materialName) ? 'primary' : materialName === TRIM_MATERIAL ? 'trim' : undefined
    if (!channel) throw new Error(`Starter gear material name is not supported: ${materialName ?? '(missing)'}.`)
    if (channels.has(channel)) throw new Error(`Starter gear slot ${slot} repeats its ${channel} material.`)
    if ((json.materials[primitive.material].alphaMode ?? 'OPAQUE') !== 'OPAQUE') {
      throw new Error(`Starter gear slot ${slot} must use opaque materials.`)
    }
    channels.add(channel)
    materials.push(primitive.material)
    const positionAccessor = primitive.attributes.POSITION
    if (positionAccessor === undefined) throw new Error(`Starter gear slot ${slot} has no position accessor.`)
    const position = json.accessors[positionAccessor]
    validateRawSkinAttributes(json, binary, primitive, json.skins[node.skin]?.joints.length, position.count)
    const bounds = accessorBounds(positionAccessor)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis])
      max[axis] = Math.max(max[axis], bounds.max[axis])
    }
    const indexCount = primitive.indices === undefined ? position.count : json.accessors[primitive.indices]?.count
    if (!Number.isInteger(indexCount) || indexCount % 3 !== 0) throw new Error(`Starter gear slot ${slot} has an invalid triangle index count.`)
    triangles += indexCount / 3
  }
  if (!channels.has('primary')) throw new Error(`Starter gear slot ${slot} has no primary material.`)
  if (channels.size > 2) throw new Error(`Starter gear slot ${slot} has too many dye channels.`)
  return { slot, mesh: node.name, skin: node.skin, triangles, bounds: { min, max }, materials }
}

function inferredSlot(name = '') {
  const normalized = name.replace(/[^a-z]/gi, '').toLowerCase()
  return ALL_SLOTS.find((slot) => normalized.startsWith(`starterleather${slot}`))
}

function accessorBounds(accessorIndex) {
  const accessor = json.accessors[accessorIndex]
  if (!accessor || accessor.type !== 'VEC3' || accessor.componentType !== 5126) {
    throw new Error('Position accessors must use float VEC3 values.')
  }
  if (accessor.min?.length === 3 && accessor.max?.length === 3) return { min: accessor.min, max: accessor.max }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const row of accessorRows(accessorIndex)) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = row.readFloatLE(axis * 4)
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return { min, max }
}

function accessorBytes(accessorIndex) {
  return Buffer.concat(accessorRows(accessorIndex))
}

function accessorRows(accessorIndex, document = json, binaryBuffer = binary) {
  const accessor = document.accessors[accessorIndex]
  if (!accessor) throw new Error(`Accessor ${accessorIndex} is missing.`)
  if (accessor.sparse) throw new Error(`Accessor ${accessorIndex} must not be sparse.`)
  const view = document.bufferViews[accessor.bufferView]
  if (!view || (view.buffer ?? 0) !== 0) throw new Error(`Accessor ${accessorIndex} must reference the embedded GLB buffer.`)
  const elementBytes = componentBytes(accessor.componentType) * componentCount(accessor.type)
  const stride = view.byteStride ?? elementBytes
  if (stride < elementBytes) throw new Error(`Accessor ${accessorIndex} has an invalid byte stride.`)
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return Array.from({ length: accessor.count }, (_unused, index) => binaryBuffer.subarray(
    start + index * stride,
    start + index * stride + elementBytes,
  ))
}

export function validateRawSkinAttributes(document, binaryBuffer, primitive, jointCount, positionCount) {
  const jointIndex = primitive.attributes.JOINTS_0
  const weightIndex = primitive.attributes.WEIGHTS_0
  const joints = document.accessors[jointIndex]
  const weights = document.accessors[weightIndex]
  if (jointIndex === undefined || weightIndex === undefined || !joints || !weights
    || joints.type !== 'VEC4' || weights.type !== 'VEC4'
    || ![5121, 5123].includes(joints.componentType)
    || !(weights.componentType === 5126 || ([5121, 5123].includes(weights.componentType) && weights.normalized))
    || joints.count !== positionCount || weights.count !== positionCount
    || !Number.isInteger(jointCount) || jointCount <= 0) {
    throw new Error('Starter gear primitive has incompatible raw skin attributes.')
  }
  const jointRows = accessorRows(jointIndex, document, binaryBuffer)
  const weightRows = accessorRows(weightIndex, document, binaryBuffer)
  for (let vertex = 0; vertex < positionCount; vertex += 1) {
    let weightSum = 0
    for (let component = 0; component < 4; component += 1) {
      const joint = readComponent(jointRows[vertex], component, joints.componentType, false)
      const weight = readComponent(weightRows[vertex], component, weights.componentType, !!weights.normalized)
      if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount || !Number.isFinite(weight) || weight < 0) {
        throw new Error(`Starter gear primitive has malformed raw skin data at vertex ${vertex}.`)
      }
      weightSum += weight
    }
    if (Math.abs(weightSum - 1) > 1e-4) {
      throw new Error(`Starter gear primitive has non-unit raw skin weights at vertex ${vertex}.`)
    }
  }
}

function readComponent(row, component, componentType, normalized) {
  const bytes = componentBytes(componentType)
  const offset = component * bytes
  if (componentType === 5121) {
    const value = row.readUInt8(offset)
    return normalized ? value / 255 : value
  }
  if (componentType === 5123) {
    const value = row.readUInt16LE(offset)
    return normalized ? value / 65535 : value
  }
  if (componentType === 5126) return row.readFloatLE(offset)
  throw new Error(`Unsupported skin component type: ${componentType}.`)
}

function componentBytes(componentType) {
  if (componentType === 5120 || componentType === 5121) return 1
  if (componentType === 5122 || componentType === 5123) return 2
  if (componentType === 5125 || componentType === 5126) return 4
  throw new Error(`Unsupported accessor component type: ${componentType}.`)
}

function componentCount(type) {
  const counts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  if (!counts[type]) throw new Error(`Unsupported accessor type: ${type}.`)
  return counts[type]
}

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error('Starter gear file is not a valid GLB 2.0 container.')
  }
  let json
  let binary
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const chunk = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').trim())
    if (type === 0x004e4942) binary = chunk
    offset += 8 + length
  }
  if (!json || !binary) throw new Error('Starter gear GLB must contain JSON and binary chunks.')
  return { json, binary }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
