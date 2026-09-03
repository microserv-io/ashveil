import * as THREE from 'three'
import { CAPSULE, type DrapeColliders } from './drapecollide'
import { DRAPE, type DrapeState } from './drape'
import type { DrapeParams } from './drape'
import type { DrapeSupportDefinition } from './drapebones'

export const MAX_DRAPE_SUPPORTS_PER_SEGMENT = 24
export const MAX_DRAPE_SUPPORT_TERMS = 12
export const MAX_DRAPE_SEGMENTS = 6

export interface DrapeSurface {
  readonly count: number
  readonly segments: Uint8Array
  readonly offsets: Uint16Array
  readonly joints: Uint16Array
  readonly weights: Float32Array
  readonly positions: Float32Array
  readonly points: Float32Array
  readonly anchorOffsets: Uint16Array
  readonly anchorJoints: Uint16Array
  readonly anchorWeights: Float32Array
  readonly anchorPositions: Float32Array
  readonly anchors: Float32Array
  readonly normals: Float32Array
  readonly directions: Float32Array
  readonly clearance: Float32Array
  readonly matrices: Float32Array
  readonly bones: readonly THREE.Bone[]
  readonly inverses: readonly THREE.Matrix4[]
}

export interface DrapeSurfaceChain {
  readonly bones: readonly THREE.Bone[]
  readonly rig: THREE.Object3D
  readonly state: DrapeState
  readonly surface: DrapeSurface | null
  readonly colliders: DrapeColliders
  readonly params: DrapeParams
  readonly rest: Float32Array
  readonly swingAxis: Float32Array
  readonly sideAxis: Float32Array
}

export function bindDrapeSurface(
  definitions: readonly DrapeSupportDefinition[],
  skeleton: THREE.Skeleton,
  chainSegments = MAX_DRAPE_SEGMENTS,
): DrapeSurface | null {
  if (definitions.length === 0) return null
  const names = new Map(skeleton.bones.map((bone, at) => [bone.name, at]))
  const counts = new Uint8Array(MAX_DRAPE_SEGMENTS)
  let terms = 0
  let anchorTerms = 0
  for (const support of definitions) {
    if (support.segment < 0 || support.segment >= chainSegments) throw new Error('gear: drape support segment is out of range')
    if (++counts[support.segment]! > MAX_DRAPE_SUPPORTS_PER_SEGMENT) {
      throw new Error(`gear: drape segment ${support.segment} exceeds ${MAX_DRAPE_SUPPORTS_PER_SEGMENT} supports`)
    }
    if (support.terms.length === 0 || support.terms.length > MAX_DRAPE_SUPPORT_TERMS) {
      throw new Error(`gear: drape support has ${support.terms.length} skin terms`)
    }
    terms += support.terms.length
    anchorTerms += support.bodyTerms?.length ?? 0
  }
  const segments = new Uint8Array(definitions.length)
  const offsets = new Uint16Array(definitions.length + 1)
  const joints = new Uint16Array(terms)
  const weights = new Float32Array(terms)
  const positions = new Float32Array(terms * 3)
  const anchorOffsets = new Uint16Array(definitions.length + 1)
  const anchorJoints = new Uint16Array(anchorTerms)
  const anchorWeights = new Float32Array(anchorTerms)
  const anchorPositions = new Float32Array(anchorTerms * 3)
  const normals = new Float32Array(definitions.length * 3)
  const clearance = new Float32Array(definitions.length)
  let term = 0
  let anchorTerm = 0
  definitions.forEach((support, at) => {
    segments[at] = support.segment
    offsets[at] = term
    for (const source of support.terms) {
      const joint = names.get(source.joint)
      if (joint === undefined) throw new Error(`gear: drape support names missing joint "${source.joint}"`)
      joints[term] = joint
      weights[term] = source.weight
      positions.set(source.position, term * 3)
      term++
    }
    anchorOffsets[at] = anchorTerm
    for (const source of support.bodyTerms ?? []) {
      const joint = names.get(source.joint)
      if (joint === undefined) throw new Error(`gear: drape body support names missing joint "${source.joint}"`)
      anchorJoints[anchorTerm] = joint
      anchorWeights[anchorTerm] = source.weight
      anchorPositions.set(source.position, anchorTerm * 3)
      anchorTerm++
    }
    normals.set(support.normal ?? [0, 0, 0], at * 3)
    clearance[at] = support.clearance ?? 0
  })
  offsets[definitions.length] = term
  anchorOffsets[definitions.length] = anchorTerm
  return {
    count: definitions.length,
    segments,
    offsets,
    joints,
    weights,
    positions,
    points: new Float32Array(definitions.length * 3),
    anchorOffsets,
    anchorJoints,
    anchorWeights,
    anchorPositions,
    anchors: new Float32Array(definitions.length * 3),
    normals,
    directions: new Float32Array(definitions.length * 3),
    clearance,
    matrices: new Float32Array(skeleton.bones.length * 16),
    bones: skeleton.bones,
    inverses: skeleton.boneInverses,
  }
}

/** Bounded coordinate descent against the exact LBS samples emitted by the fitter. */
export function solveDrapeSurface(chain: DrapeSurfaceChain): void {
  const surface = chain.surface
  if (surface === null || chain.colliders.count === 0) return
  refresh(chain)
  if (penetration(surface, chain.colliders, chain.params.clearance, 0) <= EPSILON) return
  for (const step of SEARCH_STEPS) {
    for (let iteration = 0; iteration < MAX_SEARCH_ITERATIONS; iteration++) {
      let changed = false
      for (let segment = 0; segment < chain.bones.length; segment++) {
        changed = searchAxis(chain, chain.state.swing, chain.state.swingRate, segment,
          -DRAPE.towardLimit, DRAPE.awayLimit, step) || changed
        changed = searchAxis(chain, chain.state.side, chain.state.sideRate, segment,
          -DRAPE.sideLimit, DRAPE.sideLimit, step) || changed
      }
      if (!changed) break
    }
  }
}

function searchAxis(
  chain: DrapeSurfaceChain,
  angles: Float32Array,
  rates: Float32Array,
  segment: number,
  low: number,
  high: number,
  step: number,
): boolean {
  const score = penetration(chain.surface!, chain.colliders, chain.params.clearance, segment)
  const original = angles[segment]!
  for (let at = segment; at < angles.length; at++) ORIGINAL[at] = angles[at]!
  let bestAngle = original
  let best = score
  for (const direction of [-1, 1]) {
    const candidate = Math.max(low, Math.min(high, original + direction * step))
    if (candidate === original) continue
    turnFrom(angles, segment, candidate - original, low, high)
    refresh(chain)
    const found = penetration(chain.surface!, chain.colliders, chain.params.clearance, segment)
    restore(angles, segment)
    if (found + EPSILON < best) {
      best = found
      bestAngle = candidate
    }
  }
  if (bestAngle !== original) {
    turnFrom(angles, segment, bestAngle - original, low, high)
    rates[segment] = 0
  }
  refresh(chain)
  return bestAngle !== original
}

function turnFrom(angles: Float32Array, segment: number, delta: number, low: number, high: number): void {
  for (let at = segment; at < angles.length; at++) {
    angles[at] = Math.max(low, Math.min(high, angles[at]! + delta))
  }
}

function restore(angles: Float32Array, segment: number): void {
  for (let at = segment; at < angles.length; at++) angles[at] = ORIGINAL[at]!
}

function refresh(chain: DrapeSurfaceChain): void {
  writeDrapeBones(chain)
  chain.bones[0]!.updateMatrixWorld(true)
  chain.rig.updateWorldMatrix(true, false)
  RIG_INVERSE.copy(chain.rig.matrixWorld).invert()
  const surface = chain.surface!
  for (let at = 0; at < surface.bones.length; at++) {
    MATRIX.copy(surface.bones[at]!.matrixWorld).multiply(surface.inverses[at]!).premultiply(RIG_INVERSE)
    MATRIX.toArray(surface.matrices, at * 16)
  }
  skinSupports(surface)
  skinAnchors(surface)
}

function skinSupports(surface: DrapeSurface): void {
  for (let support = 0; support < surface.count; support++) {
    let x = 0
    let y = 0
    let z = 0
    for (let term = surface.offsets[support]!; term < surface.offsets[support + 1]!; term++) {
      const matrix = surface.joints[term]! * 16
      const point = term * 3
      const px = surface.positions[point]!
      const py = surface.positions[point + 1]!
      const pz = surface.positions[point + 2]!
      const weight = surface.weights[term]!
      x += (surface.matrices[matrix]! * px + surface.matrices[matrix + 4]! * py
        + surface.matrices[matrix + 8]! * pz + surface.matrices[matrix + 12]!) * weight
      y += (surface.matrices[matrix + 1]! * px + surface.matrices[matrix + 5]! * py
        + surface.matrices[matrix + 9]! * pz + surface.matrices[matrix + 13]!) * weight
      z += (surface.matrices[matrix + 2]! * px + surface.matrices[matrix + 6]! * py
        + surface.matrices[matrix + 10]! * pz + surface.matrices[matrix + 14]!) * weight
    }
    surface.points[support * 3] = x
    surface.points[support * 3 + 1] = y
    surface.points[support * 3 + 2] = z
  }
}

function skinAnchors(surface: DrapeSurface): void {
  for (let support = 0; support < surface.count; support++) {
    let x = 0
    let y = 0
    let z = 0
    let nx = 0
    let ny = 0
    let nz = 0
    const normal = support * 3
    for (let term = surface.anchorOffsets[support]!; term < surface.anchorOffsets[support + 1]!; term++) {
      const matrix = surface.anchorJoints[term]! * 16
      const point = term * 3
      const px = surface.anchorPositions[point]!
      const py = surface.anchorPositions[point + 1]!
      const pz = surface.anchorPositions[point + 2]!
      const weight = surface.anchorWeights[term]!
      x += (surface.matrices[matrix]! * px + surface.matrices[matrix + 4]! * py
        + surface.matrices[matrix + 8]! * pz + surface.matrices[matrix + 12]!) * weight
      y += (surface.matrices[matrix + 1]! * px + surface.matrices[matrix + 5]! * py
        + surface.matrices[matrix + 9]! * pz + surface.matrices[matrix + 13]!) * weight
      z += (surface.matrices[matrix + 2]! * px + surface.matrices[matrix + 6]! * py
        + surface.matrices[matrix + 10]! * pz + surface.matrices[matrix + 14]!) * weight
      nx += (surface.matrices[matrix]! * surface.normals[normal]!
        + surface.matrices[matrix + 4]! * surface.normals[normal + 1]!
        + surface.matrices[matrix + 8]! * surface.normals[normal + 2]!) * weight
      ny += (surface.matrices[matrix + 1]! * surface.normals[normal]!
        + surface.matrices[matrix + 5]! * surface.normals[normal + 1]!
        + surface.matrices[matrix + 9]! * surface.normals[normal + 2]!) * weight
      nz += (surface.matrices[matrix + 2]! * surface.normals[normal]!
        + surface.matrices[matrix + 6]! * surface.normals[normal + 1]!
        + surface.matrices[matrix + 10]! * surface.normals[normal + 2]!) * weight
    }
    surface.anchors[normal] = x
    surface.anchors[normal + 1] = y
    surface.anchors[normal + 2] = z
    const length = Math.hypot(nx, ny, nz)
    surface.directions[normal] = length < EPSILON ? 0 : nx / length
    surface.directions[normal + 1] = length < EPSILON ? 0 : ny / length
    surface.directions[normal + 2] = length < EPSILON ? 0 : nz / length
  }
}

function penetration(surface: DrapeSurface, colliders: DrapeColliders, clearance: number, changed: number): number {
  let total = 0
  for (let support = 0; support < surface.count; support++) {
    if (surface.segments[support]! < changed) continue
    const point = support * 3
    if (surface.anchorOffsets[support + 1]! > surface.anchorOffsets[support]!) {
      const separation = (surface.points[point]! - surface.anchors[point]!) * surface.directions[point]!
        + (surface.points[point + 1]! - surface.anchors[point + 1]!) * surface.directions[point + 1]!
        + (surface.points[point + 2]! - surface.anchors[point + 2]!) * surface.directions[point + 2]!
      const inside = surface.clearance[support]! - separation
      if (inside > 0) total += inside * inside
    }
    for (let collider = 0; collider < colliders.count; collider++) {
      const capsule = collider * CAPSULE
      const depth = capsuleDepth(colliders.capsules, capsule,
        surface.points[point]!, surface.points[point + 1]!, surface.points[point + 2]!)
      const inside = colliders.capsules[capsule + 6]! + clearance - depth
      if (inside > 0) total += inside * inside
    }
  }
  return total
}

function capsuleDepth(values: Float32Array, at: number, px: number, py: number, pz: number): number {
  const x = values[at]!
  const y = values[at + 1]!
  const z = values[at + 2]!
  const dx = values[at + 3]! - x
  const dy = values[at + 4]! - y
  const dz = values[at + 5]! - z
  const span = dx * dx + dy * dy + dz * dz
  const raw = span < EPSILON ? 0 : ((px - x) * dx + (py - y) * dy + (pz - z) * dz) / span
  const along = Math.max(0, Math.min(1, raw))
  return Math.hypot(px - x - dx * along, py - y - dy * along, pz - z - dz * along)
}

/** Kept local to avoid a circular import through drapestep. */
function writeDrapeBones(chain: DrapeSurfaceChain): void {
  let parentSwing = 0
  let parentSide = 0
  for (let at = 0; at < chain.bones.length; at++) {
    AXIS.fromArray(chain.swingAxis, at * 3)
    SWING.setFromAxisAngle(AXIS, chain.state.swing[at]! - parentSwing)
    AXIS.fromArray(chain.sideAxis, at * 3)
    SIDE.setFromAxisAngle(AXIS, chain.state.side[at]! - parentSide)
    chain.bones[at]!.quaternion
      .fromArray(chain.rest, at * 4)
      .multiply(SWING)
      .multiply(SIDE)
    parentSwing = chain.state.swing[at]!
    parentSide = chain.state.side[at]!
  }
}

const SEARCH_STEPS = [8, 3, 1].map((degrees) => degrees * Math.PI / 180)
const MAX_SEARCH_ITERATIONS = 12
const EPSILON = 1e-9
const MATRIX = new THREE.Matrix4()
const RIG_INVERSE = new THREE.Matrix4()
const AXIS = new THREE.Vector3()
const SWING = new THREE.Quaternion()
const SIDE = new THREE.Quaternion()
const ORIGINAL = new Float32Array(MAX_DRAPE_SEGMENTS)
