import * as THREE from 'three'
import { terrainPaintTextureData } from './terrain-paint'
import { getActiveZone } from './zone-active'
import {
  HILLSIDE_REVIEW_CORE_RADIUS,
  HILLSIDE_REVIEW_OUTER_RADIUS,
  type HillsideTerrainLook,
} from './hillside-review'
import type { CompiledZone } from './zone-types'

const TEXTURE_ROOT = '/textures/first-zone/'

function loadAlbedo(file: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(`${TEXTURE_ROOT}${file}`)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.MirroredRepeatWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping
  return texture
}

export function createWorldMaterial(zone: CompiledZone = getActiveZone()): THREE.MeshStandardMaterial {
  const paint = terrainPaintTextureData(zone)
  const paintMap = new THREE.DataTexture(paint.data, paint.width, paint.height)
  paintMap.minFilter = THREE.LinearFilter
  paintMap.magFilter = THREE.LinearFilter
  paintMap.wrapS = THREE.ClampToEdgeWrapping
  paintMap.wrapT = THREE.ClampToEdgeWrapping
  paintMap.needsUpdate = true

  const material = new THREE.MeshStandardMaterial({ map: loadAlbedo('meadow-grass.png'), vertexColors: true, roughness: 0.95 })
  const earthMap = loadAlbedo('worn-earth.png')
  const ashMap = loadAlbedo('ash-ground.png')
  const limestoneMap = loadAlbedo('ivory-limestone.png')
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainPaintMap = { value: paintMap }
    shader.uniforms.terrainEarthMap = { value: earthMap }
    shader.uniforms.terrainAshMap = { value: ashMap }
    shader.uniforms.terrainLimestoneMap = { value: limestoneMap }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paintUv;\nattribute float terrainStone;\nvarying vec2 vPaintUv;\nvarying float vTerrainStone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintUv = paintUv;\nvTerrainStone = terrainStone;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D terrainPaintMap;\nuniform sampler2D terrainEarthMap;\nuniform sampler2D terrainAshMap;\nuniform sampler2D terrainLimestoneMap;\nvarying vec2 vPaintUv;\nvarying float vTerrainStone;')
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
  material.customProgramCacheKey = () => 'ashveil-terrain-paint-v2'
  material.addEventListener('dispose', () => {
    material.map?.dispose()
    earthMap.dispose()
    ashMap.dispose()
    limestoneMap.dispose()
    paintMap.dispose()
  })
  return material
}

export interface HillsideReviewMaterial {
  readonly material: THREE.MeshStandardMaterial
  setLook(look: HillsideTerrainLook): void
}

export function createHillsideReviewMaterial(
  painterlyGrassMap: THREE.Texture,
  zone: CompiledZone = getActiveZone(),
): HillsideReviewMaterial {
  const paint = terrainPaintTextureData(zone)
  const paintMap = new THREE.DataTexture(paint.data, paint.width, paint.height)
  paintMap.minFilter = THREE.LinearFilter
  paintMap.magFilter = THREE.LinearFilter
  paintMap.wrapS = THREE.ClampToEdgeWrapping
  paintMap.wrapT = THREE.ClampToEdgeWrapping
  paintMap.needsUpdate = true

  const reviewBlend = { value: 0 }
  const material = new THREE.MeshStandardMaterial({ map: loadAlbedo('meadow-grass.png'), vertexColors: true, roughness: 0.95 })
  const earthMap = loadAlbedo('worn-earth.png')
  const ashMap = loadAlbedo('ash-ground.png')
  const limestoneMap = loadAlbedo('ivory-limestone.png')
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainPaintMap = { value: paintMap }
    shader.uniforms.terrainEarthMap = { value: earthMap }
    shader.uniforms.terrainAshMap = { value: ashMap }
    shader.uniforms.terrainLimestoneMap = { value: limestoneMap }
    shader.uniforms.terrainPainterlyGrassMap = { value: painterlyGrassMap }
    shader.uniforms.terrainPainterlyMean = { value: new THREE.Color(0x5e9d4e) }
    shader.uniforms.terrainReviewBlend = reviewBlend
    shader.uniforms.terrainReviewCenter = { value: new THREE.Vector2(zone.spawn.x, zone.spawn.z) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paintUv;\nattribute float terrainStone;\nvarying vec2 vPaintUv;\nvarying float vTerrainStone;\nvarying vec2 vTerrainWorldPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintUv = paintUv;\nvTerrainStone = terrainStone;\nvTerrainWorldPosition = position.xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D terrainPaintMap;
uniform sampler2D terrainEarthMap;
uniform sampler2D terrainAshMap;
uniform sampler2D terrainLimestoneMap;
uniform sampler2D terrainPainterlyGrassMap;
uniform vec3 terrainPainterlyMean;
uniform float terrainReviewBlend;
uniform vec2 terrainReviewCenter;
varying vec2 vPaintUv;
varying float vTerrainStone;
varying vec2 vTerrainWorldPosition;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 paintWeights = texture2D(terrainPaintMap, vPaintUv);
          vec4 baselineGrass = texture2D(map, vMapUv);
          vec2 painterlyUv = vTerrainWorldPosition / 5.2;
          vec3 painterlyA = texture2D(terrainPainterlyGrassMap, painterlyUv).rgb;
          vec3 painterlyB = texture2D(terrainPainterlyGrassMap, vec2(-painterlyUv.y, painterlyUv.x) * 0.83 + vec2(0.37, 0.61)).rgb;
          float sampleBlend = smoothstep(0.18, 0.82, 0.5 + 0.25 * sin(vTerrainWorldPosition.x * 0.071 + vTerrainWorldPosition.y * 0.043) + 0.25 * sin(vTerrainWorldPosition.x * 0.029 - vTerrainWorldPosition.y * 0.061));
          vec3 painterlyGrass = mix(painterlyA, painterlyB, sampleBlend);
          painterlyGrass = mix(painterlyGrass, terrainPainterlyMean, 0.18);
          float macro = 0.5 + 0.28 * sin(vTerrainWorldPosition.x * 0.014 + vTerrainWorldPosition.y * 0.009) + 0.22 * sin(vTerrainWorldPosition.x * 0.007 - vTerrainWorldPosition.y * 0.017);
          vec3 macroTint = mix(vec3(0.90, 1.035, 1.045), vec3(1.075, 1.025, 0.88), smoothstep(0.08, 0.92, macro));
          painterlyGrass *= macroTint;
          float distanceQuieting = smoothstep(42.0, 128.0, length(vViewPosition));
          painterlyGrass = mix(painterlyGrass, terrainPainterlyMean * macroTint, distanceQuieting * 0.42);
          #ifdef USE_COLOR
            painterlyGrass /= max(vColor.rgb, vec3(0.25));
          #endif
          float hillsideMask = 1.0 - smoothstep(${HILLSIDE_REVIEW_CORE_RADIUS.toFixed(1)}, ${HILLSIDE_REVIEW_OUTER_RADIUS.toFixed(1)}, distance(vTerrainWorldPosition, terrainReviewCenter));
          vec4 grassSample = mix(baselineGrass, vec4(painterlyGrass, 1.0), hillsideMask * terrainReviewBlend);
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
  material.customProgramCacheKey = () => 'ashveil-terrain-hillside-review-v1'
  material.addEventListener('dispose', () => {
    material.map?.dispose()
    earthMap.dispose()
    ashMap.dispose()
    limestoneMap.dispose()
    painterlyGrassMap.dispose()
    paintMap.dispose()
  })
  return {
    material,
    setLook: (look) => { reviewBlend.value = look === 'painterly' ? 1 : 0 },
  }
}
