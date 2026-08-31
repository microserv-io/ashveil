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
    expect(characterRigSpikeArtifactNames).toHaveLength(21)
    expect(characterRigSpikeArtifactNames).toContain('masculine-rig-spike.blend')
    expect(characterRigSpikeArtifactNames).toContain('masculine-rigged-diagnostic.glb')
    expect(characterRigSpikeArtifactNames).toContain('validation-head-turn-right.png')
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
    expect(report.skeleton).toMatchObject({ bones: 20, deformBones: 19 })
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
      { name: 'horizontal-attack', frame: 20 },
      { name: 'deep-elbow-bend', frame: 30 },
      { name: 'long-stride', frame: 40 },
      { name: 'head-turn', frame: 50 },
    ])
    expect(report.seams.pass).toBe(true)
    expect(report.groundAndBounds.pass).toBe(true)
    expect(report.export.gltfStructure).toMatchObject({
      meshes: 7,
      primitives: 7,
      skins: 1,
      animations: 1,
    })
    expect(report.renders).toHaveLength(18)
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
    const bones = originalSkinnedMeshes.values().next().value!.skeleton.bones
    const upperArm = bones.find((bone) => bone.name === 'upper_armL')!
    const head = bones.find((bone) => bone.name === 'head')!
    mixer.setTime(0)
    const bindUpperArm = upperArm.quaternion.clone()
    const bindHead = head.quaternion.clone()
    mixer.setTime(sampleTimeForFrame(10, 30, clip.duration))
    expect(upperArm.quaternion.angleTo(bindUpperArm)).toBeGreaterThan(1)
    mixer.setTime(sampleTimeForFrame(50, 30, clip.duration))
    expect(head.quaternion.angleTo(bindHead)).toBeGreaterThan(0.7)
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
