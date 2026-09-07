import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'
import * as THREE from 'three'
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import {
  buildSceneryKitInstances,
  buildTreeCameraProxies,
  SceneryKitSource,
  TREE_GROUND_ZONE_CUTOFF,
  validateSceneryKit,
} from '../src/world/scenery-kit'
import { SOLIDS } from '../src/world/world-data'
import { BUILDING_STYLES } from '../src/world/scenery-layout'

const ROOT = join(import.meta.dirname, '..')
const KIT_PATH = join(ROOT, 'public/world/first-zone/scenery-kit.glb')
const SCENERY_ATLAS_SIZE = 2048

interface SceneryManifest {
  readonly asset: { readonly sha256: string }
  readonly treeGroundZoneCutoff: number
  readonly material: {
    readonly name: string
    readonly vertexColorAttribute: string
    readonly uvAttribute: string
    readonly bindings: { readonly baseColor: string; readonly orm: readonly string[]; readonly normal: string }
    readonly atlas: {
      readonly dimensions: readonly [number, number]
      readonly gutterPixels: number
      readonly uvOrigin: string
      readonly semanticRects: Readonly<Record<string, { readonly uvMinimum: readonly [number, number]; readonly uvMaximum: readonly [number, number] }>>
      readonly images: readonly {
        readonly name: string
        readonly embeddedFile: string
        readonly sha256: string
        readonly encodedBytes: number
        readonly decodedRgbaBytes: number
        readonly colorSpace: string
        readonly nativeChannels: readonly string[]
        readonly channels: Readonly<Record<string, string>>
        readonly opacityFactor?: number
      }[]
    }
  }
}
function texture(name: string, colorSpace: THREE.ColorSpace = THREE.NoColorSpace): THREE.Texture {
  const atlas = new THREE.Texture({ width: SCENERY_ATLAS_SIZE, height: SCENERY_ATLAS_SIZE })
  atlas.name = name
  atlas.colorSpace = colorSpace
  atlas.flipY = false
  return atlas
}

function pbrMaterial(): THREE.MeshStandardMaterial {
  const baseColor = texture('scenery-atlas-basecolor.png', THREE.SRGBColorSpace)
  const normal = texture('scenery-atlas-normal.png')
  const orm = texture('scenery-atlas-orm.png')
  const material = new THREE.MeshStandardMaterial({
    map: baseColor,
    normalMap: normal,
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: orm,
    vertexColors: true,
  })
  material.name = 'scenery_pbr_atlas'
  return material
}

function prototype(name: string, footprintRadius: number, material: THREE.MeshStandardMaterial): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(footprintRadius, 3, footprintRadius)
  geometry.translate(0, 1, 0)
  const color = new Float32Array(geometry.getAttribute('position').count * 3).fill(0.7)
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.userData = { footprintRadius, templateKind: name, groundedY: 0 }
  return mesh
}

function kitScene(): THREE.Scene {
  const scene = new THREE.Scene()
  const material = pbrMaterial()
  scene.add(
    prototype('refuge_hall', 6, material),
    prototype('cottage', 4, material),
    prototype('alder_tree', 1.1, material),
    prototype('orchard_tree', 1.1, material),
  )
  return scene
}

function nodeTextureLoader(): GLTFLoader {
  const sourceCache = new Map<number, Promise<{ data: Uint8Array; width: number; height: number }>>()
  const textureCache = new Map<string, Promise<THREE.Texture>>()
  const wrapping = new Map<number | undefined, THREE.Wrapping>([
    [33071, THREE.ClampToEdgeWrapping], [33648, THREE.MirroredRepeatWrapping], [10497, THREE.RepeatWrapping],
    [undefined, THREE.RepeatWrapping],
  ])
  const filters = new Map<number | undefined, THREE.TextureFilter>([
    [9728, THREE.NearestFilter], [9729, THREE.LinearFilter], [9984, THREE.NearestMipmapNearestFilter],
    [9985, THREE.LinearMipmapNearestFilter], [9986, THREE.NearestMipmapLinearFilter],
    [9987, THREE.LinearMipmapLinearFilter], [undefined, THREE.LinearMipmapLinearFilter],
  ])
  return new GLTFLoader().register((parser: GLTFParser) => ({
    name: 'ASHVEIL_node_png',
    loadTexture: (textureIndex: number) => {
      const textureDef = parser.json.textures?.[textureIndex]
      const sourceIndex = textureDef?.source
      const sourceDef = parser.json.images?.[sourceIndex]
      if (typeof sourceIndex !== 'number' || sourceDef?.mimeType !== 'image/png' || typeof sourceDef.bufferView !== 'number') return null
      const cacheKey = `${sourceDef.bufferView}:${textureDef.sampler ?? ''}`
      const cachedTexture = textureCache.get(cacheKey)
      if (cachedTexture) return cachedTexture
      let decoded = sourceCache.get(sourceIndex)
      if (!decoded) {
        decoded = parser.getDependency('bufferView', sourceDef.bufferView)
          .then(async (bytes: ArrayBuffer) => {
            const { data, info } = await sharp(new Uint8Array(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
            return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
          })
        sourceCache.set(sourceIndex, decoded)
      }
      const loadedTexture = decoded.then(({ data, width, height }) => {
        const atlas = new THREE.DataTexture(data, width, height)
        const sampler = parser.json.samplers?.[textureDef.sampler] ?? {}
        const wrapS = wrapping.get(sampler.wrapS)
        const wrapT = wrapping.get(sampler.wrapT)
        const magFilter = sampler.magFilter === undefined ? THREE.LinearFilter : filters.get(sampler.magFilter)
        const minFilter = filters.get(sampler.minFilter)
        if (wrapS === undefined || wrapT === undefined || magFilter === undefined || minFilter === undefined
          || (magFilter !== THREE.NearestFilter && magFilter !== THREE.LinearFilter)) {
          throw new Error(`Unsupported glTF sampler on scenery texture ${textureIndex}.`)
        }
        atlas.name = textureDef.name || sourceDef.name || ''
        atlas.userData.mimeType = sourceDef.mimeType
        atlas.flipY = false
        atlas.wrapS = wrapS
        atlas.wrapT = wrapT
        atlas.magFilter = magFilter
        atlas.minFilter = minFilter
        atlas.generateMipmaps = atlas.minFilter !== THREE.NearestFilter && atlas.minFilter !== THREE.LinearFilter
        atlas.needsUpdate = true
        parser.associations.set(atlas, { textures: textureIndex })
        return atlas
      })
      textureCache.set(cacheKey, loadedTexture)
      return loadedTexture
    },
  }))
}

describe('first-zone Blender scenery kit', () => {
  it('parses and validates the shipped GLB', async () => {
    const file = readFileSync(KIT_PATH)
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const gltf = await nodeTextureLoader().parseAsync(buffer, '')
    const kit = validateSceneryKit(gltf.scene)
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public/world/first-zone/scenery-kit.manifest.json'), 'utf8')) as SceneryManifest
    expect(Object.keys(kit)).toEqual(['refuge_hall', 'cottage', 'alder_tree', 'orchard_tree'])
    const material = kit.cottage.material
    expect(createHash('sha256').update(file).digest('hex')).toBe(manifest.asset.sha256)
    expect(manifest.treeGroundZoneCutoff).toBe(TREE_GROUND_ZONE_CUTOFF)
    expect({
      name: manifest.material.name,
      vertexColorAttribute: manifest.material.vertexColorAttribute,
      uvAttribute: manifest.material.uvAttribute,
      bindings: manifest.material.bindings,
      dimensions: manifest.material.atlas.dimensions,
      gutterPixels: manifest.material.atlas.gutterPixels,
      uvOrigin: manifest.material.atlas.uvOrigin,
    }).toEqual({
      name: 'scenery_pbr_atlas',
      vertexColorAttribute: 'COLOR_0',
      uvAttribute: 'TEXCOORD_0',
      bindings: { baseColor: 'baseColorTexture', orm: ['occlusionTexture', 'metallicRoughnessTexture'], normal: 'normalTexture' },
      dimensions: [SCENERY_ATLAS_SIZE, SCENERY_ATLAS_SIZE],
      gutterPixels: 14,
      uvOrigin: 'topLeft',
    })
    expect(manifest.material.atlas.images.map(({ name, embeddedFile, colorSpace, nativeChannels, channels, opacityFactor }) =>
      ({ name, embeddedFile, colorSpace, nativeChannels, channels, opacityFactor }))).toEqual([
      {
        name: 'scenery-atlas-basecolor', embeddedFile: 'scenery-atlas-basecolor.png', colorSpace: 'sRGB',
        nativeChannels: ['R', 'G', 'B'], channels: { rgb: 'baseColor' }, opacityFactor: 1,
      },
      {
        name: 'scenery-atlas-orm', embeddedFile: 'scenery-atlas-orm.png', colorSpace: 'linear',
        nativeChannels: ['R', 'G', 'B'], channels: { r: 'ambientOcclusion', g: 'roughness', b: 'metallic' },
        opacityFactor: undefined,
      },
      {
        name: 'scenery-atlas-normal', embeddedFile: 'scenery-atlas-normal.png', colorSpace: 'linear',
        nativeChannels: ['R', 'G', 'B'], channels: { rgb: 'tangentNormal' }, opacityFactor: undefined,
      },
    ])
    expect(gltf.parser.json.images).toHaveLength(3)
    const imageDefinitions = gltf.parser.json.images as { name?: string; bufferView?: number; mimeType?: string; uri?: string }[]
    expect(imageDefinitions.every((image) =>
      typeof image.bufferView === 'number' && image.mimeType === 'image/png' && image.uri === undefined)).toBe(true)
    for (const expected of manifest.material.atlas.images) {
      const imageDefinition = imageDefinitions.find((image) => image.name === expected.name)
      expect(imageDefinition, `embedded image ${expected.name}`).toBeDefined()
      const encoded = new Uint8Array(await gltf.parser.getDependency('bufferView', imageDefinition!.bufferView!))
      expect(encoded.byteLength).toBe(expected.encodedBytes)
      expect(createHash('sha256').update(encoded).digest('hex')).toBe(expected.sha256)
    }
    expect(material.name).toBe(manifest.material.name)
    expect([material.map!.name, material.roughnessMap!.name, material.normalMap!.name]).toEqual(
      manifest.material.atlas.images.map((image) => image.name),
    )
    for (const atlas of [material.map, material.normalMap, material.roughnessMap]) {
      expect(atlas).toBeInstanceOf(THREE.DataTexture)
      expect({
        channel: atlas!.channel,
        flipY: atlas!.flipY,
        magFilter: atlas!.magFilter,
        minFilter: atlas!.minFilter,
        wrapS: atlas!.wrapS,
        wrapT: atlas!.wrapT,
      }).toEqual({
        channel: 0,
        flipY: false,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearMipmapLinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      })
      const image = atlas!.image as { data: Uint8Array; width: number; height: number }
      const expected = manifest.material.atlas.images.find((candidate) => candidate.name === atlas!.name)!
      expect([image.width, image.height, image.data.byteLength]).toEqual([
        SCENERY_ATLAS_SIZE, SCENERY_ATLAS_SIZE, expected.decodedRgbaBytes,
      ])
    }
    for (const mesh of gltf.parser.json.meshes as { primitives: { attributes: Readonly<Record<string, number>> }[] }[]) {
      for (const primitive of mesh.primitives) {
        expect(Object.keys(primitive.attributes).filter((name) => name.startsWith('COLOR_'))).toEqual(['COLOR_0'])
        expect(Object.keys(primitive.attributes).filter((name) => name.startsWith('TEXCOORD_'))).toEqual(['TEXCOORD_0'])
      }
    }
    const baseColor = material.map!.image as { data: Uint8Array; width: number; height: number }
    expect(Object.keys(manifest.material.atlas.semanticRects).sort()).toEqual([
      'bark', 'cloth', 'leaves', 'plaster', 'roof', 'stone', 'wood',
    ])
    const atlasRgb = new Set<number>()
    for (const [semantic, rect] of Object.entries(manifest.material.atlas.semanticRects)) {
      expect([...rect.uvMinimum, ...rect.uvMaximum].every((coordinate) => coordinate >= 0 && coordinate <= 1)).toBe(true)
      const sampledRgb = new Set<number>()
      for (let row = 1; row <= 8; row += 1) {
        for (let column = 1; column <= 8; column += 1) {
          const u = rect.uvMinimum[0] + (rect.uvMaximum[0] - rect.uvMinimum[0]) * column / 9
          const v = rect.uvMinimum[1] + (rect.uvMaximum[1] - rect.uvMinimum[1]) * row / 9
          const offset = (Math.floor(v * (baseColor.height - 1)) * baseColor.width
            + Math.floor(u * (baseColor.width - 1))) * 4
          const rgb = (baseColor.data[offset]! << 16) | (baseColor.data[offset + 1]! << 8) | baseColor.data[offset + 2]!
          sampledRgb.add(rgb)
          atlasRgb.add(rgb)
        }
      }
      expect(sampledRgb.size, `${semantic} base-colour variation`).toBeGreaterThan(1)
    }
    expect(atlasRgb.size).toBeGreaterThan(32)
    const expectedSemantics: Readonly<Record<keyof typeof kit, readonly string[]>> = {
      refuge_hall: ['cloth', 'plaster', 'roof', 'stone', 'wood'],
      cottage: ['plaster', 'roof', 'stone', 'wood'],
      alder_tree: ['bark', 'leaves'],
      orchard_tree: ['bark', 'leaves', 'roof'],
    }
    for (const [name, template] of Object.entries(kit) as [keyof typeof kit, (typeof kit)[keyof typeof kit]][]) {
      const uv = template.geometry.getAttribute('uv')
      const occupied = new Set<string>()
      const invalidCoordinates: string[] = []
      for (let index = 0; index < uv.count; index += 1) {
        const u = uv.getX(index)
        const v = uv.getY(index)
        const matches = Object.entries(manifest.material.atlas.semanticRects)
          .filter(([, rect]) => u >= rect.uvMinimum[0] - 1e-5 && u <= rect.uvMaximum[0] + 1e-5
            && v >= rect.uvMinimum[1] - 1e-5 && v <= rect.uvMaximum[1] + 1e-5)
          .map(([semantic]) => semantic)
        if (matches.length === 1) occupied.add(matches[0]!)
        else if (invalidCoordinates.length < 8) invalidCoordinates.push(`${index}:(${u},${v})->[${matches.join(',')}]`)
      }
      expect(invalidCoordinates, `${name} UVs outside or across semantic regions`).toEqual([])
      expect([...occupied].sort(), `${name} semantic UV occupancy`).toEqual(expectedSemantics[name])
    }
    expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(material.normalMap!.colorSpace).toBe(THREE.NoColorSpace)
    expect(material.roughnessMap).toBe(material.metalnessMap)
    expect(material.roughnessMap).toBe(material.aoMap)
  })

  it('creates four instance batches at authoritative solid anchors', () => {
    const kit = validateSceneryKit(kitScene())
    const group = buildSceneryKitInstances(kit, { heightAt: (x, z) => x * 0.01 + z * 0.02, solids: SOLIDS })
    const batches = group.children as THREE.InstancedMesh[]
    expect(batches.map((batch) => [batch.name, batch.count])).toEqual([
      ['kit-refuge_hall', 2], ['kit-cottage', 4], ['kit-alder_tree', 21], ['kit-orchard_tree', 12],
    ])
    const buildingYaws = new Map<string, number>(BUILDING_STYLES.map((building) => [building.id, building.yaw]))
    const expected = [
      SOLIDS.filter((solid) => solid.id === 'refuge-hall' || solid.id === 'farm-barn'),
      SOLIDS.filter((solid) => buildingYaws.has(solid.id) && solid.id !== 'refuge-hall' && solid.id !== 'farm-barn'),
      SOLIDS.filter((solid) => solid.id.startsWith('grove-tree-') || solid.id.startsWith('wild-tree-')),
      SOLIDS.filter((solid) => solid.id.startsWith('orchard-tree-')),
    ]
    expect(expected.flat()).toHaveLength(39)
    batches.forEach((batch, batchIndex) => expected[batchIndex]!.forEach((solid, index) => {
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      const rotation = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      batch.getMatrixAt(index, matrix)
      matrix.decompose(position, rotation, scale)
      expect(position.x).toBeCloseTo(solid.x)
      expect(position.y).toBeCloseTo(solid.x * 0.01 + solid.z * 0.02)
      expect(position.z).toBeCloseTo(solid.z)
      const template = kit[batches[batchIndex]!.name.replace('kit-', '') as keyof typeof kit]
      const expectedScale = Math.min(1, solid.radius / Number(template.userData.footprintRadius))
      expect(scale.x).toBeCloseTo(expectedScale)
      expect(scale.y).toBeCloseTo(scale.x)
      expect(scale.z).toBeCloseTo(scale.x)
      const yaw = new THREE.Euler().setFromQuaternion(rotation, 'YXZ').y
      expect(yaw).toBeCloseTo(buildingYaws.get(solid.id) ?? 0)
    }))
  })

  it('uses raycastable trunk proxies without treating canopies as camera walls', () => {
    const proxies = buildTreeCameraProxies({ heightAt: () => 0, solids: SOLIDS })
    const tree = SOLIDS.find((solid) => solid.id === 'orchard-tree-01')!
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(tree.x, 2.2, tree.z - 8),
      new THREE.Vector3(0, 0, 1),
      0,
      16,
    )
    expect(raycaster.intersectObjects(proxies.children, true).length).toBeGreaterThan(0)
    expect(((proxies.children[0] as THREE.InstancedMesh).material as THREE.Material).visible).toBe(false)
  })

  it('rejects malformed roots before placing any scenery', () => {
    const scene = kitScene()
    const cottage = scene.getObjectByName('cottage') as THREE.Mesh
    cottage.geometry.deleteAttribute('color')
    expect(() => validateSceneryKit(scene)).toThrow(/cottage.*vertex colours/i)
  })

  it('rejects extra or nested template mesh roots', () => {
    const extra = kitScene()
    extra.add(prototype('unused', 1, pbrMaterial()))
    expect(() => validateSceneryKit(extra)).toThrow(/exactly the four direct/i)

    const nested = kitScene()
    const cottage = nested.getObjectByName('cottage')!
    const parent = new THREE.Group()
    parent.position.x = 1
    parent.add(cottage)
    nested.add(parent)
    expect(() => validateSceneryKit(nested)).toThrow(/exactly the four direct/i)
  })

  it('checks real grounding instead of trusting extras', () => {
    const scene = kitScene()
    const hall = scene.getObjectByName('refuge_hall') as THREE.Mesh
    hall.geometry.translate(0, 3, 0)
    expect(() => validateSceneryKit(scene)).toThrow(/ground plane/i)
  })

  it('measures tree roots through the one-metre ground zone while allowing crown overhang', () => {
    const crown = kitScene()
    const crownPositions = (crown.getObjectByName('alder_tree') as THREE.Mesh).geometry.getAttribute('position')
    crownPositions.setXYZ(0, 4, TREE_GROUND_ZONE_CUTOFF + 0.01, 0)
    expect(() => validateSceneryKit(crown)).not.toThrow()

    const root = kitScene()
    const rootPositions = (root.getObjectByName('alder_tree') as THREE.Mesh).geometry.getAttribute('position')
    rootPositions.setXYZ(0, 4, TREE_GROUND_ZONE_CUTOFF, 0)
    expect(() => validateSceneryKit(root)).toThrow(/alder_tree.*footprint/i)
  })

  it('rejects missing, mismatched, non-finite, and out-of-range texture coordinates', () => {
    const missing = kitScene()
    ;(missing.getObjectByName('cottage') as THREE.Mesh).geometry.deleteAttribute('uv')
    expect(() => validateSceneryKit(missing)).toThrow(/cottage.*texture coordinates/i)

    const mismatched = kitScene()
    ;(mismatched.getObjectByName('cottage') as THREE.Mesh).geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(2), 2))
    expect(() => validateSceneryKit(mismatched)).toThrow(/cottage.*texture coordinates/i)

    const nonFinite = kitScene()
    ;((nonFinite.getObjectByName('cottage') as THREE.Mesh).geometry.getAttribute('uv') as THREE.BufferAttribute).setX(0, Number.NaN)
    expect(() => validateSceneryKit(nonFinite)).toThrow(/cottage.*invalid texture coordinates/i)

    const outsideAtlas = kitScene()
    ;((outsideAtlas.getObjectByName('cottage') as THREE.Mesh).geometry.getAttribute('uv') as THREE.BufferAttribute).setY(0, 1.01)
    expect(() => validateSceneryKit(outsideAtlas)).toThrow(/cottage.*outside the shared atlas/i)
  })

  it('rejects a missing texture binding, clears the cached failure, and retries', async () => {
    let attempts = 0
    const loader = {
      loadAsync: async () => {
        attempts += 1
        const scene = kitScene()
        if (attempts === 1) (scene.getObjectByName('cottage') as THREE.Mesh).material = pbrMaterial()
        if (attempts === 1) ((scene.getObjectByName('cottage') as THREE.Mesh).material as THREE.MeshStandardMaterial).aoMap = null
        return { scene }
      },
    }
    const source = new SceneryKitSource(loader)
    await expect(source.load()).rejects.toThrow(/could not load/i)
    await expect(source.load()).resolves.toBeDefined()
    await source.load()
    expect(attempts).toBe(2)
  })

  it('clears a rejected cached load and retries once requested', async () => {
    let attempts = 0
    const loader = {
      loadAsync: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network unavailable')
        return { scene: kitScene() }
      },
    }
    const source = new SceneryKitSource(loader)
    await expect(source.load()).rejects.toThrow(/could not load/i)
    await expect(source.load()).resolves.toBeDefined()
    await source.load()
    expect(attempts).toBe(2)
  })
})
