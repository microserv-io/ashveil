import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const APPROVED_CHARACTER_ID = 'masculine-clean-v1'
export const APPROVED_CHARACTER_FOLDER = `/bodies/${APPROVED_CHARACTER_ID}/`
export const APPROVED_CLIPS = [
  'idle', 'walk_forward', 'run_forward', 'sprint_forward',
  'jump_start', 'jump_air', 'jump_land',
] as const

export type ApprovedClipName = (typeof APPROVED_CLIPS)[number]

export interface ApprovedClipManifest {
  readonly name: ApprovedClipName
  readonly duration: number
  readonly loop: boolean
  readonly nominalSpeed: number
}

export interface ApprovedCharacterManifest {
  readonly schema: 'ashveil.approved-character.v1'
  readonly body: typeof APPROVED_CHARACTER_ID
  readonly glb: { readonly file: string; readonly sha256: string; readonly bytes: number }
  readonly clips: readonly ApprovedClipManifest[]
}

export interface ApprovedCharacterTemplate {
  readonly scene: THREE.Object3D
  readonly animations: readonly THREE.AnimationClip[]
  readonly manifest: ApprovedCharacterManifest
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

export class ApprovedCharacterSource {
  private pending: Promise<ApprovedCharacterTemplate> | undefined

  constructor(
    private readonly loader: LoaderLike = new GLTFLoader(),
    private readonly fetcher: FetchLike = (url) => fetch(url),
  ) {}

  load(): Promise<ApprovedCharacterTemplate> {
    if (this.pending) return this.pending
    this.pending = this.loadApproved().catch((cause: unknown) => {
      this.pending = undefined
      throw new Error('Could not load the Alderbank explorer.', { cause })
    })
    return this.pending
  }

  private async loadApproved(): Promise<ApprovedCharacterTemplate> {
    const manifestResponse = await this.fetcher(`${APPROVED_CHARACTER_FOLDER}${APPROVED_CHARACTER_ID}.manifest.json`)
    if (!manifestResponse.ok) throw new Error('Approved character manifest request failed.')
    const manifest = validateApprovedManifest(await manifestResponse.json())
    const glbResponse = await this.fetcher(`${APPROVED_CHARACTER_FOLDER}${manifest.glb.file}`)
    if (!glbResponse.ok) throw new Error('Approved character model request failed.')
    const data = await glbResponse.arrayBuffer()
    if (data.byteLength !== manifest.glb.bytes) throw new Error('Approved character model byte count does not match its manifest.')
    const gltf = await this.loader.parseAsync(data, APPROVED_CHARACTER_FOLDER)
    return validateApprovedCharacterTemplate(gltf, manifest)
  }
}

const sharedSource = new ApprovedCharacterSource()
export function loadApprovedCharacter(): Promise<ApprovedCharacterTemplate> { return sharedSource.load() }

export function validateApprovedManifest(value: unknown): ApprovedCharacterManifest {
  if (!isRecord(value)) throw new Error('Approved character manifest is not an object.')
  const manifest = value as unknown as ApprovedCharacterManifest
  if (manifest.schema !== 'ashveil.approved-character.v1' || manifest.body !== APPROVED_CHARACTER_ID
    || manifest.glb?.file !== `${APPROVED_CHARACTER_ID}.glb`
    || !Number.isInteger(manifest.glb.bytes) || manifest.glb.bytes <= 0
    || !/^[0-9a-f]{64}$/.test(manifest.glb.sha256)) {
    throw new Error('Approved character manifest identity is invalid.')
  }
  if (!Array.isArray(manifest.clips) || manifest.clips.length !== APPROVED_CLIPS.length) {
    throw new Error('Approved character clip manifest is incomplete.')
  }
  const records = new Map(manifest.clips.map((clip) => [clip.name, clip]))
  if (records.size !== APPROVED_CLIPS.length || APPROVED_CLIPS.some((name) => !records.has(name))) {
    throw new Error('Approved character clip names are invalid.')
  }
  for (const clip of manifest.clips) {
    const idle = clip.name === 'idle'
    const locomotion = clip.name === 'walk_forward' || clip.name === 'run_forward' || clip.name === 'sprint_forward'
    const shouldLoop = idle ? false : locomotion || clip.name === 'jump_air'
    if (!Number.isFinite(clip.duration) || (idle ? clip.duration !== 0 : clip.duration <= 0)
      || !Number.isFinite(clip.nominalSpeed) || (locomotion ? clip.nominalSpeed <= 0 : clip.nominalSpeed !== 0)
      || clip.loop !== shouldLoop) {
      throw new Error(`Approved character clip metadata is invalid: ${clip.name}.`)
    }
  }
  return manifest
}

export function validateApprovedCharacterTemplate(
  gltf: { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] },
  manifest: ApprovedCharacterManifest,
): ApprovedCharacterTemplate {
  if (!identityTransform(gltf.scene)) throw new Error('Approved character scene root must have an identity transform.')
  const meshes: THREE.SkinnedMesh[] = []
  gltf.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object) })
  if (meshes.length !== 1) throw new Error('Approved character must contain exactly one skinned mesh.')
  const mesh = meshes[0]!
  if (!(mesh.material instanceof THREE.MeshStandardMaterial) || !mesh.material.map || mesh.material.transparent
    || mesh.material.opacity !== 1 || mesh.material.alphaTest !== 0) {
    throw new Error('Approved character must use one opaque textured PBR material.')
  }
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    if (!mesh.geometry.getAttribute(name)) throw new Error(`Approved character mesh is missing ${name}.`)
  }
  validateSkinWeights(mesh.geometry.getAttribute('skinWeight'))
  const records = new Map(manifest.clips.map((clip) => [clip.name, clip]))
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]))
  if (gltf.animations.length !== APPROVED_CLIPS.length || clips.size !== APPROVED_CLIPS.length
    || APPROVED_CLIPS.some((name) => !clips.has(name))) {
    throw new Error('Approved character GLB does not contain the seven approved clips.')
  }
  for (const [name, clip] of clips) {
    const record = records.get(name as ApprovedClipName)!
    if (Math.abs(clip.duration - record.duration) > 1e-4
      || clip.tracks.some((track) => !track.times.every(Number.isFinite) || !track.values.every(Number.isFinite))) {
      throw new Error(`Approved character clip is invalid: ${name}.`)
    }
  }
  return { scene: gltf.scene, animations: gltf.animations, manifest }
}

function validateSkinWeights(weights: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void {
  for (let index = 0; index < weights.count; index += 1) {
    const values = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)]
    if (!values.every(Number.isFinite) || values.some((weight) => weight < 0)
      || Math.abs(values.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-4) {
      throw new Error('Approved character skin weights must be finite and normalized.')
    }
  }
}

function identityTransform(object: THREE.Object3D): boolean {
  return object.position.lengthSq() < 1e-10
    && object.quaternion.angleTo(new THREE.Quaternion()) < 1e-5
    && object.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
