import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'

const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const GEAR_DIRECTORY = join(REPOSITORY, 'public', 'gear', 'starter-leather')
const GLB_PATH = join(GEAR_DIRECTORY, 'starter-leather.glb')
const MANIFEST_PATH = join(GEAR_DIRECTORY, 'starter-leather.manifest.json')
const BODY_MANIFEST_PATH = join(REPOSITORY, 'public', 'bodies', 'masculine-clean-v1', 'masculine-clean-v1.manifest.json')
const BODY_GLB_PATH = join(REPOSITORY, 'public', 'bodies', 'masculine-clean-v1', 'masculine-clean-v1.glb')
const APPROVED_BODY_ID = 'masculine-clean-v1'
const APPROVED_BODY_SCHEMA = 'ashveil.approved-character.v1'
const STARTER_SCHEMA = 'ashveil.starter-gear.v1'
export const TRUSTED_STARTER_ROUNDTRIP = Object.freeze({
  bytes: 770_492,
  sha256: '37e872a6982b697c9ee72aa4564a4b6c886f27de042fcc2ce7a23c25c1537ac0',
  inverseBindSha256: '18beee7f914be495ddf42602b18e92960b8511a561c8bee0dd1daab71c03b1bc',
})
const REQUIRED_SLOTS = ['chest', 'legs', 'boots']
const OPTIONAL_SLOTS = ['waist']
const ALL_SLOTS = ['chest', 'waist', 'legs', 'boots']
const PRIMARY_MATERIALS = new Set(['Starter Leather', 'Starter Dark Leather'])
const TRIM_MATERIAL = 'Starter Trim'
const SET_ARGUMENT = process.argv.find((argument) => argument.startsWith('--set='))?.slice('--set='.length) ?? 'starter-leather'
const MAGE_ID = 'arcane-mage-tier'
const MAGE_DIRECTORY = join(REPOSITORY, 'public', 'gear', MAGE_ID)
const MAGE_GLB_PATH = join(MAGE_DIRECTORY, `${MAGE_ID}.glb`)
const MAGE_MANIFEST_PATH = join(MAGE_DIRECTORY, `${MAGE_ID}.manifest.json`)
export const MAGE_PARTS = [
  { slot: 'head', node: 'ArcaneMageHead', deformation: { kind: 'rigid', joint: 'head.x' } },
  { slot: 'shoulders', node: 'ArcaneMageShoulderL', deformation: { kind: 'rigid', joint: 'shoulder.l' } },
  { slot: 'shoulders', node: 'ArcaneMageShoulderR', deformation: { kind: 'rigid', joint: 'shoulder.r' } },
  { slot: 'chest', node: 'ArcaneMageChest', deformation: { kind: 'skinned' } },
  { slot: 'chest', node: 'ArcaneMageRobeSkirt', deformation: { kind: 'skinned' } },
  { slot: 'hands', node: 'ArcaneMageHands', deformation: { kind: 'skinned' } },
  { slot: 'waist', node: 'ArcaneMageWaist', deformation: { kind: 'skinned' } },
  { slot: 'legs', node: 'ArcaneMageLegs', deformation: { kind: 'skinned' } },
  { slot: 'boots', node: 'ArcaneMageBoots', deformation: { kind: 'skinned' } },
  { slot: 'back', node: 'ArcaneMageBack', deformation: { kind: 'skinned' } },
]
export const ALL_MAGE_SLOTS = ['head', 'shoulders', 'chest', 'hands', 'waist', 'legs', 'boots', 'back']
const MAX_MAGE_TRIANGLES = 120_000
const MAX_MAGE_SOURCE_MATERIALS = 64
const MAX_MAGE_DRAW_CALLS = 256
const MAX_MAGE_INSTANCE_MATERIALS = 128

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

function updateMageManifest() {
  const file = readFileSync(MAGE_GLB_PATH)
  const parsed = readGlb(file)
  json = parsed.json
  binary = parsed.binary
  validateSelfContainedDocument(json)
  const parents = validateNodeHierarchy(json.nodes)
  const claimedMeshes = new Set()
  const parts = MAGE_PARTS.map((part) => inspectMagePart(part, parents, claimedMeshes))
  const meshNodes = json.nodes.flatMap((node, index) => node.mesh === undefined ? [] : [index])
  if (claimedMeshes.size !== meshNodes.length || meshNodes.some((node) => !claimedMeshes.has(node))) {
    throw new Error('Every exported mesh node must map to one arcane mage gear part.')
  }
  if (json.animations?.length) throw new Error('Arcane mage gear GLB must not contain animations.')
  if (json.cameras?.length) throw new Error('Arcane mage gear GLB must not contain cameras.')
  if (hasPunctualLights(json)) throw new Error('Arcane mage gear GLB must not contain lights.')

  const skinIndices = new Set(parts.flatMap((part) => part.skins))
  if (skinIndices.size !== 1) throw new Error('All skinned arcane mage parts must share one exported skin.')
  const skin = json.skins[[...skinIndices][0]]
  if (!skin || skin.inverseBindMatrices === undefined) throw new Error('Arcane mage gear skin has no inverse-bind accessor.')
  validateInverseBindAccessor(skin.inverseBindMatrices, skin.joints.length)
  const jointNames = skin.joints.map((nodeIndex) => json.nodes[nodeIndex]?.name ?? '')
  if (jointNames.length !== 68 || jointNames.some((name) => !name) || new Set(jointNames).size !== jointNames.length) {
    throw new Error('Arcane mage gear skin has invalid joint names.')
  }
  const trustedRig = loadTrustedRigProfiles()
  validateRigProfiles(rigSignature(json, binary, skin, parents), trustedRig.profiles)
  for (const part of parts.filter((entry) => entry.deformation.kind === 'rigid')) {
    const jointIndex = jointNames.indexOf(part.deformation.joint)
    if (jointIndex < 0) throw new Error(`Rigid arcane mage joint is not in the exported skin: ${part.deformation.joint}.`)
    if (parents.get(part.rootIndex) !== skin.joints[jointIndex]) {
      throw new Error(`Rigid arcane mage part ${part.node} is not parented to the declared exported joint.`)
    }
  }

  const materialIndices = new Set(parts.flatMap((part) => part.materials))
  const materials = [...materialIndices].map((index) => {
    const name = json.materials[index]?.name
    if (!name) throw new Error(`Arcane mage material ${index} has no name.`)
    const normalized = name.toLowerCase()
    const dye = normalized.startsWith('dye primary') ? 'primary' : normalized.startsWith('dye trim') ? 'trim' : null
    return { name, dye }
  })
  if (new Set(materials.map((material) => material.name)).size !== materials.length) {
    throw new Error('Arcane mage material names must be unique.')
  }
  const slots = ALL_MAGE_SLOTS.map((slot) => ({
    slot,
    parts: parts.filter((part) => part.slot === slot).map(({ node, deformation, triangles, bounds }) => ({
      node, deformation, triangles, bounds,
    })),
  }))
  const budget = {
    triangles: parts.reduce((total, part) => total + part.triangles, 0),
    sourceMaterials: materials.length,
    drawCalls: parts.reduce((total, part) => total + part.drawCalls, 0),
    instanceMaterials: ALL_MAGE_SLOTS.reduce((total, slot) => total + new Set(
      parts.filter((part) => part.slot === slot).flatMap((part) => part.materials),
    ).size, 0),
  }
  if (budget.triangles > MAX_MAGE_TRIANGLES || budget.sourceMaterials > MAX_MAGE_SOURCE_MATERIALS
    || budget.drawCalls > MAX_MAGE_DRAW_CALLS || budget.instanceMaterials > MAX_MAGE_INSTANCE_MATERIALS) {
    throw new Error('Arcane mage gear exceeds the runtime set budget.')
  }
  const manifest = {
    schema: 'ashveil.gear-set.v2',
    id: MAGE_ID,
    body: APPROVED_BODY_ID,
    bodySha256: trustedRig.bodyManifest.glb.sha256,
    glb: { file: `${MAGE_ID}.glb`, bytes: file.byteLength, sha256: sha256(file) },
    jointNames,
    inverseBindSha256: sha256(accessorBytes(skin.inverseBindMatrices)),
    materials,
    slots,
    budget,
  }
  const output = `${JSON.stringify(manifest, null, 2)}\n`
  if (process.argv.includes('--check')) {
    if (readFileSync(MAGE_MANIFEST_PATH, 'utf8') !== output) throw new Error('Arcane mage gear manifest is stale. Run npm run art:gear-manifest:mage.')
    console.log('Arcane mage gear manifest matches the manual GLB export.')
  } else {
    writeFileSync(MAGE_MANIFEST_PATH, output)
    console.log(`Updated ${MAGE_MANIFEST_PATH}`)
  }
}

function inspectMagePart(part, parents, claimedMeshes) {
  const matches = json.nodes.flatMap((node, index) => node.name === part.node ? [index] : [])
  if (matches.length !== 1) throw new Error(`Expected exactly one ${part.node} part root, found ${matches.length}.`)
  const root = matches[0]
  if (part.deformation.kind === 'rigid') {
    const parent = parents.get(root)
    if (parent === undefined || json.nodes[parent]?.name !== part.deformation.joint) {
      throw new Error(`Rigid arcane mage part ${part.node} must be parented directly to ${part.deformation.joint}.`)
    }
  } else if (!identityNodeTransform(json.nodes[root]) || !identityMatrix(nodeGlobalMatrix(root, parents))) {
    throw new Error(`Skinned arcane mage part ${part.node} must have an identity transform.`)
  }
  const subtree = nodeSubtree(root)
  if (part.deformation.kind === 'skinned'
    && subtree.some((nodeIndex) => !identityNodeTransform(json.nodes[nodeIndex]))) {
    throw new Error(`Skinned arcane mage descendants under ${part.node} must have identity transforms.`)
  }
  if (part.deformation.kind === 'rigid' && subtree.some((nodeIndex) => !finiteNodeTransform(json.nodes[nodeIndex]))) {
    throw new Error(`Rigid arcane mage descendants under ${part.node} must have finite transforms.`)
  }
  const renderNodes = subtree.filter((index) => json.nodes[index]?.mesh !== undefined)
  if (renderNodes.length === 0) throw new Error(`Arcane mage part ${part.node} has no mesh nodes.`)
  if (renderNodes.some((index) => claimedMeshes.has(index))) throw new Error(`Arcane mage part ${part.node} overlaps another part.`)
  renderNodes.forEach((index) => claimedMeshes.add(index))
  const skins = new Set()
  const materials = new Set()
  let triangles = 0
  let drawCalls = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const nodeIndex of renderNodes) {
    const node = json.nodes[nodeIndex]
    if (part.deformation.kind === 'skinned' && node.skin === undefined) throw new Error(`Arcane mage part ${part.node} is not skinned.`)
    if (part.deformation.kind === 'rigid' && node.skin !== undefined) throw new Error(`Rigid arcane mage part ${part.node} must not use a skin.`)
    if (node.skin !== undefined) skins.add(node.skin)
    const mesh = json.meshes[node.mesh]
    if (!mesh?.primitives?.length) throw new Error(`Arcane mage part ${part.node} has no mesh primitives.`)
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4 || primitive.material === undefined || primitive.targets?.length) {
        throw new Error(`Arcane mage part ${part.node} has an invalid primitive or morph target.`)
      }
      if ((json.materials[primitive.material]?.alphaMode ?? 'OPAQUE') !== 'OPAQUE') throw new Error(`Arcane mage part ${part.node} must use opaque materials.`)
      materials.add(primitive.material)
      drawCalls += 1
      const positionAccessor = primitive.attributes.POSITION
      if (positionAccessor === undefined) throw new Error(`Arcane mage part ${part.node} has no position accessor.`)
      const position = json.accessors[positionAccessor]
      if (part.deformation.kind === 'skinned') validateRawSkinAttributes(json, binary, primitive, json.skins[node.skin]?.joints.length, position.count)
      const bounds = accessorBounds(positionAccessor)
      const transformed = new Box3(
        new Vector3(...bounds.min),
        new Vector3(...bounds.max),
      ).applyMatrix4(nodeGlobalMatrix(nodeIndex, parents))
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], transformed.min.getComponent(axis))
        max[axis] = Math.max(max[axis], transformed.max.getComponent(axis))
      }
      const indexCount = primitive.indices === undefined ? position.count : json.accessors[primitive.indices]?.count
      if (!Number.isInteger(indexCount) || indexCount % 3 !== 0) throw new Error(`Arcane mage part ${part.node} has invalid triangles.`)
      triangles += indexCount / 3
    }
  }
  return { ...part, rootIndex: root, skins: [...skins], materials: [...materials], triangles, drawCalls, bounds: { min, max } }
}

function nodeSubtree(root) {
  const result = []
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    result.push(node)
    pending.push(...(json.nodes[node]?.children ?? []))
  }
  return result
}

function identityNodeTransform(node) {
  if (node.matrix !== undefined) {
    return Array.isArray(node.matrix) && node.matrix.length === 16
      && node.matrix.every((value, index) => Number.isFinite(value) && Math.abs(value - (index % 5 === 0 ? 1 : 0)) <= 1e-8)
  }
  const translation = node.translation ?? [0, 0, 0]
  const rotation = node.rotation ?? [0, 0, 0, 1]
  const scale = node.scale ?? [1, 1, 1]
  return translation.every((value) => Math.abs(value) <= 1e-8)
    && rotation.slice(0, 3).every((value) => Math.abs(value) <= 1e-8) && Math.abs(rotation[3] - 1) <= 1e-8
    && scale.every((value) => Math.abs(value - 1) <= 1e-8)
}

function identityMatrix(matrix) {
  return matrix.elements.every((value, index) => Number.isFinite(value)
    && Math.abs(value - (index % 5 === 0 ? 1 : 0)) <= 1e-8)
}

function finiteNodeTransform(node) {
  if (node.matrix !== undefined) return Array.isArray(node.matrix) && node.matrix.length === 16 && node.matrix.every(Number.isFinite)
  return [node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]]
    .every((values) => Array.isArray(values) && values.every(Number.isFinite))
}

function nodeGlobalMatrix(index, parents, document = json) {
  const chain = []
  for (let current = index; current !== undefined; current = parents.get(current)) chain.push(current)
  return chain.reverse().reduce((matrix, nodeIndex) => matrix.multiply(nodeLocalMatrix(document.nodes[nodeIndex])), new Matrix4())
}

function nodeLocalMatrix(node) {
  if (node.matrix !== undefined) return new Matrix4().fromArray(node.matrix)
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  )
}

function validateInverseBindAccessor(accessorIndex, jointCount, document = json, binaryBuffer = binary) {
  const accessor = document.accessors[accessorIndex]
  if (!accessor || accessor.type !== 'MAT4' || accessor.componentType !== 5126 || accessor.count !== jointCount) {
    throw new Error('Arcane mage inverse binds are incompatible with the exported joints.')
  }
  for (const row of accessorRows(accessorIndex, document, binaryBuffer)) {
    for (let offset = 0; offset < row.byteLength; offset += 4) {
      if (!Number.isFinite(row.readFloatLE(offset))) throw new Error('Arcane mage inverse binds contain non-finite values.')
    }
  }
}

function rigSignature(document, binaryBuffer, skin, parents) {
  if (skin.inverseBindMatrices === undefined) throw new Error('Gear skin has no inverse-bind accessor.')
  const jointNames = skin.joints.map((nodeIndex) => document.nodes[nodeIndex]?.name ?? '')
  return {
    jointNames,
    inverseBindSha256: sha256(accessorBytes(skin.inverseBindMatrices, document, binaryBuffer)),
    jointRestMatrices: Object.fromEntries(jointNames.map((name, index) => [
      name,
      nodeGlobalMatrix(skin.joints[index], parents, document).elements,
    ])),
  }
}

function readTrustedRig(file, label) {
  const parsed = readGlb(file)
  validateSelfContainedDocument(parsed.json)
  const parents = validateNodeHierarchy(parsed.json.nodes)
  if (parsed.json.skins?.length !== 1) throw new Error(`${label} GLB must contain exactly one skin.`)
  const skin = parsed.json.skins[0]
  if (!skin || skin.inverseBindMatrices === undefined) throw new Error(`${label} GLB skin has no inverse-bind accessor.`)
  validateInverseBindAccessor(skin.inverseBindMatrices, skin.joints.length, parsed.json, parsed.binary)
  const signature = rigSignature(parsed.json, parsed.binary, skin, parents)
  validateCompleteRigSignature(signature, label)
  return signature
}

function validateCompleteRigSignature(signature, label) {
  if (!signature || signature.jointNames?.length !== 68
    || signature.jointNames.some((name) => typeof name !== 'string' || !name)
    || new Set(signature.jointNames).size !== 68
    || !/^[a-f0-9]{64}$/.test(signature.inverseBindSha256 ?? '')
    || !signature.jointRestMatrices
    || Object.keys(signature.jointRestMatrices).length !== 68) {
    throw new Error(`${label} rig signature is incomplete.`)
  }
  for (const joint of signature.jointNames) {
    const matrix = signature.jointRestMatrices[joint]
    if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
      throw new Error(`${label} rig signature has an invalid rest matrix for ${joint}.`)
    }
  }
}

export function validatePinnedGlb(file, manifest, expected) {
  if (manifest?.schema !== expected.schema || manifest?.body !== expected.body) {
    throw new Error(`${expected.label} manifest schema or body is not trusted.`)
  }
  if (manifest.glb?.file !== expected.file || manifest.glb.bytes !== file.byteLength
    || manifest.glb.sha256 !== sha256(file)
    || (expected.bytes !== undefined && manifest.glb.bytes !== expected.bytes)
    || (expected.sha256 !== undefined && manifest.glb.sha256 !== expected.sha256)) {
    throw new Error(`${expected.label} GLB does not match its pinned manifest.`)
  }
}

export function validateTrustedStarterProfile(starterManifest, starterSignature, bodyManifest, bodySignature) {
  if (starterManifest?.schema !== STARTER_SCHEMA || starterManifest?.body !== APPROVED_BODY_ID
    || starterManifest?.bodySha256 !== bodyManifest?.glb?.sha256) {
    throw new Error('Starter roundtrip manifest is not bound to the approved body.')
  }
  validateCompleteRigSignature(starterSignature, 'Starter roundtrip')
  validateCompleteRigSignature(bodySignature, 'Approved body')
  if (starterManifest.jointNames?.length !== starterSignature.jointNames.length
    || starterManifest.jointNames.some((name, index) => name !== starterSignature.jointNames[index])
    || starterManifest.inverseBindSha256 !== starterSignature.inverseBindSha256
    || starterSignature.inverseBindSha256 !== TRUSTED_STARTER_ROUNDTRIP.inverseBindSha256
    || starterSignature.jointNames.some((name, index) => name !== bodySignature.jointNames[index])) {
    throw new Error('Starter roundtrip manifest does not match its exported bind identity.')
  }
}

export function loadTrustedRigProfiles() {
  const bodyManifest = JSON.parse(readFileSync(BODY_MANIFEST_PATH, 'utf8'))
  const bodyFile = readFileSync(BODY_GLB_PATH)
  validatePinnedGlb(bodyFile, bodyManifest, {
    schema: APPROVED_BODY_SCHEMA, body: APPROVED_BODY_ID, file: `${APPROVED_BODY_ID}.glb`, label: 'Approved body',
  })
  const bodySignature = readTrustedRig(bodyFile, 'Approved body')

  const starterManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const starterFile = readFileSync(GLB_PATH)
  validatePinnedGlb(starterFile, starterManifest, {
    schema: STARTER_SCHEMA, body: APPROVED_BODY_ID, file: 'starter-leather.glb', label: 'Starter roundtrip',
    bytes: TRUSTED_STARTER_ROUNDTRIP.bytes, sha256: TRUSTED_STARTER_ROUNDTRIP.sha256,
  })
  const starterSignature = readTrustedRig(starterFile, 'Starter roundtrip')
  validateTrustedStarterProfile(starterManifest, starterSignature, bodyManifest, bodySignature)

  return {
    bodyManifest,
    starterManifest,
    profiles: [
      { id: 'approved-body-direct', ...bodySignature },
      { id: 'starter-roundtrip', ...starterSignature },
    ],
  }
}

function sameCompleteRigSignature(exported, profile) {
  return exported.jointNames.every((name, index) => name === profile.jointNames[index])
    && exported.inverseBindSha256 === profile.inverseBindSha256
    && exported.jointNames.every((joint) => exported.jointRestMatrices[joint]
      .every((value, index) => value === profile.jointRestMatrices[joint][index]))
}

export function validateRigProfiles(exported, profiles) {
  validateCompleteRigSignature(exported, 'Arcane mage')
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error('No trusted rig profiles are configured.')
  for (const profile of profiles) {
    validateCompleteRigSignature(profile, `Trusted ${profile.id ?? 'unnamed'}`)
    if (sameCompleteRigSignature(exported, profile)) return profile.id
  }
  throw new Error('Arcane mage rig does not exactly match a complete trusted rig profile.')
}

export function validateNodeHierarchy(nodes) {
  const parents = new Map()
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
      indegree[child] += 1
    }
  })
  const pending = indegree.flatMap((count, index) => count === 0 ? [index] : [])
  let visited = 0
  while (pending.length > 0) {
    const node = pending.pop()
    visited += 1
    for (const child of nodes[node]?.children ?? []) {
      indegree[child] -= 1
      if (indegree[child] === 0) pending.push(child)
    }
  }
  if (visited !== nodes.length) throw new Error('Gear GLB node hierarchy contains a cycle.')
  return parents
}

export function validateSelfContainedDocument(document) {
  if (document.buffers?.length !== 1 || document.buffers.some((buffer) => buffer.uri !== undefined)
    || document.images?.some((image) => image.uri !== undefined || !Number.isInteger(image.bufferView))) {
    throw new Error('Gear GLB must keep buffers and images inside its binary chunk.')
  }
}

export function hasPunctualLights(document) {
  return !!document.extensions?.KHR_lights_punctual?.lights?.length
    || document.nodes.some((node) => node.extensions?.KHR_lights_punctual?.light !== undefined)
}

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

function accessorBytes(accessorIndex, document = json, binaryBuffer = binary) {
  return Buffer.concat(accessorRows(accessorIndex, document, binaryBuffer))
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
  if (jointIndex === undefined || weightIndex === undefined
    || primitive.attributes.JOINTS_1 !== undefined || primitive.attributes.WEIGHTS_1 !== undefined
    || !joints || !weights
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (SET_ARGUMENT === 'starter-leather') updateManifest()
  else if (SET_ARGUMENT === MAGE_ID) updateMageManifest()
  else throw new Error(`Unknown gear set: ${SET_ARGUMENT}.`)
}
