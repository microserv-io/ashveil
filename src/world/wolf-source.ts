import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ATTACK_SECONDS } from './wandering-wolf'

export const WOLF_DIRECTORY = '/creatures/wolf/'
export const WOLF_CLIPS = ['attack', 'run', 'walk'] as const
export type WolfClipName = (typeof WOLF_CLIPS)[number]

export interface WolfManifest {
  readonly schema: 'ashveil.wolf.v1'
  readonly creature: 'wolf'
  readonly glb: { readonly file: 'wolf.glb'; readonly sha256: string; readonly bytes: number }
  readonly clips: readonly { readonly name: WolfClipName; readonly duration: number; readonly loop: boolean }[]
  readonly frame: {
    readonly forward: '+Z'
    readonly up: '+Y'
    readonly rootNodeQuaternion: readonly [number, number, number, number]
    readonly restCenterZ: number
    readonly groundOffsetY: number
  }
}

export interface WolfTemplate {
  readonly scene: THREE.Object3D
  readonly animations: readonly THREE.AnimationClip[]
  readonly manifest: WolfManifest
  readonly restBounds: THREE.Box3
  readonly restCenterZ: number
}

interface LoaderLike {
  parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>
}

interface FetchResponseLike {
  readonly ok: boolean
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

type FetchLike = (url: string) => Promise<FetchResponseLike>

export class WolfSource {
  private pending: Promise<WolfTemplate> | undefined

  constructor(
    private readonly loader: LoaderLike = new GLTFLoader(),
    private readonly fetcher: FetchLike = (url) => fetch(url),
  ) {}

  load(): Promise<WolfTemplate> {
    if (this.pending) return this.pending
    this.pending = this.loadWolf().catch((cause: unknown) => {
      this.pending = undefined
      throw new Error('Could not load the Alderbank wolf.', { cause })
    })
    return this.pending
  }

  private async loadWolf(): Promise<WolfTemplate> {
    const manifestResponse = await this.fetcher(`${WOLF_DIRECTORY}wolf.manifest.json`)
    if (!manifestResponse.ok) throw new Error('Wolf manifest request failed.')
    const manifest = validateWolfManifest(await manifestResponse.json())
    const modelResponse = await this.fetcher(`${WOLF_DIRECTORY}${manifest.glb.file}`)
    if (!modelResponse.ok) throw new Error('Wolf model request failed.')
    const data = await modelResponse.arrayBuffer()
    if (data.byteLength !== manifest.glb.bytes) throw new Error('Wolf model byte count does not match its manifest.')
    return validateWolfTemplate(await this.loader.parseAsync(data, WOLF_DIRECTORY), manifest)
  }
}

const sharedSource = new WolfSource()
export function loadWolf(): Promise<WolfTemplate> { return sharedSource.load() }

export function validateWolfManifest(value: unknown): WolfManifest {
  if (!isRecord(value)) throw new Error('Wolf manifest is not an object.')
  const manifest = value as unknown as WolfManifest
  if (manifest.schema !== 'ashveil.wolf.v1' || manifest.creature !== 'wolf'
    || manifest.glb?.file !== 'wolf.glb' || !Number.isInteger(manifest.glb.bytes) || manifest.glb.bytes <= 0
    || !/^[0-9a-f]{64}$/.test(manifest.glb.sha256)
    || manifest.frame?.forward !== '+Z' || manifest.frame.up !== '+Y'
    || !Array.isArray(manifest.frame.rootNodeQuaternion) || manifest.frame.rootNodeQuaternion.length !== 4
    || !manifest.frame.rootNodeQuaternion.every(Number.isFinite)
    || !Number.isFinite(manifest.frame.restCenterZ) || !Number.isFinite(manifest.frame.groundOffsetY)) {
    throw new Error('Wolf manifest identity or frame is invalid.')
  }
  if (!Array.isArray(manifest.clips) || manifest.clips.length !== WOLF_CLIPS.length) {
    throw new Error('Wolf clip manifest is incomplete.')
  }
  const clips = new Map(manifest.clips.map((clip) => [clip.name, clip]))
  if (clips.size !== WOLF_CLIPS.length || WOLF_CLIPS.some((name) => !clips.has(name))) {
    throw new Error('Wolf clip names are invalid.')
  }
  for (const name of WOLF_CLIPS) {
    const clip = clips.get(name)!
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.loop !== (name !== 'attack')) {
      throw new Error(`Wolf clip metadata is invalid: ${name}.`)
    }
  }
  if (clips.get('attack')!.duration !== ATTACK_SECONDS) {
    throw new Error('Wolf attack clip duration must match its behavior timer.')
  }
  return manifest
}

export function validateWolfTemplate(
  gltf: { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] },
  manifest: WolfManifest,
): WolfTemplate {
  if (!identityTransform(gltf.scene)) throw new Error('Wolf scene root must have an identity transform.')
  const meshes: THREE.SkinnedMesh[] = []
  gltf.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
  if (meshes.length !== 1 || meshes[0]!.skeleton.bones.length !== 23) {
    throw new Error('Wolf must contain one skinned mesh with 23 bones.')
  }
  const mesh = meshes[0]!
  if (!(mesh.material instanceof THREE.MeshStandardMaterial) || !mesh.material.map
    || mesh.material.transparent || mesh.material.opacity !== 1) {
    throw new Error('Wolf must use one opaque textured PBR material.')
  }
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    if (!mesh.geometry.getAttribute(name)) throw new Error(`Wolf mesh is missing ${name}.`)
  }
  const rootNode = gltf.scene.getObjectByName('RootNode')
  const rigRoot = gltf.scene.getObjectByName('tripoRoot')
  const expectedRootQuaternion = new THREE.Quaternion(...manifest.frame.rootNodeQuaternion)
  if (!rootNode || rootNode.quaternion.angleTo(expectedRootQuaternion) > 1e-5
    || !rigRoot || !gltf.scene.getObjectByName('Armature')) {
    throw new Error('Wolf export frame or rig root is invalid.')
  }
  const records = new Map(manifest.clips.map((clip) => [clip.name, clip]))
  const sourceClips = new Map(gltf.animations.map((clip) => [clip.name, clip]))
  if (sourceClips.size !== WOLF_CLIPS.length || gltf.animations.length !== WOLF_CLIPS.length
    || WOLF_CLIPS.some((name) => !sourceClips.has(name))) {
    throw new Error('Wolf GLB must contain attack, run, and walk clips.')
  }
  const animations = WOLF_CLIPS.map((name) => normalizeClip(sourceClips.get(name)!, records.get(name)!.duration))
  const restBounds = new THREE.Box3().setFromObject(gltf.scene)
  const values = [...restBounds.min.toArray(), ...restBounds.max.toArray()]
  if (!values.every(Number.isFinite) || restBounds.min.y < -1e-4 || restBounds.max.y < 0.65
    || restBounds.max.y > 0.75 || restBounds.max.z - restBounds.min.z < 0.95) {
    throw new Error('Wolf rest bounds are invalid.')
  }
  const restCenterZ = (restBounds.min.z + restBounds.max.z) / 2
  if (Math.abs(restCenterZ - manifest.frame.restCenterZ) > 1e-4) {
    throw new Error('Wolf rest center does not match its manifest.')
  }
  return { scene: gltf.scene, animations, manifest, restBounds, restCenterZ }
}

function normalizeClip(source: THREE.AnimationClip, expectedDuration: number): THREE.AnimationClip {
  const clip = source.clone()
  const firstKey = Math.min(...clip.tracks.map((track) => track.times[0] ?? Infinity))
  if (!Number.isFinite(firstKey)) throw new Error(`Wolf clip has no keys: ${clip.name}.`)
  for (const track of clip.tracks) {
    for (let index = 0; index < track.times.length; index += 1) track.times[index] = track.times[index]! - firstKey
    if (!track.times.every(Number.isFinite) || !track.values.every(Number.isFinite)) {
      throw new Error(`Wolf clip contains invalid animation data: ${clip.name}.`)
    }
  }
  clip.resetDuration()
  if (Math.abs(clip.duration - expectedDuration) > 1e-4) {
    throw new Error(`Wolf clip duration does not match its manifest: ${clip.name}.`)
  }
  return clip
}

function identityTransform(object: THREE.Object3D): boolean {
  return object.position.lengthSq() < 1e-10
    && object.quaternion.angleTo(new THREE.Quaternion()) < 1e-5
    && object.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
