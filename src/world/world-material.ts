import * as THREE from 'three'
import { terrainPaintTextureData } from './terrain-paint'
import { getActiveZone } from './zone-active'
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
