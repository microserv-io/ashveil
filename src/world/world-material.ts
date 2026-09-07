import * as THREE from 'three'
import { createTerrainPaintData } from './terrain-paint'
import type { WorldPath } from './world-data'

const TEXTURE_ROOT = '/textures/first-zone/'

function loadAlbedo(file: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(`${TEXTURE_ROOT}${file}`)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.MirroredRepeatWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping
  return texture
}

export function createWorldMaterial(paths: readonly WorldPath[]): THREE.MeshStandardMaterial {
  const resolution = 512
  const paintMap = new THREE.DataTexture(createTerrainPaintData(paths, resolution), resolution, resolution)
  paintMap.minFilter = THREE.LinearFilter
  paintMap.magFilter = THREE.LinearFilter
  paintMap.wrapS = THREE.ClampToEdgeWrapping
  paintMap.wrapT = THREE.ClampToEdgeWrapping
  paintMap.needsUpdate = true

  const material = new THREE.MeshStandardMaterial({ map: loadAlbedo('meadow-grass.png'), vertexColors: true, roughness: 0.95 })
  const earthMap = loadAlbedo('worn-earth.png')
  const ashMap = loadAlbedo('ash-ground.png')
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainPaintMap = { value: paintMap }
    shader.uniforms.terrainEarthMap = { value: earthMap }
    shader.uniforms.terrainAshMap = { value: ashMap }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paintUv;\nvarying vec2 vPaintUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintUv = paintUv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D terrainPaintMap;\nuniform sampler2D terrainEarthMap;\nuniform sampler2D terrainAshMap;\nvarying vec2 vPaintUv;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 paintWeights = texture2D(terrainPaintMap, vPaintUv);
          vec4 grassSample = texture2D(map, vMapUv);
          vec4 earthSample = texture2D(terrainEarthMap, vMapUv * 0.8);
          vec4 ashSample = texture2D(terrainAshMap, vMapUv);
          vec4 livingSample = mix(grassSample, earthSample, paintWeights.r);
          diffuseColor *= mix(livingSample, ashSample, paintWeights.g);
        #endif
      `)
  }
  material.customProgramCacheKey = () => 'ashveil-terrain-paint-v1'
  return material
}
