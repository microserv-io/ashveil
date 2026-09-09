import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ApprovedWorldCharacter } from '../src/world/approved-character'
import { APPROVED_CLIPS, ApprovedCharacterSource, validateApprovedCharacterTemplate, validateApprovedManifest, type ApprovedCharacterTemplate } from '../src/world/approved-character-source'
import { createExplorer, RUN_SPEED } from '../src/world/movement'
import {
  cameraMinimumDistance,
  cameraTargetHeight,
  gearMotionReviewEnabled,
  gearReviewCameraYaw,
} from '../src/world/gear-motion-review-gate'
import { adaptStarterGearTemplate, GearSetSource, type GearSetTemplate } from '../src/world/gear-source'
import { STARTER_GEAR_SLOTS, type StarterGearSlot, type StarterGearTemplate } from '../src/world/starter-gear-source'

const ROOT = join(import.meta.dirname, '..')
const DIRECTORY = join(ROOT, 'public', 'bodies', 'masculine-clean-v1')
const MODEL = readFileSync(join(DIRECTORY, 'masculine-clean-v1.glb'))
const MANIFEST = validateApprovedManifest(JSON.parse(readFileSync(join(DIRECTORY, 'masculine-clean-v1.manifest.json'), 'utf8')))

interface GlbJson {
  readonly scenes: readonly { readonly nodes: readonly number[] }[]
  readonly scene: number
  readonly nodes: readonly { readonly name?: string; readonly mesh?: number; readonly skin?: number }[]
  readonly meshes: readonly { readonly primitives: readonly { readonly material?: number; readonly attributes: Record<string, number> }[] }[]
  readonly materials: readonly { readonly alphaMode?: string; readonly pbrMetallicRoughness?: unknown }[]
  readonly skins: readonly { readonly joints: readonly number[] }[]
  readonly animations: readonly { readonly name: string; readonly channels: readonly unknown[] }[]
}

function glbJson(file: Buffer): GlbJson {
  let offset = 12
  while (offset < file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const data = file.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) return JSON.parse(data.toString('utf8').trim()) as GlbJson
    offset += 8 + length
  }
  throw new Error('Approved character GLB has no JSON chunk.')
}

function template(): ApprovedCharacterTemplate {
  const scene = new THREE.Group()
  const pose = new THREE.Group()
  pose.name = 'Pose'
  scene.add(pose)
  const animations = MANIFEST.clips.map((record) => new THREE.AnimationClip(record.name, record.duration,
    record.duration === 0 ? [] : [new THREE.VectorKeyframeTrack(
      'Pose.position', [0, record.duration], [0, 0, 0, 0, record.duration, 0],
    )]))
  return { scene, animations, manifest: MANIFEST }
}

function assetLoader(): GLTFLoader {
  return new GLTFLoader().register((parser: GLTFParser) => ({
    name: 'ASHVEIL_test_embedded_character_image',
    loadTexture: (textureIndex: number) => {
      const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
      texture.needsUpdate = true
      parser.associations.set(texture, { textures: textureIndex })
      return Promise.resolve(texture)
    },
  }))
}

async function actualTemplate(): Promise<ApprovedCharacterTemplate> {
  const loader = assetLoader()
  const data = MODEL.buffer.slice(MODEL.byteOffset, MODEL.byteOffset + MODEL.byteLength)
  return validateApprovedCharacterTemplate(await loader.parseAsync(data, ''), MANIFEST)
}

async function actualMageTemplate(): Promise<GearSetTemplate> {
  const directory = join(ROOT, 'public', 'gear', 'arcane-mage-tier')
  const manifest = JSON.parse(readFileSync(join(directory, 'arcane-mage-tier.manifest.json'), 'utf8'))
  const file = readFileSync(join(directory, 'arcane-mage-tier.glb'))
  const source = new GearSetSource(assetLoader(), async (url) => url.endsWith('.json')
    ? { ok: true, json: async () => manifest, arrayBuffer: async () => new ArrayBuffer(0) }
    : {
        ok: true,
        json: async () => ({}),
        arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      })
  return source.load('arcane-mage-tier')
}

function fittedGearTemplate(character: ApprovedCharacterTemplate): StarterGearTemplate {
  let body: THREE.SkinnedMesh | undefined
  character.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) body = object })
  if (!body) throw new Error('Test character has no skinned mesh.')
  const meshNames: Record<StarterGearSlot, string> = {
    chest: 'StarterLeatherChest', legs: 'StarterLeatherLegs', boots: 'StarterLeatherBoots',
    waist: 'StarterLeatherWaist',
  }
  const meshes = new Map<StarterGearSlot, readonly THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]>()
  for (const slot of STARTER_GEAR_SLOTS) {
    const bones = body.skeleton.bones.map((source) => Object.assign(new THREE.Bone(), { name: source.name }))
    const skeleton = new THREE.Skeleton(bones, body.skeleton.boneInverses.map((inverse) => inverse.clone()))
    const material = new THREE.MeshStandardMaterial()
    material.name = slot === 'chest' ? 'Starter Leather' : 'Starter Dark Leather'
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), material)
    mesh.name = meshNames[slot]
    mesh.bind(skeleton, body.bindMatrix)
    meshes.set(slot, [mesh])
  }
  return {
    scene: new THREE.Group(),
    meshes,
    dyeChannels: new Map(STARTER_GEAR_SLOTS.map((slot) => [slot, new Set(['primary'] as const)])),
    manifest: {
      schema: 'ashveil.starter-gear.v1', body: 'masculine-clean-v1', bodySha256: MANIFEST.glb.sha256,
      glb: { file: 'starter-leather.glb', bytes: 1, sha256: 'a'.repeat(64) },
      jointNames: body.skeleton.bones.map((bone) => bone.name), inverseBindSha256: 'b'.repeat(64),
      slots: STARTER_GEAR_SLOTS.map((slot) => ({ slot, mesh: meshNames[slot], triangles: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } })),
      budget: { triangles: 4, materials: 4 },
    },
  }
}

describe('approved first-zone character asset', () => {
  it('pins the exact reviewed Blender export and seven authored clips', () => {
    expect(MODEL.byteLength).toBe(MANIFEST.glb.bytes)
    expect(createHash('sha256').update(MODEL).digest('hex')).toBe(MANIFEST.glb.sha256)
    expect(MANIFEST.clips.map((clip) => clip.name).sort()).toEqual([...APPROVED_CLIPS].sort())
    expect(MANIFEST.clips.find((clip) => clip.name === 'idle')?.duration).toBe(0)
    expect(MANIFEST.clips.find((clip) => clip.name === 'walk_forward')?.nominalSpeed).toBe(2)
    expect(MANIFEST.clips.find((clip) => clip.name === 'run_forward')?.nominalSpeed).toBe(5)
    expect(MANIFEST.clips.find((clip) => clip.name === 'sprint_forward')?.nominalSpeed).toBe(7)
  })

  it('rejects invalid clip metadata', () => {
    const invalidDuration = { ...MANIFEST, clips: MANIFEST.clips.map((clip) => (
      clip.name === 'run_forward' ? { ...clip, duration: 0 } : clip
    )) }
    expect(() => validateApprovedManifest(invalidDuration)).toThrow(/clip metadata/)
    const invalidLoop = { ...MANIFEST, clips: MANIFEST.clips.map((clip) => (
      clip.name === 'idle' ? { ...clip, loop: true } : clip
    )) }
    expect(() => validateApprovedManifest(invalidLoop)).toThrow(/clip metadata/)
  })

  it('requires both development mode and the exact review query value', () => {
    expect(gearMotionReviewEnabled(true, '?gearReview=1')).toBe(true)
    expect(gearMotionReviewEnabled(false, '?gearReview=1')).toBe(false)
    expect(gearMotionReviewEnabled(true, '')).toBe(false)
    expect(gearMotionReviewEnabled(true, '?gearReview=0')).toBe(false)
    expect(gearMotionReviewEnabled(true, '?gearReview')).toBe(false)
    expect(cameraMinimumDistance(false)).toBe(4.8)
    expect(cameraMinimumDistance(true)).toBe(2.3)
    expect(cameraTargetHeight(false)).toBe(1.35)
    expect(cameraTargetHeight(true)).toBe(0.95)
    expect(gearReviewCameraYaw('front', 0.7)).toBe(0.7)
    expect(gearReviewCameraYaw('back', 0.7)).toBeCloseTo(0.7 + Math.PI)
    expect(gearReviewCameraYaw('left', 0.7)).toBeCloseTo(0.7 - Math.PI / 2)
    expect(gearReviewCameraYaw('right', 0.7)).toBeCloseTo(0.7 + Math.PI / 2)
  })

  it('plays, pauses, scrubs, and loops an approved review clip without changing normal mode', () => {
    const start = createExplorer({ x: -70, z: -70 })
    const normal = new ApprovedWorldCharacter(template(), start)
    normal.setMotionReviewClip('jump_air')
    normal.setMotionReviewPlaying(false)
    normal.setMotionReviewProgress(0.75)
    expect(normal.motionReviewState).toBeUndefined()
    normal.update({ ...start, z: start.z + RUN_SPEED * 0.1 }, 0.1)
    expect(normal.animationState.dominantClip).toBe('run_forward')
    normal.dispose()

    const character = new ApprovedWorldCharacter(template(), start)
    character.enableMotionReview()
    character.setMotionReviewClip('jump_land')
    character.setMotionReviewPlaying(false)
    character.setMotionReviewProgress(0.5)
    const duration = MANIFEST.clips.find((clip) => clip.name === 'jump_land')!.duration
    const pose = character.root.getObjectByName('Pose')!
    expect(character.motionReviewState).toMatchObject({
      clip: 'jump_land', playing: false, time: duration / 2, normalizedTime: 0.5,
    })
    expect(pose.position.y).toBeCloseTo(duration / 2)

    character.update(start, 0.1)
    expect(character.motionReviewState?.time).toBe(duration / 2)
    character.setMotionReviewProgress(1)
    expect(pose.position.y).toBeCloseTo(duration)
    character.setMotionReviewPlaying(true)
    character.update(start, 0.1)
    expect(character.motionReviewState?.time).toBeCloseTo(0.1)
    expect(character.animationState.dominantClip).toBe('jump_land')

    character.setMotionReviewClip('walk_forward')
    expect(character.motionReviewState).toMatchObject({ clip: 'walk_forward', playing: true, time: 0 })
    character.update(start, 0.1)
    expect(character.animationState.dominantClip).toBe('walk_forward')
    character.disableMotionReview(start)
    expect(character.motionReviewState).toBeUndefined()
    character.update({ ...start, z: start.z + RUN_SPEED * 0.1 }, 0.1)
    expect(character.animationState.dominantClip).toBe('run_forward')
    character.dispose()
  })

  it('drives skinned and rigid Mage attachments through the reviewed body mixer', async () => {
    const [characterTemplate, mage] = await Promise.all([actualTemplate(), actualMageTemplate()])
    const start = createExplorer({ x: -70, z: -70 })
    const character = new ApprovedWorldCharacter(characterTemplate, start, [mage])
    character.equipGearSet('arcane-mage-tier')

    let body: THREE.SkinnedMesh | undefined
    let chest: THREE.SkinnedMesh | undefined
    let robe: THREE.SkinnedMesh | undefined
    let rigidHead: THREE.Object3D | undefined
    character.root.traverse((object) => {
      if (object.name.includes('gear:arcane-mage-tier:head:')) rigidHead = object
      if (!(object instanceof THREE.SkinnedMesh)) return
      if (object.name.includes('gear:arcane-mage-tier:chest:')) {
        chest = object
        if (object.name.includes(':ArcaneMageRobeSkirt:')) robe = object
      }
      else if (!object.name.startsWith('gear:')) body = object
    })
    expect(chest?.skeleton).toBe(body?.skeleton)
    expect(robe?.skeleton).toBe(body?.skeleton)
    expect(robe?.customDepthMaterial?.customProgramCacheKey()).toContain('ashveil-gear-capsules-v4')
    expect(robe?.customDistanceMaterial?.customProgramCacheKey()).toContain('ashveil-gear-capsules-v4')
    expect(rigidHead).toBeDefined()

    character.enableMotionReview()
    character.setMotionReviewClip('walk_forward')
    character.setMotionReviewPlaying(false)
    character.setMotionReviewProgress(0)
    character.root.updateMatrixWorld(true)
    body!.skeleton.update()
    const bonesAtStart = [...(body!.skeleton.boneMatrices ?? [])]
    const rigidAtStart = rigidHead!.matrixWorld.clone()

    character.setMotionReviewProgress(0.5)
    character.root.updateMatrixWorld(true)
    body!.skeleton.update()
    expect([...(body!.skeleton.boneMatrices ?? [])]).not.toEqual(bonesAtStart)
    expect(rigidHead!.matrixWorld.equals(rigidAtStart)).toBe(false)
    character.dispose()
  }, 30_000)

  it('evicts a failed source load and shares the successful retry', async () => {
    let fails = true
    const parsed = await actualTemplate()
    const fetcher = vi.fn(async (url: string) => {
      if (fails) throw new Error('offline')
      return url.endsWith('.json')
        ? { ok: true, json: async () => MANIFEST, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(MANIFEST.glb.bytes) }
    })
    const loader = { parseAsync: vi.fn(async () => ({ scene: parsed.scene, animations: [...parsed.animations] })) }
    const source = new ApprovedCharacterSource(loader, fetcher)
    await expect(source.load()).rejects.toThrow(/Alderbank explorer/)
    fails = false
    const first = source.load()
    expect(source.load()).toBe(first)
    await expect(first).resolves.toMatchObject({ manifest: MANIFEST })
    expect(loader.parseAsync).toHaveBeenCalledTimes(1)
  })

  it('contains one opaque skinned PBR mesh and no unapproved animation aliases', () => {
    const json = glbJson(MODEL)
    const meshNodes = json.nodes.filter((node) => node.mesh !== undefined)
    expect(json.scenes[json.scene]?.nodes).toHaveLength(1)
    expect(meshNodes).toHaveLength(1)
    expect(meshNodes[0]?.skin).toBe(0)
    expect(json.meshes).toHaveLength(1)
    expect(json.meshes[0]?.primitives).toHaveLength(1)
    expect(Object.keys(json.meshes[0]!.primitives[0]!.attributes)).toEqual(expect.arrayContaining([
      'POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0',
    ]))
    expect(json.materials).toHaveLength(1)
    expect(json.materials[0]?.alphaMode ?? 'OPAQUE').toBe('OPAQUE')
    expect(json.materials[0]?.pbrMetallicRoughness).toBeDefined()
    expect(json.skins).toHaveLength(1)
    expect(json.skins[0]?.joints).toHaveLength(68)
    expect(json.animations.map((clip) => clip.name).sort()).toEqual([...APPROVED_CLIPS].sort())
    expect(json.animations.every((clip) => clip.channels.length > 0)).toBe(true)
  })

  it('holds a moving landing briefly, then blends to the realized gait', () => {
    const start = createExplorer({ x: -70, z: -70 })
    const character = new ApprovedWorldCharacter(template(), start)
    const airborne = { ...start, grounded: false, jumpPhase: 'descending' as const, verticalVelocity: -1 }
    character.update(airborne, 0.1)
    let distance = 0
    const landed = { ...start, jumpPhase: 'landing' as const }
    for (const [index, seconds] of [0.06, 0.06, 0.02].entries()) {
      distance += RUN_SPEED * seconds
      character.update({ ...(index === 0 ? landed : start), z: start.z + distance }, seconds)
    }
    expect(character.animationState).toMatchObject({ state: 'moving', dominantClip: 'run_forward' })
    character.dispose()
  })

  it('plays a stationary landing through recovery and freezes when delta is zero', () => {
    const start = createExplorer({ x: -70, z: -70 })
    const character = new ApprovedWorldCharacter(template(), start)
    const preparing = { ...start, jumpPhase: 'preparing' as const, jumpPreparationRemaining: 0.18 }
    character.update(preparing, 0.1)
    const frozen = character.animationState
    character.update(preparing, 0)
    expect(character.animationState).toEqual(frozen)

    character.update({ ...start, grounded: false, jumpPhase: 'descending', verticalVelocity: -1 }, 0.1)
    const landed = { ...start, jumpPhase: 'landing' as const }
    character.update(landed, 0.1)
    for (let frame = 0; frame < 3; frame += 1) character.update(start, 0.1)
    expect(character.animationState).toMatchObject({ state: 'landing', dominantClip: 'jump_land' })
    character.update(start, 0.1)
    expect(character.animationState).toMatchObject({ state: 'idle', dominantClip: 'idle' })
    character.dispose()
  })

  it('carries frame time across the jump-start boundary', () => {
    const start = createExplorer({ x: -70, z: -70 })
    const character = new ApprovedWorldCharacter(template(), start)
    const preparing = { ...start, jumpPhase: 'preparing' as const, jumpPreparationRemaining: 0.18 }
    character.update(preparing, 0.1)
    character.update({ ...preparing, jumpPreparationRemaining: 0.08 }, 0.1)
    character.update({ ...start, grounded: false, jumpPhase: 'ascending', verticalVelocity: 4 }, 0.1)
    expect(character.animationState.dominantClip).toBe('jump_air')
    expect((character as unknown as { modeTime: number }).modeTime).toBeCloseTo(0.3 - 7 / 24)
    character.dispose()
  })

  it('runs repeated jump cycles on the actual skeleton without moving the physics root', async () => {
    const characterTemplate = await actualTemplate()
    expect(() => validateApprovedCharacterTemplate({
      scene: characterTemplate.scene,
      animations: [...characterTemplate.animations, characterTemplate.animations[0]!],
    }, MANIFEST)).toThrow(/seven approved clips/)
    const start = createExplorer({ x: -70, z: -70 })
    const character = new ApprovedWorldCharacter(characterTemplate, start)
    character.update(start, 0.1)

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const preparing = { ...start, jumpPhase: 'preparing' as const, jumpPreparationRemaining: 0.18 }
      character.update(preparing, 0.1)
      expect(character.animationState.dominantClip).toBe('jump_start')
      character.update({ ...preparing, jumpPreparationRemaining: 0.08 }, 0.08)
      character.update({ ...start, grounded: false, jumpPhase: 'ascending', verticalVelocity: 4 }, 0.1)
      character.update({ ...start, grounded: false, jumpPhase: 'descending', verticalVelocity: -1 }, 0.1)
      expect(character.animationState.dominantClip).toBe('jump_air')
      character.update({ ...start, jumpPhase: 'landing' }, 0.1)
      for (let frame = 0; frame < 4; frame += 1) character.update(start, 0.1)
      expect(character.animationState.dominantClip).toBe('idle')
    }
    expect(character.root.position.toArray()).toEqual([start.x, start.y, start.z])
    expect(character.root.rotation.y).toBe(start.facing)
    character.root.traverse((object) => {
      expect([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()].every(Number.isFinite)).toBe(true)
    })
    character.dispose()
  }, 30_000)

  it('keeps visual gear choices through reset and drives the shared gear skeleton while moving', async () => {
    const characterTemplate = await actualTemplate()
    const start = createExplorer({ x: -70, z: -70 })
    const character = new ApprovedWorldCharacter(characterTemplate, start, [adaptStarterGearTemplate(fittedGearTemplate(characterTemplate))])
    expect(character.gearAppearance.selected).toMatchObject({
      chest: 'starter-leather', legs: 'starter-leather', boots: 'starter-leather', waist: 'starter-leather',
    })
    character.setGearEquipped('legs', false)
    character.setGearDye('chest', 'primary', '#b06a3c')
    character.reset(start)
    expect(character.gearAppearance.selected.legs).toBeNull()
    expect(character.gearAppearance.dyes['starter-leather']?.chest).toEqual({ primaryTint: '#b06a3c', trimTint: null })

    let chest: THREE.SkinnedMesh | undefined
    let body: THREE.SkinnedMesh | undefined
    character.root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      if (object.name.includes('gear:starter-leather:chest:')) chest = object
      else if (!object.name.startsWith('gear:')) body = object
    })
    expect(chest?.skeleton).toBe(body?.skeleton)
    chest!.skeleton.update()
    const before = [...(chest!.skeleton.boneMatrices ?? [])]
    for (let frame = 1; frame <= 4; frame += 1) {
      character.update({ ...start, z: start.z + RUN_SPEED * frame * 0.1 }, 0.1)
    }
    character.root.updateMatrixWorld(true)
    chest!.skeleton.update()
    expect([...(chest!.skeleton.boneMatrices ?? [])]).not.toEqual(before)
    character.dispose()
  })

  it('keeps starter playable when optional mage construction fails', async () => {
    const characterTemplate = await actualTemplate()
    const starter = adaptStarterGearTemplate(fittedGearTemplate(characterTemplate))
    const brokenMage: GearSetTemplate = {
      ...starter,
      manifest: { ...starter.manifest, id: 'arcane-mage-tier', bodySha256: 'c'.repeat(64) },
    }
    const character = new ApprovedWorldCharacter(
      characterTemplate,
      createExplorer({ x: -70, z: -70 }),
      [starter, brokenMage],
    )
    expect(character.gearSetIds).toEqual(['starter-leather'])
    expect(character.gearErrors).toEqual([expect.stringMatching(/different approved body/)])
    expect(character.gearAppearance.selected.chest).toBe('starter-leather')
    character.dispose()
  })

  it('keeps starter gear playable when optional mage construction fails', async () => {
    const characterTemplate = await actualTemplate()
    const starter = adaptStarterGearTemplate(fittedGearTemplate(characterTemplate))
    const brokenMage: GearSetTemplate = {
      ...starter,
      manifest: {
        ...starter.manifest,
        id: 'arcane-mage-tier',
        glb: { ...starter.manifest.glb, file: 'arcane-mage-tier.glb' },
        bodySha256: 'c'.repeat(64),
      },
    }
    const character = new ApprovedWorldCharacter(
      characterTemplate,
      createExplorer({ x: -70, z: -70 }),
      [starter, brokenMage],
    )
    expect(character.gearSetIds).toEqual(['starter-leather'])
    expect(character.gearErrors).toEqual([expect.stringMatching(/different approved body/)])
    expect(character.gearAppearance.selected).toMatchObject({
      chest: 'starter-leather', waist: 'starter-leather', legs: 'starter-leather', boots: 'starter-leather',
    })
    character.dispose()
  })
})
