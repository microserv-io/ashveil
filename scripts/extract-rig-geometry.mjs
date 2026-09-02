/**
 * Reads a rigged GLB's bind pose and writes the semantic joint table the
 * procedural pose generator uses as its rest geometry.
 *
 *   node scripts/extract-rig-geometry.mjs <glb> <profile> [carry-clip] <output>
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
import { isAbsolute, join, relative, resolve } from 'node:path'

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

export const HUMANOID_V1_JOINTS = {
  root: 'root',
  pelvis: 'pelvis',
  spine: 'spine',
  chest: 'chest',
  head: 'head',
  'shoulder.l': 'upper_arm.L',
  'elbow.l': 'forearm.L',
  'hand.l': 'hand.L',
  'shoulder.r': 'upper_arm.R',
  'elbow.r': 'forearm.R',
  'hand.r': 'hand.R',
  'hip.l': 'thigh.L',
  'knee.l': 'shin.L',
  'foot.l': 'foot.L',
  'hip.r': 'thigh.R',
  'knee.r': 'shin.R',
  'foot.r': 'foot.R',
}

export const HUMANOID_V1_OPTIONAL_JOINTS = {
  neck: 'neck',
  'clavicle.l': 'clavicle.L',
  'clavicle.r': 'clavicle.R',
}

/**
 * The clip the carried-arm pose is averaged out of. A run holds the sword arm
 * where a fight would, and averaging a whole cycle of it cancels the swing that
 * the gait puts back itself.
 */
export const KAYKIT_CARRY_CLIP = 'Running_A'
/** The sword arm swings half as far as the free one: authored, not measured. */
export const KAYKIT_CARRY_SWING_SCALE = 0.5

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
 * alone. Everything else in the file — the swords, the shields, the cape — is an
 * unskinned prop parented into the rig, and measuring those would say the knight
 * is as tall as the greatsword it is holding.
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

/**
 * A bone's average rotation over a clip, as an absolute body-frame rotation in
 * the convention of `procedural/joints.ts`: the turn that takes the bone from
 * where the bind pose points it to where the clip does. Composing each ancestor's
 * animated rotation and dividing out the rest chain is what makes it absolute,
 * so the torso's own lean is already in it and the generator can write it
 * straight onto the joint.
 */
export function averageBoneRotation(body, clip, bone) {
  const { json } = readGlb(body)
  const animation = json.animations?.find((each) => each.name === clip)
  if (!animation) throw new Error(`glb has no animation named "${clip}"`)
  const parent = new Int32Array(json.nodes.length).fill(-1)
  json.nodes.forEach((node, at) => (node.children ?? []).forEach((child) => { parent[child] = at }))
  const named = new Map(json.nodes.map((node, at) => [node.name, at]))
  if (!named.has(bone)) throw new Error(`glb has no bone named "${bone}"`)

  const tracks = new Map()
  for (const channel of animation.channels) {
    if (channel.target.path !== 'rotation') continue
    const sampler = animation.samplers[channel.sampler]
    tracks.set(channel.target.node, {
      time: readAccessor(body, json.accessors[sampler.input], 1),
      value: readAccessor(body, json.accessors[sampler.output], 4),
    })
  }

  const chain = []
  for (let at = named.get(bone); at >= 0; at = parent[at]) chain.unshift(at)
  const times = [...new Set([...tracks.values()].flatMap((track) => [...track.time]))].sort((a, b) => a - b)
  const rest = chainRotation(json, tracks, chain, null)
  let sum = [0, 0, 0, 0]
  let reference = null
  for (const time of times) {
    let turn = multiply(chainRotation(json, tracks, chain, time), conjugate(rest))
    reference ??= turn
    // Neighbouring samples can straddle the double cover; averaging across it
    // would cancel the pose down to something near identity.
    if (turn.reduce((total, lane, at) => total + lane * reference[at], 0) < 0) turn = turn.map((lane) => -lane)
    sum = sum.map((lane, at) => lane + turn[at])
  }
  return normalise(sum).map((lane) => Number(lane.toFixed(6)))
}

function chainRotation(json, tracks, chain, time) {
  let rotation = [0, 0, 0, 1]
  for (const node of chain) rotation = multiply(rotation, localRotation(json, tracks, node, time))
  return rotation
}

function localRotation(json, tracks, node, time) {
  const track = time === null ? undefined : tracks.get(node)
  if (!track) return json.nodes[node].rotation ?? [0, 0, 0, 1]
  let at = 0
  while (at < track.time.length - 1 && track.time[at + 1] <= time) at++
  const next = Math.min(at + 1, track.time.length - 1)
  const span = track.time[next] - track.time[at]
  const along = span > 1e-9 ? (time - track.time[at]) / span : 0
  const from = [...track.value.subarray(at * 4, at * 4 + 4)]
  const to = [...track.value.subarray(next * 4, next * 4 + 4)]
  const sign = from.reduce((total, lane, lane_at) => total + lane * to[lane_at], 0) < 0 ? -1 : 1
  return normalise(from.map((lane, lane_at) => lane + (to[lane_at] * sign - lane) * along))
}

function readAccessor(body, accessor, lanes) {
  const { json, bin } = readGlb(body)
  if (accessor.componentType !== 5126) throw new Error('sampler is not float32')
  const view = json.bufferViews[accessor.bufferView]
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return new Float32Array(bin.buffer, start, accessor.count * lanes)
}

function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

function conjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]]
}

function normalise(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3])
  if (length < 1e-9) throw new Error('cannot normalise a zero quaternion')
  return q.map((lane) => lane / length)
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
  mapping = KAYKIT_JOINTS,
  optional = KAYKIT_OPTIONAL_JOINTS,
  carry = { clip: KAYKIT_CARRY_CLIP, sides: { right: KAYKIT_CARRY_SWING_SCALE } },
) {
  const positions = bindPosePositions(body)
  const armCarry = carry?.clip
    ? Object.fromEntries(Object.entries(carry.sides).map(([side, swingScale]) => [side, {
        shoulder: averageBoneRotation(body, carry.clip, mapping[`shoulder.${side[0]}`]),
        elbow: averageBoneRotation(body, carry.clip, mapping[`elbow.${side[0]}`]),
        swingScale,
      }]))
    : carry?.pose
  const footBones = [mapping['foot.l'], mapping['foot.r']]
  return {
    standingHeight: bindPoseHeight(body),
    footprint: footPrint(body, footBones, positions[mapping['foot.l']]),
    ...(armCarry ? { armCarry } : {}),
    joints: mapJoints(positions, mapping, 'required'),
    optional: mapJoints(positions, optional, 'optional'),
  }
}

const FIXTURE = join(ROOT, 'src', 'render', 'procedural', 'fixtures', 'kaykit_knight.json')

const PROFILES = {
  kaykit: {
    joints: KAYKIT_JOINTS,
    optional: KAYKIT_OPTIONAL_JOINTS,
    identityCarry: undefined,
    carrySides: { right: KAYKIT_CARRY_SWING_SCALE },
  },
  'humanoid-v1': {
    joints: HUMANOID_V1_JOINTS,
    optional: HUMANOID_V1_OPTIONAL_JOINTS,
    // No weapon: the empty-hand carry is computed from the rest pose at runtime.
    identityCarry: undefined,
    carrySides: { left: 1, right: 1 },
  },
}
PROFILES.humanoid_v1 = PROFILES['humanoid-v1']
PROFILES['humanoid.v1'] = PROFILES['humanoid-v1']

export function createRigFixture(body, source, profileName, carryClip) {
  const profile = PROFILES[profileName]
  if (!profile) throw new Error(`unknown rig profile "${profileName}"`)
  // An empty carry means "no carry": the default is the knight's measured one.
  const carry = carryClip
    ? { clip: carryClip, sides: profile.carrySides }
    : profile.identityCarry ? { pose: profile.identityCarry } : {}
  const sourcePath = isAbsolute(source) ? source : resolve(ROOT, source)
  const sourceLabel = relative(ROOT, sourcePath)
  const fixture = {
    source: sourceLabel,
    note: 'Bind-pose joint positions in the body frame (+Y up, +Z forward, +X left), in model units.',
    ...(carryClip ? {
      armCarryNote: `${profileName === 'kaykit' ? 'Right arm' : 'Arm'} absolute body-frame rotations averaged over ${carryClip}.`,
      carryClip,
    } : profile.identityCarry ? {
      armCarryNote: 'Identity absolute body-frame rotations keep both arms in their authored rest carry.',
    } : {
      armCarryNote: 'No weapon carry measured: the empty-hand carry is computed from the rest pose.',
    }),
    ...extractRigGeometry(body, profile.joints, profile.optional, carry),
  }
  return fixture
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const [source = join(ROOT, 'public', 'models', 'player.glb'), profile = 'kaykit'] = args
  const carryClip = args.length === 0 ? KAYKIT_CARRY_CLIP : args.length === 4 ? args[2] : undefined
  const output = args.length === 0 ? FIXTURE : args.at(-1)
  if ((args.length !== 0 && args.length !== 3 && args.length !== 4) || !output) {
    throw new Error('usage: node scripts/extract-rig-geometry.mjs <glb> <profile> [carry-clip] <output>')
  }
  const fixture = createRigFixture(readFileSync(source), source, profile, carryClip)
  writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`wrote ${output}`)
}
