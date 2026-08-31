import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  POSE_FRAMES,
  REQUIRED_SEMANTIC_MESHES,
  type CharacterAssetSummary,
  type SemanticMeshName,
} from './review-contract'

export interface RigReport {
  status: string
  jointFit: {
    contract: string
    maximumErrorMetres: number
    pass: boolean
    joints: { name: string; pass: boolean }[]
  }
  pelvisCogFit: {
    pelvisToHipMidpointMetres: number
    cogToHipMidpointMetres: number
    pass: boolean
  }
  orientationEvidence: {
    pass: boolean
    poses: Array<{ name: string; axialTwistDegrees: Record<string, number>; pass: boolean }>
  }
  bakeVerification: { reopenedSavedBlend: boolean; pass: boolean }
  poseIntent: {
    pass: boolean
    leadHand: string
    leadLeg: string
    trailLeg: string
    poses: Array<{
      name: string
      pass: boolean
      targetErrorMetres?: number
      actualFlexionDegrees?: number
      intendedWorldYawDegrees?: number
      actualWorldYawDegrees?: number
      leadFootWorldDelta?: number[]
      trailFootGroundErrorMetres?: number
      knees?: { L: { flexionDegrees: number }; R: { flexionDegrees: number } }
    }>
  }
  animation: {
    name: string
    framesPerSecond: number
    frameStart: number
    frameEnd: number
    poses: { name: string; frame: number }[]
  }
}

export interface ConfiguredAsset {
  semanticMeshes: Map<SemanticMeshName, THREE.SkinnedMesh>
  materials: { material: THREE.Material; wireframe: boolean }[]
  meshes: number
  primitives: number
  materialCount: number
}

export function assertRigReport(candidate: RigReport): void {
  const failures: string[] = []
  if (candidate.status !== 'diagnostic_not_production_ready') {
    failures.push('report status must be diagnostic_not_production_ready')
  }
  if (candidate.animation.name !== 'Ashveil_RigStress') failures.push('report must describe Ashveil_RigStress')
  if (candidate.jointFit.contract !== 'humanoid.v1' || !candidate.jointFit.pass) {
    failures.push('report must contain a passing humanoid.v1 fitted-joint audit')
  }
  if (!candidate.poseIntent.pass) failures.push('report must contain passing evaluated pose intent')
  if (!candidate.pelvisCogFit.pass) failures.push('report must contain passing pelvis and COG fit')
  if (!candidate.orientationEvidence.pass) failures.push('report must contain passing evaluated orientation evidence')
  if (!candidate.bakeVerification.reopenedSavedBlend || !candidate.bakeVerification.pass) {
    failures.push('report must contain passing reopened authoring-to-deform bake evidence')
  }
  if (!Number.isFinite(candidate.animation.framesPerSecond) || candidate.animation.framesPerSecond <= 0) {
    failures.push('report animation FPS must be positive')
  }
  const actual = Object.fromEntries(candidate.animation.poses.map((pose) => [pose.name, pose.frame]))
  for (const [name, frame] of Object.entries(POSE_FRAMES)) {
    if (actual[name] !== frame) failures.push(`report pose ${name} must map to frame ${frame}`)
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

export function summarizeAsset(gltf: GLTF): CharacterAssetSummary {
  const semantic: Record<string, { skinned: boolean }> = {}
  const skeletons = new Set<string>()
  const joints = new Set<string>()
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((child) => {
    if (REQUIRED_SEMANTIC_MESHES.includes(child.name as SemanticMeshName)) {
      semantic[child.name] = { skinned: child instanceof THREE.SkinnedMesh }
    }
    if (child instanceof THREE.SkinnedMesh) {
      skeletons.add(child.skeleton.uuid)
      child.skeleton.bones.forEach((bone) => joints.add(bone.uuid))
    }
  })
  const bounds = new THREE.Box3().setFromObject(gltf.scene, true)
  return {
    skins: skeletons.size,
    joints: joints.size,
    clips: gltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration })),
    semanticMeshes: semantic,
    bounds: {
      minimum: [bounds.min.x, bounds.min.y, bounds.min.z],
      maximum: [bounds.max.x, bounds.max.y, bounds.max.z],
    },
  }
}

export function configureAsset(root: THREE.Object3D): ConfiguredAsset {
  const semanticMeshes = new Map<SemanticMeshName, THREE.SkinnedMesh>()
  const materials: { material: THREE.Material; wireframe: boolean }[] = []
  const seenMaterials = new Set<string>()
  let meshes = 0
  let primitives = 0
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    meshes++
    primitives += Math.max(1, child.geometry.groups.length)
    child.castShadow = true
    child.receiveShadow = true
    if (REQUIRED_SEMANTIC_MESHES.includes(child.name as SemanticMeshName) && child instanceof THREE.SkinnedMesh) {
      semanticMeshes.set(child.name as SemanticMeshName, child)
    }
    const assigned = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of assigned) {
      if (seenMaterials.has(material.uuid)) continue
      seenMaterials.add(material.uuid)
      if ('wireframe' in material && typeof material.wireframe === 'boolean') {
        materials.push({ material, wireframe: material.wireframe })
      }
    }
  })
  return { semanticMeshes, materials, meshes, primitives, materialCount: seenMaterials.size }
}
