/**
 * Reads a rigged GLB's bind pose and writes the semantic joint table the
 * procedural pose generator uses as its rest geometry.
 *
 *   node scripts/extract-rig-geometry.mjs
 *
 * The bind pose comes from the skin's inverse bind matrices: glTF defines them as
 * the transform from mesh space into each joint's space, so inverting one gives
 * that joint's world position while the mesh is undeformed. That is more reliable
 * than walking node transforms, which an exporter is free to leave posed.
 *
 * Run once per body; the output is committed under
 * `src/render/procedural/fixtures/` and pinned by `tests/procedural_geometry.test.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const JSON_CHUNK = 0x4e4f534a

/** Semantic joint to KayKit bone. The kit ships one 41-bone rig for every body. */
export const KAYKIT_JOINTS = {
  root: 'root',
  pelvis: 'hips',
  spine: 'spine',
  chest: 'chest',
  head: 'head',
  'shoulder.l': 'upperarm.l',
  'elbow.l': 'lowerarm.l',
  'hand.l': 'hand.l',
  'shoulder.r': 'upperarm.r',
  'elbow.r': 'lowerarm.r',
  'hand.r': 'hand.r',
  'hip.l': 'upperleg.l',
  'knee.l': 'lowerleg.l',
  'foot.l': 'foot.l',
  'hip.r': 'upperleg.r',
  'knee.r': 'lowerleg.r',
  'foot.r': 'foot.r',
}

export const KAYKIT_OPTIONAL_JOINTS = {
  'toes.l': 'toes.l',
  'toes.r': 'toes.r',
  'wrist.l': 'wrist.l',
  'wrist.r': 'wrist.r',
}

export function readGlb(body) {
  let offset = 12
  let json = null
  let bin = null
  while (offset < body.length) {
    const length = body.readUInt32LE(offset)
    const type = body.readUInt32LE(offset + 4)
    const chunk = body.subarray(offset + 8, offset + 8 + length)
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8').trim())
    else if (bin === null) bin = chunk
    offset += 8 + length
  }
  if (!json || !bin) throw new Error('glb is missing a JSON or binary chunk')
  return { json, bin }
}

/** Bone name to bind-pose world position, from the first skin's inverse bind matrices. */
export function bindPosePositions(body) {
  const { json, bin } = readGlb(body)
  const skin = json.skins?.[0]
  if (!skin) throw new Error('glb has no skin')
  const accessor = json.accessors[skin.inverseBindMatrices]
  const view = json.bufferViews[accessor.bufferView]
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const matrices = new Float32Array(bin.buffer, start, accessor.count * 16)

  const positions = {}
  skin.joints.forEach((node, index) => {
    positions[json.nodes[node].name] = inverseTranslation(matrices.subarray(index * 16, index * 16 + 16))
  })
  return positions
}

/** The translation of a column-major affine matrix's inverse. */
function inverseTranslation(m) {
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  if (Math.abs(det) < 1e-12) throw new Error('inverse bind matrix is singular')
  const i = [
    (m[5] * m[10] - m[6] * m[9]) / det,
    -(m[1] * m[10] - m[2] * m[9]) / det,
    (m[1] * m[6] - m[2] * m[5]) / det,
    -(m[4] * m[10] - m[6] * m[8]) / det,
    (m[0] * m[10] - m[2] * m[8]) / det,
    -(m[0] * m[6] - m[2] * m[4]) / det,
    (m[4] * m[9] - m[5] * m[8]) / det,
    -(m[0] * m[9] - m[1] * m[8]) / det,
    (m[0] * m[5] - m[1] * m[4]) / det,
  ]
  return [
    -(i[0] * m[12] + i[3] * m[13] + i[6] * m[14]),
    -(i[1] * m[12] + i[4] * m[13] + i[7] * m[14]),
    -(i[2] * m[12] + i[5] * m[13] + i[8] * m[14]),
  ]
}

function mapJoints(positions, mapping, label) {
  const table = {}
  for (const [joint, bone] of Object.entries(mapping)) {
    const position = positions[bone]
    if (!position) throw new Error(`${label}: bone "${bone}" for joint "${joint}" is not in the skin`)
    table[joint] = position.map((value) => Number(value.toFixed(6)))
  }
  return table
}

export function extractRigGeometry(body, mapping = KAYKIT_JOINTS, optional = KAYKIT_OPTIONAL_JOINTS) {
  const positions = bindPosePositions(body)
  return {
    joints: mapJoints(positions, mapping, 'required'),
    optional: mapJoints(positions, optional, 'optional'),
  }
}

const FIXTURE = join(ROOT, 'src', 'render', 'procedural', 'fixtures', 'kaykit_knight.json')

if (process.argv[1] === import.meta.filename) {
  const source = join(ROOT, 'public', 'models', 'player.glb')
  const fixture = {
    source: 'public/models/player.glb',
    note: 'Bind-pose joint positions in the body frame (+Y up, +Z forward, +X left), in model units.',
    ...extractRigGeometry(readFileSync(source)),
  }
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`wrote ${FIXTURE}`)
}
