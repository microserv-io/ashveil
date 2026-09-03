import * as THREE from 'three'

/** Every number the look is tuned by, in one place; sim data never carries presentation. */
export const LOOK = {
  /** Hemisphere fill: warm cream from above, cool violet-grey from the floor. */
  skyLight: 0xfff3e0,
  groundLight: 0x8c86a6,
  fillIntensity: 1.1,
  keyColour: 0xffe9cf,
  keyIntensity: 1.8,
  /** Shadows are a tone shift, not a hole. */
  shadowIntensity: 0.45,
  rimColour: 0x7fa6ff,
  rimIntensity: 0.25,
  /** Lit tiers of the toon ramp, dark to lit; the top must be 1. */
  ramp: [0.4, 0.75, 1] as const,
  /** Where each tier hands over along the light angle (0 = facing away, 1 = facing the light). */
  rampEdges: [0.4, 0.68] as const,
  /** Width of each hand-over; hard steps erase surface form, so the edges are soft. */
  rampSoftness: 0.14,
  /** Enough texels that a hand-over spans several of them under linear filtering. */
  rampTexels: 64,
  /** Multiplier on the base-colour texture's chroma; 1 leaves the texture as authored. */
  saturation: 1.15,
} as const

/** What every body, gear piece, terrain tile and prop is shaded with. */
export type BodyMaterial = THREE.MeshToonMaterial

let sharedRamp: THREE.DataTexture | null = null

/** Fixed digits keep it a GLSL float literal whatever the value. */
const SATURATION_LITERAL = LOOK.saturation.toFixed(3)
const PROGRAM_CACHE_KEY = `ashveil-toon-saturation-${SATURATION_LITERAL}`

/** Shared by every toon material, alongside one cache key, so they all compile to one program. */
const applySaturation: THREE.Material['onBeforeCompile'] = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, ${SATURATION_LITERAL} );`,
  )
}

const toonProgramCacheKey = (): string => PROGRAM_CACHE_KEY

function configureMaterial(material: BodyMaterial): BodyMaterial {
  material.onBeforeCompile = applySaturation
  material.customProgramCacheKey = toonProgramCacheKey
  // Material.copy carries neither hook, and spawnModel clones every material per actor.
  material.clone = cloneBodyMaterial
  return material
}

function cloneBodyMaterial<T extends BodyMaterial>(this: T): T {
  return configureMaterial(new THREE.MeshToonMaterial().copy(this)) as T
}

/** The ramp value at one light angle: tiers joined by smooth hand-overs. */
export function rampAt(coord: number): number {
  let value: number = LOOK.ramp[0]
  LOOK.rampEdges.forEach((edge, index) => {
    const blend = smoothstep(edge - LOOK.rampSoftness / 2, edge + LOOK.rampSoftness / 2, coord)
    value += (LOOK.ramp[index + 1]! - LOOK.ramp[index]!) * blend
  })
  return value
}

function smoothstep(low: number, high: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

export function toonRamp(): THREE.DataTexture {
  if (sharedRamp) return sharedRamp

  const texels = new Uint8Array(LOOK.rampTexels)
  for (let at = 0; at < LOOK.rampTexels; at++) {
    texels[at] = Math.round(rampAt((at + 0.5) / LOOK.rampTexels) * 255)
  }
  sharedRamp = new THREE.DataTexture(texels, LOOK.rampTexels, 1, THREE.RedFormat, THREE.UnsignedByteType)
  sharedRamp.minFilter = THREE.LinearFilter
  sharedRamp.magFilter = THREE.LinearFilter
  sharedRamp.generateMipmaps = false
  sharedRamp.colorSpace = THREE.NoColorSpace
  sharedRamp.needsUpdate = true
  return sharedRamp
}

export function toonMaterial(source: THREE.MeshStandardMaterial): BodyMaterial {
  const material = new THREE.MeshToonMaterial({
    name: source.name,
    map: source.map,
    emissiveIntensity: source.emissiveIntensity,
    emissiveMap: source.emissiveMap,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    vertexColors: source.vertexColors,
    gradientMap: toonRamp(),
  })
  material.color.copy(source.color)
  material.emissive.copy(source.emissive)
  return configureMaterial(material)
}

/** Several primitives can share one glTF material; converting per mesh would split it and dispose it twice. */
const converted = new WeakMap<THREE.MeshStandardMaterial, BodyMaterial>()

export function stylise<T extends THREE.Object3D>(root: T): T {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    const replace = (material: THREE.Material): THREE.Material => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material
      const known = converted.get(material)
      if (known) return known
      const replacement = toonMaterial(material)
      converted.set(material, replacement)
      material.dispose()
      return replacement
    }

    child.material = Array.isArray(child.material)
      ? child.material.map(replace)
      : replace(child.material)
  })
  return root
}

export function isBodyMaterial(material: THREE.Material): material is BodyMaterial {
  return material instanceof THREE.MeshToonMaterial
}
