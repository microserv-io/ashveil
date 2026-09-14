import * as THREE from 'three'
import { terrainPaintTextureData } from './terrain-paint'
import type { HillsideTerrainLook } from './hillside-review'
import type { TerrainTextureSet } from './terrain-textures'
import type { CompiledZone } from './zone-types'

export interface WorldTerrainMaterial {
  readonly material: THREE.MeshStandardMaterial
  readonly baselineReady: boolean
  installBaseline(textures: TerrainTextureSet): void
  materialFor(look: HillsideTerrainLook): THREE.MeshStandardMaterial | undefined
  dispose(): void
}

export function createWorldMaterial(painterly: TerrainTextureSet, zone: CompiledZone): WorldTerrainMaterial {
  const paint = terrainPaintTextureData(zone)
  const paintMap = new THREE.DataTexture(paint.data, paint.width, paint.height)
  paintMap.minFilter = THREE.LinearFilter
  paintMap.magFilter = THREE.LinearFilter
  paintMap.wrapS = THREE.ClampToEdgeWrapping
  paintMap.wrapT = THREE.ClampToEdgeWrapping
  paintMap.needsUpdate = true

  const painterlyMaterial = createPainterlyMaterial(painterly, paintMap)
  let baselineMaterial: THREE.MeshStandardMaterial | undefined
  return {
    material: painterlyMaterial,
    get baselineReady() { return Boolean(baselineMaterial) },
    installBaseline: (textures) => {
      baselineMaterial ??= createBaselineMaterial(textures, paintMap)
    },
    materialFor: (look) => look === 'painterly' ? painterlyMaterial : baselineMaterial,
    dispose: () => {
      painterlyMaterial.dispose()
      baselineMaterial?.dispose()
      paintMap.dispose()
    },
  }
}

function createPainterlyMaterial(textures: TerrainTextureSet, paintMap: THREE.DataTexture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: textures.grass, vertexColors: true, roughness: 0.95 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainPaintMap = { value: paintMap }
    shader.uniforms.terrainPainterlyEarthMap = { value: textures.earth }
    shader.uniforms.terrainPainterlyLimestoneMap = { value: textures.limestone }
    shader.uniforms.terrainPainterlyGrassMean = { value: new THREE.Color(0x5e9d4e) }
    shader.uniforms.terrainPainterlyEarthMean = { value: new THREE.Color(0xbd8647) }
    shader.uniforms.terrainPainterlyLimestoneMean = { value: new THREE.Color(0xedd8b4) }
    installTerrainVaryings(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${terrainFragmentCommon()}
uniform sampler2D terrainPainterlyEarthMap;
uniform sampler2D terrainPainterlyLimestoneMap;
uniform vec3 terrainPainterlyGrassMean;
uniform vec3 terrainPainterlyEarthMean;
uniform vec3 terrainPainterlyLimestoneMean;`)
      .replace('#include <map_fragment>', painterlyMapFragment())
      .replace('#include <color_fragment>', `#include <color_fragment>
        float terrainAshInfluence = texture2D(terrainPaintMap, vPaintUv).g;
        float terrainAshLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 terrainDrainedAsh = mix(diffuseColor.rgb, vec3(terrainAshLuma), 0.84);
        terrainDrainedAsh = mix(vec3(0.5), terrainDrainedAsh, 0.68) * vec3(0.96, 1.0, 0.98);
        diffuseColor.rgb = mix(diffuseColor.rgb, terrainDrainedAsh, terrainAshInfluence);`)
  }
  material.customProgramCacheKey = () => 'ashveil-terrain-painterly-v2'
  return material
}

function createBaselineMaterial(textures: TerrainTextureSet, paintMap: THREE.DataTexture): THREE.MeshStandardMaterial {
  if (!textures.ash) throw new Error('Baseline terrain textures require an ash albedo.')
  const material = new THREE.MeshStandardMaterial({ map: textures.grass, vertexColors: true, roughness: 0.95 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainPaintMap = { value: paintMap }
    shader.uniforms.terrainEarthMap = { value: textures.earth }
    shader.uniforms.terrainAshMap = { value: textures.ash }
    shader.uniforms.terrainLimestoneMap = { value: textures.limestone }
    installTerrainVaryings(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${terrainFragmentCommon()}
uniform sampler2D terrainEarthMap;
uniform sampler2D terrainAshMap;
uniform sampler2D terrainLimestoneMap;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 paintWeights = texture2D(terrainPaintMap, vPaintUv);
          vec4 grassSample = texture2D(map, vMapUv);
          vec4 earthSample = texture2D(terrainEarthMap, vMapUv * 0.8);
          vec4 ashSample = texture2D(terrainAshMap, vMapUv);
          vec4 limestoneSample = texture2D(terrainLimestoneMap, vMapUv * 0.72);
          float ashLuma = dot(ashSample.rgb, vec3(0.2126, 0.7152, 0.0722));
          ashSample.rgb = mix(vec3(ashLuma), vec3(0.48, 0.50, 0.49), 0.58);
          float limestoneLuma = dot(limestoneSample.rgb, vec3(0.2126, 0.7152, 0.0722));
          limestoneSample.rgb = mix(limestoneSample.rgb, vec3(limestoneLuma * 1.04), 0.72);
          vec4 livingSample = mix(grassSample, earthSample, paintWeights.r);
          vec4 paintedSample = mix(livingSample, ashSample, paintWeights.g);
          diffuseColor *= mix(paintedSample, limestoneSample, vTerrainStone);
        #endif
      `)
  }
  material.customProgramCacheKey = () => 'ashveil-terrain-baseline-v1'
  return material
}

function installTerrainVaryings(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 paintUv;\nattribute float terrainStone;\nvarying vec2 vPaintUv;\nvarying float vTerrainStone;\nvarying vec2 vTerrainWorldPosition;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintUv = paintUv;\nvTerrainStone = terrainStone;\nvTerrainWorldPosition = position.xz;')
}

function terrainFragmentCommon(): string {
  return `#include <common>
uniform sampler2D terrainPaintMap;
varying vec2 vPaintUv;
varying float vTerrainStone;
varying vec2 vTerrainWorldPosition;`
}

function painterlyMapFragment(): string {
  return `
    #ifdef USE_MAP
      vec4 paintWeights = texture2D(terrainPaintMap, vPaintUv);
      vec2 painterlyUv = vTerrainWorldPosition / 5.2;
      vec3 painterlyA = texture2D(map, painterlyUv).rgb;
      vec3 painterlyB = texture2D(map, vec2(-painterlyUv.y, painterlyUv.x) * 0.83 + vec2(0.37, 0.61)).rgb;
      float sampleBlend = smoothstep(0.18, 0.82, 0.5 + 0.25 * sin(vTerrainWorldPosition.x * 0.071 + vTerrainWorldPosition.y * 0.043) + 0.25 * sin(vTerrainWorldPosition.x * 0.029 - vTerrainWorldPosition.y * 0.061));
      vec3 painterlyGrass = mix(painterlyA, painterlyB, sampleBlend);
      painterlyGrass = mix(painterlyGrass, terrainPainterlyGrassMean, 0.18);
      float macro = 0.5 + 0.28 * sin(vTerrainWorldPosition.x * 0.014 + vTerrainWorldPosition.y * 0.009) + 0.22 * sin(vTerrainWorldPosition.x * 0.007 - vTerrainWorldPosition.y * 0.017);
      vec3 macroTint = mix(vec3(0.90, 1.035, 1.045), vec3(1.075, 1.025, 0.88), smoothstep(0.08, 0.92, macro));
      painterlyGrass *= macroTint;
      float distanceQuieting = smoothstep(42.0, 128.0, length(vViewPosition));
      painterlyGrass = mix(painterlyGrass, terrainPainterlyGrassMean * macroTint, distanceQuieting * 0.42);
      #ifdef USE_COLOR
        painterlyGrass /= max(vColor.rgb, vec3(0.25));
      #endif

      vec2 earthUv = vTerrainWorldPosition / 6.4 + vec2(0.19, 0.43);
      vec3 earthA = texture2D(terrainPainterlyEarthMap, earthUv).rgb;
      vec3 earthB = texture2D(terrainPainterlyEarthMap, vec2(earthUv.y, -earthUv.x) * 0.79 + vec2(0.68, 0.27)).rgb;
      float earthBlend = smoothstep(0.15, 0.85, 0.5 + 0.27 * sin(vTerrainWorldPosition.x * 0.053 - vTerrainWorldPosition.y * 0.037) + 0.23 * sin(vTerrainWorldPosition.x * 0.019 + vTerrainWorldPosition.y * 0.047));
      vec3 painterlyEarth = mix(earthA, earthB, earthBlend);
      painterlyEarth = mix(painterlyEarth, terrainPainterlyEarthMean, 0.14 + distanceQuieting * 0.32);

      vec2 limestoneUv = vTerrainWorldPosition / 7.8 + vec2(0.71, 0.11);
      vec3 limestoneA = texture2D(terrainPainterlyLimestoneMap, limestoneUv).rgb;
      vec3 limestoneB = texture2D(terrainPainterlyLimestoneMap, vec2(-limestoneUv.y, limestoneUv.x) * 0.86 + vec2(0.23, 0.74)).rgb;
      float limestoneBlend = smoothstep(0.16, 0.84, 0.5 + 0.24 * sin(vTerrainWorldPosition.x * 0.041 + vTerrainWorldPosition.y * 0.031) + 0.26 * sin(vTerrainWorldPosition.x * 0.017 - vTerrainWorldPosition.y * 0.043));
      vec3 painterlyLimestone = mix(limestoneA, limestoneB, limestoneBlend);
      painterlyLimestone = mix(painterlyLimestone, terrainPainterlyLimestoneMean, 0.12 + distanceQuieting * 0.38);

      vec3 painterlyGround = mix(painterlyGrass, painterlyEarth, paintWeights.r);
      painterlyGround = mix(painterlyGround, painterlyLimestone, vTerrainStone);
      diffuseColor *= vec4(painterlyGround, 1.0);
    #endif
  `
}
