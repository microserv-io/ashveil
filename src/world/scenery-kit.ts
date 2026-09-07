import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BUILDING_STYLES, type ScenerySolid } from './scenery-layout'

export const SCENERY_KIT_URL = '/world/first-zone/scenery-kit.glb'
export const TREE_GROUND_ZONE_CUTOFF = 1

const TEMPLATE_NAMES = ['refuge_hall', 'cottage', 'alder_tree', 'orchard_tree'] as const
type TemplateName = typeof TEMPLATE_NAMES[number]

const MAX_FOOTPRINT: Readonly<Record<TemplateName, number>> = {
  refuge_hall: 6,
  cottage: 4,
  alder_tree: 1.1,
  orchard_tree: 1.15,
}

export type SceneryKit = Readonly<Record<TemplateName, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>>

interface LoaderLike {
  loadAsync(url: string): Promise<{ scene: THREE.Object3D }>
}

export interface KitPlacementOptions {
  readonly heightAt: (x: number, z: number) => number
  readonly solids: readonly ScenerySolid[]
}

export class SceneryKitSource {
  private pending: Promise<SceneryKit> | undefined

  constructor(private readonly loader: LoaderLike = new GLTFLoader()) {}

  load(): Promise<SceneryKit> {
    if (this.pending) return this.pending
    this.pending = this.loader.loadAsync(SCENERY_KIT_URL)
      .then((gltf) => validateSceneryKit(gltf.scene))
      .catch((cause: unknown) => {
        this.pending = undefined
        throw new Error('Could not load the Alderbank scenery kit.', { cause })
      })
    return this.pending
  }
}

const sharedSource = new SceneryKitSource()
export function loadSceneryKit(): Promise<SceneryKit> { return sharedSource.load() }

export function validateSceneryKit(scene: THREE.Object3D): SceneryKit {
  const directMeshes = scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
  if (scene.children.length !== TEMPLATE_NAMES.length || directMeshes.length !== TEMPLATE_NAMES.length
    || directMeshes.some((mesh) => !TEMPLATE_NAMES.includes(mesh.name as TemplateName))) {
    throw new Error('Scenery kit must contain exactly the four direct template meshes.')
  }
  const templates = {} as Record<TemplateName, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>
  let sharedTextures: readonly THREE.Texture[] | undefined
  for (const name of TEMPLATE_NAMES) {
    const root = scene.getObjectByName(name)
    if (!(root instanceof THREE.Mesh) || root.parent !== scene || !(root.geometry instanceof THREE.BufferGeometry)) {
      throw new Error(`Scenery kit root ${name} must be one mesh.`)
    }
    if (Array.isArray(root.material) || !(root.material instanceof THREE.MeshStandardMaterial)) {
      throw new Error(`Scenery kit root ${name} must use one standard material.`)
    }
    const color = root.geometry.getAttribute('color')
    const position = root.geometry.getAttribute('position')
    if (!color || !position || color.itemSize < 3 || color.count !== position.count || !root.material.vertexColors) {
      throw new Error(`Scenery kit root ${name} must contain vertex colours.`)
    }
    for (let index = 0; index < color.count; index += 1) {
      const channels = [color.getX(index), color.getY(index), color.getZ(index)]
      if (!channels.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
        throw new Error(`Scenery kit root ${name} has invalid vertex colours.`)
      }
    }
    validateTextureCoordinates(root.geometry, name)
    const textures = validateMaterial(root.material, name)
    const expectedTextures = sharedTextures
    if (expectedTextures && textures.some((texture, index) => texture !== expectedTextures[index])) {
      throw new Error(`Scenery kit root ${name} must use the shared PBR atlases.`)
    }
    sharedTextures = textures
    validateTransform(root, name)
    validateGeometry(root.geometry, name)
    const footprint = root.userData.footprintRadius
    if (!Number.isFinite(footprint) || footprint <= 0 || footprint > MAX_FOOTPRINT[name]) {
      throw new Error(`Scenery kit root ${name} has an invalid footprint radius.`)
    }
    if (root.userData.groundedY !== 0 || root.userData.templateKind !== name) {
      throw new Error(`Scenery kit root ${name} has invalid placement metadata.`)
    }
    validateFootprint(root.geometry, name, footprint)
    templates[name] = root
  }
  return templates
}

function validateFootprint(geometry: THREE.BufferGeometry, name: TemplateName, footprint: number): void {
  const position = geometry.getAttribute('position')
  let radial = 0
  let samples = 0
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index)
    if ((name === 'alder_tree' || name === 'orchard_tree') && y > TREE_GROUND_ZONE_CUTOFF) continue
    radial = Math.max(radial, Math.hypot(position.getX(index), position.getZ(index)))
    samples += 1
  }
  if (samples === 0 || radial > footprint + 1e-4) {
    throw new Error(`Scenery kit root ${name} exceeds its authored footprint.`)
  }
}

function validateTextureCoordinates(geometry: THREE.BufferGeometry, name: TemplateName): void {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (!uv || uv.itemSize < 2 || uv.count !== position.count) {
    throw new Error(`Scenery kit root ${name} must contain texture coordinates for every vertex.`)
  }
  for (let index = 0; index < uv.count; index += 1) {
    const coordinates = [uv.getX(index), uv.getY(index)]
    if (!coordinates.every(Number.isFinite)) {
      throw new Error(`Scenery kit root ${name} has invalid texture coordinates.`)
    }
    if (coordinates.some((coordinate) => coordinate < -1e-5 || coordinate > 1 + 1e-5)) {
      throw new Error(`Scenery kit root ${name} has texture coordinates outside the shared atlas.`)
    }
  }
}

function validateMaterial(material: THREE.MeshStandardMaterial, name: TemplateName): readonly THREE.Texture[] {
  const { map, normalMap, roughnessMap, metalnessMap, aoMap } = material
  if (!map || !normalMap || !roughnessMap || metalnessMap !== roughnessMap || aoMap !== roughnessMap) {
    throw new Error(`Scenery kit root ${name} has invalid PBR texture bindings.`)
  }
  const textures = [map, normalMap, roughnessMap] as const
  let sharedDimensions: string | undefined
  for (const texture of textures) {
    const image = texture.image as { width?: unknown; height?: unknown } | undefined
    if (typeof image?.width !== 'number' || !Number.isInteger(image.width) || image.width <= 0
      || typeof image.height !== 'number' || !Number.isInteger(image.height) || image.height <= 0) {
      throw new Error(`Scenery kit root ${name} has an invalid decoded PBR atlas.`)
    }
    const dimensions = `${image.width}x${image.height}`
    if (sharedDimensions && dimensions !== sharedDimensions) {
      throw new Error(`Scenery kit root ${name} has mismatched PBR atlas dimensions.`)
    }
    sharedDimensions = dimensions
  }
  if (map.colorSpace !== THREE.SRGBColorSpace
    || normalMap.colorSpace !== THREE.NoColorSpace || roughnessMap.colorSpace !== THREE.NoColorSpace) {
    throw new Error(`Scenery kit root ${name} has invalid PBR texture colour spaces.`)
  }
  return textures
}

function validateTransform(root: THREE.Object3D, name: string): void {
  const identity = root.position.lengthSq() < 1e-10
    && Math.abs(root.rotation.x) < 1e-5 && Math.abs(root.rotation.y) < 1e-5 && Math.abs(root.rotation.z) < 1e-5
    && root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5
  if (!identity) throw new Error(`Scenery kit root ${name} must have identity transforms.`)
}

function validateGeometry(geometry: THREE.BufferGeometry, name: string): void {
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) throw new Error(`Scenery kit root ${name} has no geometry.`)
  for (let index = 0; index < position.count; index += 1) {
    if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
      throw new Error(`Scenery kit root ${name} has non-finite bounds.`)
    }
  }
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) {
    throw new Error(`Scenery kit root ${name} has non-finite bounds.`)
  }
  if (box.min.y > 0 || box.min.y < -1 || box.max.y < 1.8) {
    throw new Error(`Scenery kit root ${name} does not straddle its ground plane.`)
  }
}

const BUILDING_IDS = new Set<string>(BUILDING_STYLES.map((building) => building.id))

const BATCHES: readonly { readonly template: TemplateName; readonly ids: (solid: ScenerySolid) => boolean }[] = [
  { template: 'refuge_hall', ids: (solid) => solid.id === 'refuge-hall' || solid.id === 'farm-barn' },
  { template: 'cottage', ids: (solid) => BUILDING_IDS.has(solid.id) && solid.id !== 'refuge-hall' && solid.id !== 'farm-barn' },
  { template: 'alder_tree', ids: (solid) => solid.id.startsWith('grove-tree-') || solid.id.startsWith('wild-tree-') },
  { template: 'orchard_tree', ids: (solid) => solid.id.startsWith('orchard-tree-') },
]

export function buildSceneryKitInstances(kit: SceneryKit, options: KitPlacementOptions): THREE.Group {
  const group = new THREE.Group()
  group.name = 'scenery-kit'
  const yaws = new Map<string, number>(BUILDING_STYLES.map((building) => [building.id, building.yaw]))
  for (const batch of BATCHES) {
    const placements = options.solids.filter(batch.ids)
    const source = kit[batch.template]
    const mesh = new THREE.InstancedMesh(source.geometry.clone(), source.material.clone(), placements.length)
    mesh.name = `kit-${batch.template}`
    mesh.castShadow = true
    mesh.receiveShadow = batch.template === 'refuge_hall' || batch.template === 'cottage'
    placements.forEach((solid, index) => {
      const scale = Math.min(1, solid.radius / Number(source.userData.footprintRadius))
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(solid.x, options.heightAt(solid.x, solid.z), solid.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaws.get(solid.id) ?? 0),
        new THREE.Vector3(scale, scale, scale),
      )
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  return group
}

export function buildTreeCameraProxies(options: KitPlacementOptions): THREE.Group {
  const trees = options.solids.filter((solid) =>
    solid.id.startsWith('grove-tree-') || solid.id.startsWith('wild-tree-') || solid.id.startsWith('orchard-tree-'))
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 8)
  const material = new THREE.MeshBasicMaterial({ visible: false })
  const trunks = new THREE.InstancedMesh(geometry, material, trees.length)
  trunks.name = 'camera-tree-trunks'
  trees.forEach((tree, index) => {
    const height = 4.4
    const radius = tree.radius * 0.62
    trunks.setMatrixAt(index, new THREE.Matrix4().compose(
      new THREE.Vector3(tree.x, options.heightAt(tree.x, tree.z) + height / 2, tree.z),
      new THREE.Quaternion(),
      new THREE.Vector3(radius, height, radius),
    ))
  })
  trunks.instanceMatrix.needsUpdate = true
  trunks.computeBoundingBox()
  trunks.computeBoundingSphere()
  const group = new THREE.Group()
  group.name = 'camera-tree-proxies'
  group.add(trunks)
  group.updateMatrixWorld(true)
  return group
}
