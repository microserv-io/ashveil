import * as THREE from 'three'
import type { GearMaterial, GearSetId } from './gear-source'

export type CollisionPoint = readonly [number, number, number]

export interface GearCollisionEnvelope {
  readonly startRadius: number
  readonly endRadius: number
}

export interface GearCollisionCapsuleProfile {
  readonly startJoint: string
  readonly endJoint: string
  readonly startOffset: CollisionPoint
  readonly endOffset: CollisionPoint
  readonly bodyEnvelope: GearCollisionEnvelope
  readonly legEnvelopes: Readonly<Partial<Record<GearSetId, GearCollisionEnvelope>>>
  readonly bootEnvelopes: Readonly<Partial<Record<GearSetId, GearCollisionEnvelope>>>
}

export interface GearCollisionProfile {
  readonly key: string
  readonly bodySha256: string
  readonly setId: GearSetId
  readonly partNode: string
  readonly rootJoint: string
  readonly fullStrengthBelowY: number
  readonly zeroAboveY: number
  readonly capsules: readonly GearCollisionCapsuleProfile[]
}

export interface PosedCollisionCapsule {
  readonly start: CollisionPoint
  readonly end: CollisionPoint
  readonly restStart: CollisionPoint
  readonly restEnd: CollisionPoint
  readonly startRadius: number
  readonly endRadius: number
}

const BODY_SHA256 = 'd586edf0e2b2e86247932a9f9e62f514463d6daa05569228f9076edb9f67479c'
const ZERO_OFFSET = [0, 0, 0] as const

// These are conservative radial supports for the approved body and equipped leg silhouettes.
const BODY_THIGH = { startRadius: 0.12, endRadius: 0.095 }
const STARTER_THIGH = { startRadius: 0.13, endRadius: 0.11 }
const MAGE_THIGH = { startRadius: 0.15, endRadius: 0.145 }
const BODY_CALF = { startRadius: 0.075, endRadius: 0.085 }
const STARTER_CALF_LEGS = { startRadius: 0.09, endRadius: 0.095 }
const STARTER_CALF_BOOTS = { startRadius: 0.08, endRadius: 0.105 }
const MAGE_CALF_LEGS = { startRadius: 0.145, endRadius: 0.13 }
const MAGE_CALF_BOOTS = { startRadius: 0.165, endRadius: 0.145 }
const BODY_FOOT = { startRadius: 0.085, endRadius: 0.075 }
const STARTER_FOOT = { startRadius: 0.11, endRadius: 0.1 }
const MAGE_FOOT = { startRadius: 0.145, endRadius: 0.14 }

function thighCapsule(side: 'l' | 'r'): GearCollisionCapsuleProfile {
  return {
    startJoint: `thigh_stretch.${side}`,
    endJoint: `leg_stretch.${side}`,
    startOffset: ZERO_OFFSET,
    endOffset: ZERO_OFFSET,
    bodyEnvelope: BODY_THIGH,
    legEnvelopes: {
      'starter-leather': STARTER_THIGH,
      'arcane-mage-tier': MAGE_THIGH,
    },
    bootEnvelopes: {},
  }
}

function legCapsule(side: 'l' | 'r'): GearCollisionCapsuleProfile {
  return {
    startJoint: `leg_stretch.${side}`,
    endJoint: `foot.${side}`,
    startOffset: ZERO_OFFSET,
    endOffset: ZERO_OFFSET,
    bodyEnvelope: BODY_CALF,
    legEnvelopes: {
      'starter-leather': STARTER_CALF_LEGS,
      'arcane-mage-tier': MAGE_CALF_LEGS,
    },
    bootEnvelopes: {
      'starter-leather': STARTER_CALF_BOOTS,
      'arcane-mage-tier': MAGE_CALF_BOOTS,
    },
  }
}

function footCapsule(side: 'l' | 'r'): GearCollisionCapsuleProfile {
  return {
    startJoint: `foot.${side}`,
    endJoint: `toes_01.${side}`,
    startOffset: ZERO_OFFSET,
    endOffset: ZERO_OFFSET,
    bodyEnvelope: BODY_FOOT,
    legEnvelopes: {},
    bootEnvelopes: {
      'starter-leather': STARTER_FOOT,
      'arcane-mage-tier': MAGE_FOOT,
    },
  }
}

export const GEAR_COLLISION_PROFILES: readonly GearCollisionProfile[] = [validateGearCollisionProfile({
  key: 'masculine-clean-v1:arcane-mage-tier:robe-skirt-v1',
  bodySha256: BODY_SHA256,
  setId: 'arcane-mage-tier',
  partNode: 'ArcaneMageRobeSkirt',
  rootJoint: 'root.x',
  fullStrengthBelowY: 0.68,
  zeroAboveY: 0.94,
  capsules: [
    thighCapsule('l'), thighCapsule('r'),
    legCapsule('l'), legCapsule('r'),
    footCapsule('l'), footCapsule('r'),
  ],
})]

export function validateGearCollisionProfile(profile: GearCollisionProfile): GearCollisionProfile {
  if (!profile.key || !profile.rootJoint || !/^[0-9a-f]{64}$/.test(profile.bodySha256)
    || !Number.isFinite(profile.fullStrengthBelowY) || !Number.isFinite(profile.zeroAboveY)
    || profile.fullStrengthBelowY >= profile.zeroAboveY
    || profile.capsules.length === 0) {
    throw new Error(`Gear collision profile is invalid: ${profile.key || 'unnamed'}.`)
  }
  for (const capsule of profile.capsules) {
    if (!capsule.startJoint || !capsule.endJoint
      || [...capsule.startOffset, ...capsule.endOffset].some((value) => !Number.isFinite(value))) {
      throw new Error(`Gear collision profile has invalid joints or offsets: ${profile.key}.`)
    }
    for (const envelope of [
      capsule.bodyEnvelope,
      ...Object.values(capsule.legEnvelopes),
      ...Object.values(capsule.bootEnvelopes),
    ]) {
      if (!Number.isFinite(envelope.startRadius) || !Number.isFinite(envelope.endRadius)
        || envelope.startRadius <= 0 || envelope.endRadius <= 0) {
        throw new Error(`Gear collision profile has invalid radii: ${profile.key}.`)
      }
    }
  }
  return profile
}

export function gearCollisionProfile(
  bodySha256: string,
  setId: GearSetId,
  partNode: string,
): GearCollisionProfile | undefined {
  return GEAR_COLLISION_PROFILES.find((profile) => profile.bodySha256 === bodySha256
    && profile.setId === setId && profile.partNode === partNode)
}

export function gearCollisionEnvelope(
  capsule: GearCollisionCapsuleProfile,
  legs: GearSetId | null,
  boots: GearSetId | null,
): GearCollisionEnvelope {
  const leg = legs ? capsule.legEnvelopes[legs] : undefined
  const boot = boots ? capsule.bootEnvelopes[boots] : undefined
  return {
    startRadius: Math.max(
      capsule.bodyEnvelope.startRadius,
      leg?.startRadius ?? 0,
      boot?.startRadius ?? 0,
    ),
    endRadius: Math.max(
      capsule.bodyEnvelope.endRadius,
      leg?.endRadius ?? 0,
      boot?.endRadius ?? 0,
    ),
  }
}

export function resolveCapsuleCollision(
  point: CollisionPoint,
  bindPoint: CollisionPoint,
  restRoot: CollisionPoint,
  posedRoot: CollisionPoint,
  rootFollowingPoint: CollisionPoint,
  bindY: number,
  capsules: readonly PosedCollisionCapsule[],
  fullStrengthBelowY: number,
  zeroAboveY: number,
): CollisionPoint {
  const feather = smoothstep(fullStrengthBelowY, zeroAboveY, bindY)
  const mask = 1 - feather
  if (mask <= 0) return [...point]
  const restDirection = radialDirection(bindPoint, restRoot)
  const posedDirection = radialDirection(rootFollowingPoint, posedRoot, restDirection)
  const restSupport = envelopeSupport(restDirection, bindY, capsules, false)
  const posedSupport = envelopeSupport(posedDirection, rootFollowingPoint[1], capsules, true)
  const change = Math.max(0, posedSupport - restSupport)
  const onset = smoothstep(0, OUTWARD_ONSET, change)
  return [
    point[0] + posedDirection[0] * change * onset * mask,
    point[1],
    point[2] + posedDirection[2] * change * onset * mask,
  ]
}

const SUPPORT_SHARPNESS = 48
const HEIGHT_PENALTY = 2.5
const OUTWARD_ONSET = 0.01

function radialDirection(
  point: CollisionPoint,
  root: CollisionPoint,
  fallback: CollisionPoint = [point[0] < root[0] ? -1 : 1, 0, 0],
): CollisionPoint {
  const x = point[0] - root[0]
  const z = point[2] - root[2]
  const length = Math.hypot(x, z)
  return length > 1e-8 ? [x / length, 0, z / length] : fallback
}

function envelopeSupport(
  direction: CollisionPoint,
  height: number,
  capsules: readonly PosedCollisionCapsule[],
  posed: boolean,
): number {
  let result = Number.NEGATIVE_INFINITY
  for (const capsule of capsules) {
    result = smoothMaximum(result, capsuleSupport(direction, height, capsule, posed), SUPPORT_SHARPNESS)
  }
  return result
}

function capsuleSupport(
  direction: CollisionPoint,
  height: number,
  capsule: PosedCollisionCapsule,
  posed: boolean,
): number {
  const start = posed ? capsule.start : capsule.restStart
  const end = posed ? capsule.end : capsule.restEnd
  const endpoint0 = pointSupport(direction, height, start, capsule.startRadius)
  const endpoint1 = pointSupport(direction, height, end, capsule.endRadius)
  const deltaY = end[1] - start[1]
  const along = Math.abs(deltaY) > 1e-8 ? clamp((height - start[1]) / deltaY, 0, 1) : 0.5
  const center: CollisionPoint = [
    start[0] + (end[0] - start[0]) * along,
    start[1] + deltaY * along,
    start[2] + (end[2] - start[2]) * along,
  ]
  const radius = capsule.startRadius + (capsule.endRadius - capsule.startRadius) * along
  return smoothMaximum(
    smoothMaximum(endpoint0, endpoint1, SUPPORT_SHARPNESS),
    pointSupport(direction, height, center, radius),
    SUPPORT_SHARPNESS,
  )
}

function pointSupport(direction: CollisionPoint, height: number, center: CollisionPoint, radius: number): number {
  return center[0] * direction[0] + center[2] * direction[2] + radius
    - HEIGHT_PENALTY * Math.abs(height - center[1])
}

function smoothMaximum(left: number, right: number, sharpness: number): number {
  if (left === Number.NEGATIVE_INFINITY) return right
  const maximum = Math.max(left, right)
  return maximum + Math.log1p(Math.exp(-sharpness * Math.abs(left - right))) / sharpness
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return amount * amount * (3 - 2 * amount)
}

interface CapsuleUniforms {
  readonly startJoints: Float32Array
  readonly endJoints: Float32Array
  readonly startRest: readonly THREE.Vector3[]
  readonly endRest: readonly THREE.Vector3[]
  readonly startRadii: Float32Array
  readonly endRadii: Float32Array
  readonly rootJoint: number
  readonly rootRest: THREE.Vector3
  readonly fullStrengthBelowY: number
  readonly zeroAboveY: number
}

interface ScopedGeometry {
  readonly mesh: THREE.SkinnedMesh
  readonly source: THREE.BufferGeometry
  readonly scoped: THREE.BufferGeometry
}

export interface GearCollisionInstance {
  setEquipment(legs: GearSetId | null, boots: GearSetId | null): void
  dispose(): void
}

export function createGearCollisionInstance(
  profile: GearCollisionProfile,
  bodyMesh: THREE.SkinnedMesh,
  partRoot: THREE.Object3D,
  materialScopeRoots: readonly THREE.Object3D[],
): GearCollisionInstance {
  const uniforms = collisionUniforms(profile, bodyMesh)
  const patchedMaterials = new Set<GearMaterial>()
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  const distance = new THREE.MeshDistanceMaterial()
  installCapsuleCollisionShader(depth, uniforms, `${profile.key}:depth`)
  installCapsuleCollisionShader(distance, uniforms, `${profile.key}:distance`)
  const shadowMaterials = [depth, distance] as const
  const meshes: THREE.SkinnedMesh[] = []
  const scopedGeometries: ScopedGeometry[] = []
  try {
    partRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      if (object.skeleton !== bodyMesh.skeleton) throw new Error(`Collision part ${profile.partNode} does not use the approved body skeleton.`)
      meshes.push(object)
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        const gearMaterial = material as GearMaterial
        if (!patchedMaterials.has(gearMaterial)) {
          installCapsuleCollisionShader(gearMaterial, uniforms, profile.key)
          patchedMaterials.add(gearMaterial)
        }
      }
      object.customDepthMaterial = depth
      object.customDistanceMaterial = distance
    })
    if (meshes.length === 0) throw new Error(`Collision part ${profile.partNode} has no skinned meshes.`)
    const collisionMeshes = new Set(meshes)
    for (const scopeRoot of materialScopeRoots) scopeRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (!materials.some((material) => patchedMaterials.has(material as GearMaterial))) return
      scopedGeometries.push(scopeCollisionGeometry(object, collisionMeshes.has(object)))
    })
  } catch (error) {
    for (const mesh of meshes) {
      mesh.customDepthMaterial = undefined
      mesh.customDistanceMaterial = undefined
    }
    restoreScopedGeometries(scopedGeometries)
    for (const material of shadowMaterials) material.dispose()
    throw error
  }

  return {
    setEquipment(legs, boots): void {
      for (let index = 0; index < profile.capsules.length; index++) {
        const envelope = gearCollisionEnvelope(profile.capsules[index]!, legs, boots)
        uniforms.startRadii[index] = envelope.startRadius
        uniforms.endRadii[index] = envelope.endRadius
      }
    },
    dispose(): void {
      for (const mesh of meshes) {
        mesh.customDepthMaterial = undefined
        mesh.customDistanceMaterial = undefined
      }
      restoreScopedGeometries(scopedGeometries)
      for (const material of shadowMaterials) material.dispose()
    },
  }
}

function scopeCollisionGeometry(mesh: THREE.SkinnedMesh, enabled: boolean): ScopedGeometry {
  const position = mesh.geometry.getAttribute('position')
  if (!position || position.count === 0) {
    throw new Error(`Collision material scope mesh has no positions: ${mesh.name}.`)
  }
  const source = mesh.geometry
  const scoped = source.clone()
  const values = new Uint8Array(position.count)
  if (enabled) values.fill(1)
  scoped.setAttribute('gearCollisionScope', new THREE.Uint8BufferAttribute(values, 1))
  mesh.geometry = scoped
  return { mesh, source, scoped }
}

function restoreScopedGeometries(scopedGeometries: readonly ScopedGeometry[]): void {
  for (const { mesh, source, scoped } of scopedGeometries) {
    if (mesh.geometry === scoped) mesh.geometry = source
    scoped.dispose()
  }
}

function collisionUniforms(profile: GearCollisionProfile, bodyMesh: THREE.SkinnedMesh): CapsuleUniforms {
  const startJoints: number[] = []
  const endJoints: number[] = []
  const startRest: THREE.Vector3[] = []
  const endRest: THREE.Vector3[] = []
  for (const capsule of profile.capsules) {
    const start = collisionJoint(bodyMesh, capsule.startJoint, capsule.startOffset)
    const end = collisionJoint(bodyMesh, capsule.endJoint, capsule.endOffset)
    startJoints.push(start.index)
    endJoints.push(end.index)
    startRest.push(start.bindPoint)
    endRest.push(end.bindPoint)
  }
  const root = collisionJoint(bodyMesh, profile.rootJoint, ZERO_OFFSET)
  const count = profile.capsules.length
  return {
    startJoints: new Float32Array(startJoints),
    endJoints: new Float32Array(endJoints),
    startRest,
    endRest,
    startRadii: new Float32Array(count).map((_, index) => profile.capsules[index]!.bodyEnvelope.startRadius),
    endRadii: new Float32Array(count).map((_, index) => profile.capsules[index]!.bodyEnvelope.endRadius),
    rootJoint: root.index,
    rootRest: root.bindPoint,
    fullStrengthBelowY: profile.fullStrengthBelowY,
    zeroAboveY: profile.zeroAboveY,
  }
}

function collisionJoint(
  bodyMesh: THREE.SkinnedMesh,
  rawJoint: string,
  offset: CollisionPoint,
): { readonly index: number; readonly bindPoint: THREE.Vector3 } {
  const joint = THREE.PropertyBinding.sanitizeNodeName(rawJoint)
  const index = bodyMesh.skeleton.bones.findIndex((bone) => bone.name === joint)
  const inverse = bodyMesh.skeleton.boneInverses[index]
  if (index < 0 || !inverse) throw new Error(`Collision profile joint is missing from the approved body: ${rawJoint}.`)
  const bindPoint = new THREE.Vector3(...offset)
    .applyMatrix4(new THREE.Matrix4().copy(inverse).invert())
  return { index, bindPoint }
}

export function installCapsuleCollisionShader(
  material: THREE.Material,
  uniforms: CapsuleUniforms,
  key: string,
): void {
  const previousCompile = material.onBeforeCompile.bind(material)
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer)
    shader.uniforms.gearCapsuleStartJoints = { value: uniforms.startJoints }
    shader.uniforms.gearCapsuleEndJoints = { value: uniforms.endJoints }
    shader.uniforms.gearCapsuleStartRest = { value: uniforms.startRest }
    shader.uniforms.gearCapsuleEndRest = { value: uniforms.endRest }
    shader.uniforms.gearCapsuleStartRadii = { value: uniforms.startRadii }
    shader.uniforms.gearCapsuleEndRadii = { value: uniforms.endRadii }
    shader.uniforms.gearCapsuleRootJoint = { value: uniforms.rootJoint }
    shader.uniforms.gearCapsuleRootRest = { value: uniforms.rootRest }
    shader.uniforms.gearCapsuleFullStrengthBelowY = { value: uniforms.fullStrengthBelowY }
    shader.uniforms.gearCapsuleZeroAboveY = { value: uniforms.zeroAboveY }
    shader.vertexShader = capsuleCollisionVertexShader(shader.vertexShader, uniforms.startJoints.length)
  }
  material.customProgramCacheKey = () => `${previousKey()}|ashveil-gear-capsules-v4:${key}`
  material.needsUpdate = true
}

export function capsuleCollisionVertexShader(source: string, capsuleCount = 6): string {
  const declarations = '#include <skinning_pars_vertex>'
  const deformation = '#include <skinning_vertex>'
  if (!source.includes(declarations) || !source.includes(deformation)) {
    throw new Error('Three.js skinning shader chunks required by gear collision are missing.')
  }
  if (!Number.isSafeInteger(capsuleCount) || capsuleCount <= 0) {
    throw new Error('Gear collision shader requires a positive capsule count.')
  }
  return source
    .replace(declarations, `${declarations}\n${capsuleDeclarations(capsuleCount)}`)
    .replace(deformation, `${deformation}\n${capsuleDeformation(capsuleCount)}`)
}

function capsuleDeclarations(capsuleCount: number): string {
  return /* glsl */`
#ifdef USE_SKINNING
attribute float gearCollisionScope;
uniform float gearCapsuleStartJoints[${capsuleCount}];
uniform float gearCapsuleEndJoints[${capsuleCount}];
uniform vec3 gearCapsuleStartRest[${capsuleCount}];
uniform vec3 gearCapsuleEndRest[${capsuleCount}];
uniform float gearCapsuleStartRadii[${capsuleCount}];
uniform float gearCapsuleEndRadii[${capsuleCount}];
uniform float gearCapsuleRootJoint;
uniform vec3 gearCapsuleRootRest;
uniform float gearCapsuleFullStrengthBelowY;
uniform float gearCapsuleZeroAboveY;

vec3 gearCapsulePoint(float joint, vec3 restPoint) {
  return (bindMatrixInverse * getBoneMatrix(joint) * bindMatrix * vec4(restPoint, 1.0)).xyz;
}

float gearSmoothMaximum(float left, float right) {
  float maximum = max(left, right);
  return maximum + log(1.0 + exp(-${SUPPORT_SHARPNESS.toFixed(1)} * abs(left - right)))
    / ${SUPPORT_SHARPNESS.toFixed(1)};
}

float gearPointSupport(vec2 direction, float height, vec3 center, float radius) {
  return dot(center.xz, direction) + radius
    - ${HEIGHT_PENALTY.toFixed(1)} * abs(height - center.y);
}

float gearTaperedCapsuleSupport(
  vec2 direction, float height, vec3 start, vec3 end, float startRadius, float endRadius
) {
  float deltaY = end.y - start.y;
  float along = abs(deltaY) > 1e-8 ? clamp((height - start.y) / deltaY, 0.0, 1.0) : 0.5;
  vec3 center = mix(start, end, along);
  float radius = mix(startRadius, endRadius, along);
  return gearSmoothMaximum(
    gearSmoothMaximum(
      gearPointSupport(direction, height, start, startRadius),
      gearPointSupport(direction, height, end, endRadius)
    ),
    gearPointSupport(direction, height, center, radius)
  );
}
#endif
`
}

function capsuleDeformation(capsuleCount: number): string {
  return /* glsl */`
#ifdef USE_SKINNING
float gearCapsuleMask = 1.0 - smoothstep(
  gearCapsuleFullStrengthBelowY, gearCapsuleZeroAboveY, position.y
);
if (gearCollisionScope > 0.5 && gearCapsuleMask > 0.0) {
  vec3 gearRootFollowingPoint = gearCapsulePoint(gearCapsuleRootJoint, position);
  vec3 gearPosedRoot = gearCapsulePoint(gearCapsuleRootJoint, gearCapsuleRootRest);
  vec2 gearRestRadial = position.xz - gearCapsuleRootRest.xz;
  vec2 gearFallbackRadial = vec2(position.x < gearCapsuleRootRest.x ? -1.0 : 1.0, 0.0);
  vec2 gearRestDirection = dot(gearRestRadial, gearRestRadial) > 1e-12
    ? normalize(gearRestRadial) : gearFallbackRadial;
  vec2 gearPosedRadial = gearRootFollowingPoint.xz - gearPosedRoot.xz;
  vec2 gearPosedDirection = dot(gearPosedRadial, gearPosedRadial) > 1e-12
    ? normalize(gearPosedRadial) : gearRestDirection;
  float gearRestEnvelope = -1e6;
  float gearPosedEnvelope = -1e6;
  for (int gearCapsuleIndex = 0; gearCapsuleIndex < ${capsuleCount}; gearCapsuleIndex++) {
    vec3 gearCapsuleStart = gearCapsulePoint(
      gearCapsuleStartJoints[gearCapsuleIndex], gearCapsuleStartRest[gearCapsuleIndex]
    );
    vec3 gearCapsuleEnd = gearCapsulePoint(
      gearCapsuleEndJoints[gearCapsuleIndex], gearCapsuleEndRest[gearCapsuleIndex]
    );
    gearRestEnvelope = gearSmoothMaximum(
      gearRestEnvelope,
      gearTaperedCapsuleSupport(
        gearRestDirection, position.y,
        gearCapsuleStartRest[gearCapsuleIndex], gearCapsuleEndRest[gearCapsuleIndex],
        gearCapsuleStartRadii[gearCapsuleIndex], gearCapsuleEndRadii[gearCapsuleIndex]
      )
    );
    gearPosedEnvelope = gearSmoothMaximum(
      gearPosedEnvelope,
      gearTaperedCapsuleSupport(
        gearPosedDirection, gearRootFollowingPoint.y,
        gearCapsuleStart, gearCapsuleEnd,
        gearCapsuleStartRadii[gearCapsuleIndex], gearCapsuleEndRadii[gearCapsuleIndex]
      )
    );
  }
  float gearOutwardChange = max(0.0, gearPosedEnvelope - gearRestEnvelope);
  float gearOutwardOnset = smoothstep(0.0, ${OUTWARD_ONSET.toFixed(2)}, gearOutwardChange);
  transformed.xz += gearPosedDirection * gearOutwardChange * gearOutwardOnset * gearCapsuleMask;
}
#endif
`
}
