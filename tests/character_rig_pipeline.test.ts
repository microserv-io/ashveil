import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { describe, expect, it } from 'vitest'
import {
  assertPreparedInput,
  characterRigSpikeArtifactNames,
  parseCharacterRigSpikeArgs,
} from '../scripts/art/character-rig-spike'
import {
  assertJointFitRecords,
  assertPoseOrientationEvidence,
  assertStrideIntent,
  mirrorNormalizedTwist,
  type PoseOrientationEvidence,
} from '../scripts/art/rig-contract'
import { summarizeAsset } from '../spike/character/asset-inspection'
import {
  assertCharacterAssetSummary,
  REQUIRED_SEMANTIC_MESHES,
} from '../spike/character/review-contract'
import { sampleTimeForFrame } from '../spike/character/view-contract'

const riggedDirectory = resolve(
  'docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged',
)

describe('diagnostic character rig artifact', () => {
  it('requires explicit prepared input and output directories', () => {
    expect(() => parseCharacterRigSpikeArgs([])).toThrow('Usage:')
    expect(
      parseCharacterRigSpikeArgs(['--input', 'prepared', '--output', 'rigged']),
    ).toEqual({ input: 'prepared', output: 'rigged' })
  })

  it('defines the complete rig artifact contract', () => {
    expect(characterRigSpikeArtifactNames).toHaveLength(23)
    expect(characterRigSpikeArtifactNames).toContain('masculine-rig-spike.blend')
    expect(characterRigSpikeArtifactNames).toContain('masculine-rigged-diagnostic.glb')
    expect(characterRigSpikeArtifactNames).toContain('validation-head-turn-right.png')
    expect(characterRigSpikeArtifactNames).toContain('validation-bind-skeleton-front.png')
    expect(characterRigSpikeArtifactNames).toContain('validation-bind-skeleton-right.png')
    expect(characterRigSpikeArtifactNames.at(-1)).toBe('report.json')
  })

  it('rejects a prepared blend whose report identity or file hash changed', () => {
    const preparedDirectory = resolve(
      'docs/art-pipeline/tripo-style-test/output/base-models/masculine/prepared',
    )
    const fixture = mkdtempSync(join(tmpdir(), 'ashveil-rig-preflight-'))
    try {
      for (const name of [
        'report.json',
        'masculine-character-spike.blend',
        'masculine-bald-base.glb',
      ]) {
        copyFileSync(resolve(preparedDirectory, name), resolve(fixture, name))
      }
      expect(() => assertPreparedInput(fixture)).not.toThrow()

      const reportPath = resolve(fixture, 'report.json')
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      const blendExport = report.exports.find(
        (entry: { path: string }) => entry.path === 'masculine-character-spike.blend',
      )
      blendExport.sha256 = '0'.repeat(64)
      writeFileSync(reportPath, `${JSON.stringify(report)}\n`)
      expect(() => assertPreparedInput(fixture)).toThrow(/audited masculine mannequin contract/)

      copyFileSync(resolve(preparedDirectory, 'report.json'), reportPath)
      writeFileSync(resolve(fixture, 'masculine-character-spike.blend'), 'mutated blend')
      expect(() => assertPreparedInput(fixture)).toThrow(/audited masculine mannequin contract/)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('records the complete skeleton, weight, animation, seam, and export contract', () => {
    const report = JSON.parse(readFileSync(resolve(riggedDirectory, 'report.json'), 'utf8'))

    expect(report.status).toBe('diagnostic_not_production_ready')
    expect(report.input.preserved).toBe(true)
    expect(report.skeleton).toMatchObject({
      contract: 'humanoid.v1',
      bones: 20,
      deformBones: 19,
    })
    expect(report.jointFit).toMatchObject({
      contract: 'humanoid.v1',
      pass: true,
    })
    expect(report.jointFit.maximumErrorMetres).toBeLessThanOrEqual(0.035)
    expect(report.jointFit.joints).toHaveLength(16)
    expect(report.jointFit.joints.every((joint: { pass: boolean }) => joint.pass)).toBe(true)
    expect(Object.fromEntries(report.jointFit.joints.map((joint: { name: string; targetWorld: number[] }) => [joint.name, joint.targetWorld]))).toMatchObject({
      'elbow.L': [0.305849, 0.065819, 1.172984],
      'elbow.R': [-0.305849, 0.065819, 1.172984],
      'wrist.L': [0.401192, 0.021153, 0.969471],
      'wrist.R': [-0.401192, 0.021153, 0.969471],
      'knee.L': [0.153949, 0.046848, 0.518357],
      'knee.R': [-0.153949, 0.046848, 0.518357],
      'ankle.L': [0.194607, 0.054018, 0.112667],
      'ankle.R': [-0.194607, 0.054018, 0.112667],
      neck: [0, 0.020663, 1.569322],
    })
    expect(report.jointFit.joints.every((joint: { sampleCount: number }) => joint.sampleCount >= 12)).toBe(true)
    expect(() => assertJointFitRecords(report.jointFit.joints)).not.toThrow()
    expect(report.pelvisCogFit).toMatchObject({ pass: true })
    expect(report.pelvisCogFit.pelvisToHipMidpointMetres).toBeLessThanOrEqual(0.02)
    expect(report.pelvisCogFit.cogToHipMidpointMetres).toBeLessThanOrEqual(0.02)
    expect(report.bindGeometryMaximumDeviationMetres).toBeLessThanOrEqual(0.0001)
    expect(report.orientationEvidence).toMatchObject({ pass: true })
    expect(report.bakeVerification).toMatchObject({
      reopenedSavedBlend: true,
      deformConstraintCount: 0,
      pass: true,
    })
    expect(report.weights).toMatchObject({
      vertices: 7966,
      weightedVertices: 7966,
      maximumInfluences: 4,
      normalized: true,
      finite: true,
      sharedArmatureModifier: true,
    })
    expect(report.animation).toMatchObject({
      name: 'Ashveil_RigStress',
      framesPerSecond: 30,
      frameStart: 0,
      frameEnd: 50,
      sourceInterpolation: 'CONSTANT',
      runtimeInterpolationModes: ['LINEAR', 'STEP'],
    })
    expect(report.animation.poses).toEqual([
      { name: 'bind', frame: 0 },
      { name: 'overhead-reach', frame: 10 },
      { name: 'cross-body-reach', frame: 20 },
      { name: 'deep-elbow-bend', frame: 30 },
      { name: 'long-stride', frame: 40 },
      { name: 'head-turn', frame: 50 },
    ])
    expect(report.poseIntent).toMatchObject({
      contract: 'humanoid.v1',
      forward: [0, -1, 0],
      leadHand: 'hand.L',
      leadLeg: 'leg.L',
      trailLeg: 'leg.R',
      pass: true,
    })
    const attack = report.poseIntent.poses.find(
      (pose: { name: string }) => pose.name === 'cross-body-reach',
    )
    expect(attack).toMatchObject({ pass: true, leadHand: 'hand.L', crossedMidline: true })
    expect(attack.targetErrorMetres).toBeLessThanOrEqual(0.04)
    expect(attack.verticalTargetErrorMetres).toBeLessThanOrEqual(0.04)
    const stride = report.poseIntent.poses.find((pose: { name: string }) => pose.name === 'long-stride')
    expect(stride).toMatchObject({
      pass: true,
      leadLeg: 'leg.L',
      trailLeg: 'leg.R',
      kneesStayOnAnatomicalSide: true,
    })
    expect(stride.pelvisWorldDelta[2]).toBeLessThanOrEqual(-0.02)
    expect(stride.pelvisWorldDelta[2]).toBeGreaterThanOrEqual(-0.04)
    expect(Math.abs(stride.pelvisWorldDelta[1])).toBeLessThanOrEqual(0.02)
    expect(stride.leadFootWorldDelta[1]).toBeLessThanOrEqual(-0.12)
    expect(stride.leadFootWorldDelta[2]).toBeGreaterThanOrEqual(0.04)
    expect(stride.trailFootDisplacementMetres).toBeLessThanOrEqual(0.035)
    expect(stride.trailFootGroundErrorMetres).toBeLessThanOrEqual(0.015)
    expect(stride.knees.L.kneeWorld[0]).toBeGreaterThan(0)
    expect(stride.knees.R.kneeWorld[0]).toBeLessThan(0)
    expect(stride.knees.L.signedSagittalBend).toBeGreaterThan(0)
    expect(stride.knees.R.signedSagittalBend).toBeGreaterThan(0)
    expect(stride.knees.L.flexionDegrees).toBeGreaterThan(5)
    expect(stride.knees.R.flexionDegrees).toBeGreaterThan(5)
    expect(() => assertStrideIntent(stride)).not.toThrow()
    const headTurn = report.poseIntent.poses.find((pose: { name: string }) => pose.name === 'head-turn')
    expect(Math.abs(headTurn.actualWorldYawDegrees - headTurn.intendedWorldYawDegrees)).toBeLessThanOrEqual(1)
    expect(report.seams.pass).toBe(true)
    expect(report.groundAndBounds.pass).toBe(true)
    expect(report.export.gltfStructure).toMatchObject({
      meshes: 7,
      primitives: 7,
      skins: 1,
      animations: 1,
      inverseBindMatrices: { count: 20, type: 'MAT4', componentType: 5126 },
      rigifyControlLeakage: [],
      authoringRigLeakage: [],
    })
    const manifest = JSON.parse(readFileSync(resolve('scripts/art/contracts/humanoid.v1.json'), 'utf8'))
    expect(report.skeleton.acceptedMaleRestSignatureSha256).toBe(
      manifest.acceptedMaleRestSignatureSha256,
    )
    expect(report.export.gltfStructure.jointNames.slice().sort()).toEqual(
      manifest.bones.map((bone: { gltfName: string }) => bone.gltfName).sort(),
    )
    expect(report.export.gltfStructure.skinnedMeshNames).toEqual([...REQUIRED_SEMANTIC_MESHES].sort())
    expect(report.renders).toHaveLength(18)
  })

  it('mirror-normalizes bilateral twist fixtures before comparing symmetry', () => {
    expect(mirrorNormalizedTwist('L', 20)).toBe(20)
    expect(mirrorNormalizedTwist('R', -20)).toBe(20)
    expect(() =>
      assertPoseOrientationEvidence({
        pose: 'overhead-reach',
        axialTwists: {
          'upper_arm.L': 20,
          'upper_arm.R': -20,
          'forearm.L': 10,
          'forearm.R': -10,
        },
        chainGapsMetres: {},
      }),
    ).not.toThrow()
    expect(() =>
      assertPoseOrientationEvidence({
        pose: 'overhead-reach',
        axialTwists: {
          'upper_arm.L': 20,
          'upper_arm.R': 20,
          'forearm.L': 10,
          'forearm.R': 10,
        },
        chainGapsMetres: {},
      }),
    ).toThrow(/bilateral twist/)
  })

  it('fails closed when fitted evidence or stride direction is perturbed', () => {
    const report = JSON.parse(readFileSync(resolve(riggedDirectory, 'report.json'), 'utf8'))
    const joints = structuredClone(report.jointFit.joints)
    joints.find((joint: { name: string }) => joint.name === 'knee.L').actualWorld[0] += 0.05
    expect(() => assertJointFitRecords(joints)).toThrow(/independently frozen target/)

    const swapped = structuredClone(
      report.poseIntent.poses.find((pose: { name: string }) => pose.name === 'long-stride'),
    )
    swapped.leadFootWorldDelta[1] = 0.13
    expect(() => assertStrideIntent(swapped)).toThrow(/displacement/)

    const invertedPole = structuredClone(
      report.poseIntent.poses.find((pose: { name: string }) => pose.name === 'long-stride'),
    )
    invertedPole.knees.L.signedSagittalBend *= -1
    expect(() => assertStrideIntent(invertedPole)).toThrow(/sagittal-plane/)
  })

  it('loads and clones the skinned GLB through the runtime Three.js seams', async () => {
    const bytes = readFileSync(resolve(riggedDirectory, 'masculine-rigged-diagnostic.glb'))
    const gltf = await parseGlb(bytes)
    expect(() => assertCharacterAssetSummary(summarizeAsset(gltf))).not.toThrow()
    const originalSkinnedMeshes = skinnedMeshes(gltf.scene)
    const cloned = cloneSkeleton(gltf.scene)
    const clonedSkinnedMeshes = skinnedMeshes(cloned)

    expect(gltf.animations.map((clip) => clip.name)).toEqual(['Ashveil_RigStress'])
    expect(gltf.animations[0]!.duration).toBeGreaterThan(0)
    expect([...originalSkinnedMeshes.keys()].sort()).toEqual([...REQUIRED_SEMANTIC_MESHES].sort())
    expect([...clonedSkinnedMeshes.keys()].sort()).toEqual([...REQUIRED_SEMANTIC_MESHES].sort())
    const bones = originalSkinnedMeshes.values().next().value!.skeleton.bones
    const manifest = JSON.parse(readFileSync(resolve('scripts/art/contracts/humanoid.v1.json'), 'utf8'))
    const threeNameBySource = new Map<string, string>(
      manifest.bones.map((bone: { name: string; threeName: string }) => [bone.name, bone.threeName]),
    )
    expect(bones.map((bone) => bone.name).sort()).toEqual(
      manifest.bones.map((bone: { threeName: string }) => bone.threeName).sort(),
    )
    expect(
      Object.fromEntries(
        bones.map((bone) => [bone.name, bone.parent instanceof THREE.Bone ? bone.parent.name : null]),
      ),
    ).toEqual(
      Object.fromEntries(
        manifest.bones.map((bone: { threeName: string; parent: string | null }) => [
          bone.threeName,
          bone.parent ? threeNameBySource.get(bone.parent) : null,
        ]),
      ),
    )
    for (const socket of manifest.sockets as Array<{
      role: string
      sourceName: string
      gltfName: string
      threeName: string
    }>) {
      expect(threeNameBySource.get(socket.sourceName), socket.role).toBe(socket.threeName)
      expect(
        manifest.bones.find((bone: { name: string }) => bone.name === socket.sourceName)?.gltfName,
        socket.role,
      ).toBe(socket.gltfName)
      expect(bones.filter((bone) => bone.name === socket.threeName), socket.role).toHaveLength(1)
    }
    const bonesByName = new Map(bones.map((bone) => [bone.name, bone]))
    mixerAtFrame(gltf.scene, gltf.animations[0]!, 0)
    const pelvisHead = worldPosition(bonesByName.get('pelvis')!)
    const hipMidpoint = worldPosition(bonesByName.get('thighL')!)
      .add(worldPosition(bonesByName.get('thighR')!))
      .multiplyScalar(0.5)
    expect.soft(pelvisHead.distanceTo(hipMidpoint), 'pelvis-to-hip midpoint').toBeLessThanOrEqual(0.02)

    const bindOrientations = new Map(
      bones.map((bone) => [bone.name, bone.getWorldQuaternion(new THREE.Quaternion())]),
    )
    const chainLengths = bindChainLengths(bonesByName)
    const orientationEvidence = [
      measureOrientation(gltf.scene, gltf.animations[0]!, 10, 'overhead-reach', bonesByName, bindOrientations, chainLengths, [
        'upper_armL', 'forearmL', 'upper_armR', 'forearmR',
      ]),
      measureOrientation(gltf.scene, gltf.animations[0]!, 20, 'cross-body-reach', bonesByName, bindOrientations, chainLengths, [
        'upper_armL', 'forearmL',
      ]),
      measureOrientation(gltf.scene, gltf.animations[0]!, 30, 'deep-elbow-bend', bonesByName, bindOrientations, chainLengths, [
        'upper_armL', 'forearmL',
      ]),
      measureOrientation(gltf.scene, gltf.animations[0]!, 40, 'long-stride', bonesByName, bindOrientations, chainLengths, [
        'thighL', 'shinL', 'thighR', 'shinR',
      ]),
    ]
    for (const evidence of orientationEvidence) {
      expect.soft(() => assertPoseOrientationEvidence(evidence), evidence.pose).not.toThrow()
      for (const [chain, gap] of Object.entries(evidence.chainGapsMetres)) {
        expect.soft(gap, `${evidence.pose} ${chain}`).toBeLessThanOrEqual(0.001)
      }
    }

    const bindUpperArmWorld = bindOrientations.get('upper_armL')!
    const primaryAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(bindUpperArmWorld)
    const physicallyTwisted = new THREE.Quaternion()
      .setFromAxisAngle(primaryAxis, Math.PI)
      .multiply(bindUpperArmWorld)
    const mutationHead = worldPosition(bonesByName.get('upper_armL')!)
    const mutationTailBefore = primaryAxis.clone().multiplyScalar(chainLengths.get('upper_armL->forearmL')!).add(mutationHead)
    const mutationTailAfter = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(physicallyTwisted)
      .multiplyScalar(chainLengths.get('upper_armL->forearmL')!)
      .add(mutationHead)
    expect(
      new THREE.Vector3(0, 1, 0)
        .applyQuaternion(physicallyTwisted)
        .distanceTo(primaryAxis),
    ).toBeLessThan(1e-6)
    expect(mutationTailAfter.distanceTo(mutationTailBefore)).toBeLessThan(1e-6)
    expect(() =>
      assertPoseOrientationEvidence({
        pose: 'physical-axis-mutation',
        axialTwists: {
          'upper_arm.L': signedAxialTwistDegrees(bindUpperArmWorld, physicallyTwisted),
        },
        chainGapsMetres: { unchangedEndpoints: 0 },
      }),
    ).toThrow(/uncommanded axial twist/)
    for (const name of REQUIRED_SEMANTIC_MESHES) {
      expect(clonedSkinnedMeshes.get(name)!.skeleton).not.toBe(
        originalSkinnedMeshes.get(name)!.skeleton,
      )
      expect(clonedSkinnedMeshes.get(name)!.skeleton.bones).toHaveLength(20)
    }

    const clip = gltf.animations[0]!
    const mixer = new THREE.AnimationMixer(gltf.scene)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    const upperArm = bones.find((bone) => bone.name === 'upper_armL')!
    const head = bones.find((bone) => bone.name === 'head')!
    mixer.setTime(0)
    const bindUpperArm = upperArm.quaternion.clone()
    const bindHead = head.getWorldQuaternion(new THREE.Quaternion())
    mixer.setTime(sampleTimeForFrame(10, 30, clip.duration))
    expect(upperArm.quaternion.angleTo(bindUpperArm)).toBeGreaterThan(1)
    mixer.setTime(sampleTimeForFrame(50, 30, clip.duration))
    expect(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(bindHead)).toBeGreaterThan(0.7)
  })
})

function parseGlb(bytes: Buffer): Promise<GLTF> {
  const arrayBuffer = Uint8Array.from(bytes).buffer
  return new Promise((resolveGltf, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolveGltf, reject)
  })
}

function skinnedMeshes(root: THREE.Object3D): Map<string, THREE.SkinnedMesh> {
  const meshes = new Map<string, THREE.SkinnedMesh>()
  root.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) meshes.set(child.name, child)
  })
  return meshes
}

function mixerAtFrame(root: THREE.Object3D, clip: THREE.AnimationClip, frame: number): void {
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  mixer.setTime(sampleTimeForFrame(frame, 30, clip.duration))
  root.updateMatrixWorld(true)
}

function worldPosition(bone: THREE.Bone): THREE.Vector3 {
  return bone.getWorldPosition(new THREE.Vector3())
}

function signedAxialTwistDegrees(bind: THREE.Quaternion, pose: THREE.Quaternion): number {
  const bindRotation = bind.clone().normalize()
  const poseRotation = pose.clone().normalize()
  if (bindRotation.dot(poseRotation) < 0) poseRotation.set(-poseRotation.x, -poseRotation.y, -poseRotation.z, -poseRotation.w)
  const primary = new THREE.Vector3(0, 1, 0)
  const swing = new THREE.Quaternion().setFromUnitVectors(
    primary.clone().applyQuaternion(bindRotation),
    primary.clone().applyQuaternion(poseRotation),
  )
  const residual = swing.clone().multiply(bindRotation).invert().multiply(poseRotation).normalize()
  const magnitude = Math.hypot(residual.w, residual.y)
  const angle = THREE.MathUtils.radToDeg(2 * Math.atan2(residual.y / magnitude, residual.w / magnitude))
  return ((((angle + 180) % 360) + 360) % 360) - 180
}

function bindChainLengths(bones: Map<string, THREE.Bone>): Map<string, number> {
  return new Map(
    ([
      ['clavicleL', 'upper_armL'], ['upper_armL', 'forearmL'], ['forearmL', 'handL'],
      ['clavicleR', 'upper_armR'], ['upper_armR', 'forearmR'], ['forearmR', 'handR'],
      ['thighL', 'shinL'], ['shinL', 'footL'], ['thighR', 'shinR'], ['shinR', 'footR'],
    ] as const).map(([parent, child]) => [
      `${parent}->${child}`,
      worldPosition(bones.get(parent)!).distanceTo(worldPosition(bones.get(child)!)),
    ]),
  )
}

function measureOrientation(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  frame: number,
  pose: string,
  bones: Map<string, THREE.Bone>,
  bindOrientations: Map<string, THREE.Quaternion>,
  chainLengths: Map<string, number>,
  measuredBones: string[],
): PoseOrientationEvidence {
  mixerAtFrame(root, clip, frame)
  const axialTwists = Object.fromEntries(
    measuredBones.map((name) => [
      name.replace(/([LR])$/, '.$1'),
      signedAxialTwistDegrees(
        bindOrientations.get(name)!,
        bones.get(name)!.getWorldQuaternion(new THREE.Quaternion()),
      ),
    ]),
  )
  const chainGapsMetres = Object.fromEntries(
    [...chainLengths].map(([chain, length]) => {
      const [parent, child] = chain.split('->')
      const parentBone = bones.get(parent!)!
      const expectedTail = new THREE.Vector3(0, length, 0)
        .applyQuaternion(parentBone.getWorldQuaternion(new THREE.Quaternion()))
        .add(worldPosition(parentBone))
      return [chain.replace(/([LR])(?=->|$)/g, '.$1'), expectedTail.distanceTo(worldPosition(bones.get(child!)!))]
    }),
  )
  return { pose, axialTwists, chainGapsMetres }
}
