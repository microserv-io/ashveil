import * as THREE from 'three'

/** Every number the look is tuned by, in one place; sim data never carries presentation. */
export const LOOK = {
  /** Hemisphere fill: warm cream from above, cool violet-grey from the floor. */
  skyLight: 0xfff3e0,
  groundLight: 0x8c86a6,
  fillIntensity: 2,
  keyColour: 0xffe9cf,
  keyIntensity: 1.2,
  /** Shadows are a tone shift, not a hole. */
  shadowIntensity: 0.45,
  rimColour: 0x7fa6ff,
  rimIntensity: 0.25,
  /** Three lit tiers of the toon ramp, dark to lit; the top must be 1. */
  ramp: [0.45, 0.78, 1] as const,
  /** Multiplier on the base-colour texture's chroma; 1 leaves the texture as authored. */
  saturation: 1.15,
} as const

/** What every body, gear piece, terrain tile and prop is shaded with. */
export type BodyMaterial = THREE.MeshToonMaterial

let sharedRamp: THREE.DataTexture | null = null

/** Fixed digits keep it a GLSL float literal whatever the value. */
const SATURATION_LITERAL = LOOK.saturation.toFixed(3)
const PROGRAM_CACHE_KEY = `ashveil-toon-saturation-${SATURATION_LITERAL}`

/** One shared function: three keys its program cache on this, so a closure per material would compile one program each. */
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

export function toonRamp(): THREE.DataTexture {
  if (sharedRamp) return sharedRamp

  const texels = new Uint8Array(LOOK.ramp.map((step) => Math.round(step * 255)))
  sharedRamp = new THREE.DataTexture(
    texels,
    LOOK.ramp.length,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  )
  sharedRamp.minFilter = THREE.NearestFilter
  sharedRamp.magFilter = THREE.NearestFilter
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

/** A glTF material shared by several primitives stays one material after conversion. */
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
