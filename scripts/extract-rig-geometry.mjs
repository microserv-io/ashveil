/**
 * Reads a rigged GLB's bind pose into the semantic joint table the procedural
 * pose generator uses as its rest geometry.
 *
 * The bind pose comes from the skin's inverse bind matrices: glTF defines them as
 * the transform from mesh space into each joint's space, so inverting one gives
 * that joint's world position while the mesh is undeformed. That is more reliable
 * than walking node transforms, which an exporter is free to leave posed.
 *
 * `art:profile` uses this once per body and commits the result under
 * `src/render/procedural/fixtures/`.
 */
const JSON_CHUNK = 0x4e4f534a

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

/**
 * Visible height of the body in bind pose, from the bounds of the skinned meshes
 * alone. Unskinned attachments parented into the rig must not affect body scale.
 */
export function bindPoseHeight(body) {
  const { json } = readGlb(body)
  const skinned = new Set(json.nodes.filter((node) => node.skin !== undefined).map((node) => node.mesh))
  let low = Infinity
  let high = -Infinity
  for (const mesh of skinned) {
    for (const primitive of json.meshes[mesh].primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION]
      if (!accessor?.min || !accessor?.max) throw new Error('mesh has no position bounds')
      low = Math.min(low, accessor.min[1])
      high = Math.max(high, accessor.max[1])
    }
  }
  if (!Number.isFinite(low)) throw new Error('glb has no skinned mesh to measure')
  return Number((high - low).toFixed(6))
}

function readAccessor(body, accessor, lanes) {
  const { json, bin } = readGlb(body)
  if (accessor.componentType !== 5126) throw new Error('sampler is not float32')
  const view = json.bufferViews[accessor.bufferView]
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return new Float32Array(bin.buffer, start, accessor.count * lanes)
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

/**
 * Where a foot actually touches the ground, measured off the mesh rather than
 * guessed from the body's height: the heel and the toe of the skinned foot, and
 * how far the whole footprint is tilted in the bind pose.
 *
 * A rig's foot bone points down and forward — the ankle stands above the floor
 * and the toe lies on it — so "identity" is only flat if the flat reference comes
 * from the rig itself. And a foot that rolls has to roll about the parts that are
 * really planted, which is these two.
 */
export function footPrint(body, footBones, ankle) {
  const { json, bin } = readGlb(body)
  const skin = json.skins?.[0]
  if (!skin) throw new Error('glb has no skin')
  const wanted = new Set()
  skin.joints.forEach((node, index) => {
    if (footBones.includes(json.nodes[node].name)) wanted.add(index)
  })
  if (wanted.size === 0) throw new Error(`glb has no foot bone among ${footBones.join(', ')}`)

  const points = []
  for (const node of json.nodes) {
    if (node.skin === undefined || node.mesh === undefined) continue
    for (const primitive of json.meshes[node.mesh].primitives) {
      const position = readAccessor(body, json.accessors[primitive.attributes.POSITION], 3)
      const weights = readAccessor(body, json.accessors[primitive.attributes.WEIGHTS_0], 4)
      const joints = readIndices(body, json.accessors[primitive.attributes.JOINTS_0])
      for (let vertex = 0; vertex < position.length / 3; vertex++) {
        let best = 0
        let bestAt = 0
        for (let lane = 0; lane < 4; lane++) {
          const weight = weights[vertex * 4 + lane]
          if (weight > best) {
            best = weight
            bestAt = joints[vertex * 4 + lane]
          }
        }
        if (best > 0.5 && wanted.has(bestAt)) {
          points.push([position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]])
        }
      }
    }
  }
  if (points.length === 0) throw new Error('no vertices are skinned to the foot')

  // The sole: everything within a centimetre of the lowest point the foot reaches.
  const floor = Math.min(...points.map((point) => point[1]))
  const sole = points.filter((point) => point[1] < floor + 0.01)
  const heel = sole.reduce((low, point) => (point[2] < low[2] ? point : low))
  const toe = sole.reduce((high, point) => (point[2] > high[2] ? point : high))
  return {
    heel: Number((ankle[2] - heel[2]).toFixed(6)),
    toe: Number((toe[2] - ankle[2]).toFixed(6)),
    lift: Number((ankle[1] - floor).toFixed(6)),
    pitch: Number(Math.atan2(toe[1] - heel[1], toe[2] - heel[2]).toFixed(6)),
  }
}

function readIndices(body, accessor) {
  const { json, bin } = readGlb(body)
  const view = json.bufferViews[accessor.bufferView]
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  if (accessor.componentType === 5121) return new Uint8Array(bin.buffer, start, accessor.count * 4)
  if (accessor.componentType === 5123) return new Uint16Array(bin.buffer, start, accessor.count * 4)
  throw new Error(`joint indices are not bytes or shorts: ${accessor.componentType}`)
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

export function extractRigGeometry(
  body,
  mapping,
  optional = {},
) {
  const positions = bindPosePositions(body)
  const footBones = [mapping['foot.l'], mapping['foot.r']]
  return {
    standingHeight: bindPoseHeight(body),
    footprint: footPrint(body, footBones, positions[mapping['foot.l']]),
    joints: mapJoints(positions, mapping, 'required'),
    optional: mapJoints(positions, optional, 'optional'),
  }
}
