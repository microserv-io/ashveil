import * as THREE from 'three'
import type { CompiledZone } from './zone-types'

export interface BuiltWaterSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  update(elapsedSeconds: number, lighting?: WaterLighting): void
  dispose(): void
}

export interface WaterLighting {
  readonly direction: THREE.Vector3
  readonly color: THREE.Color
  readonly intensity: number
  readonly ambientColor: THREE.Color
}

const ACROSS_RIVER = [-1, -0.72, 0, 0.72, 1] as const

export function buildWaterSurface(zone: CompiledZone, sunlightDirection: THREE.Vector3): BuiltWaterSurface {
  const rows = Math.ceil((zone.bounds.maxZ - zone.bounds.minZ) / zone.cellSize) + 1
  const positions = new Float32Array(rows * ACROSS_RIVER.length * 3)
  const shore = new Float32Array(rows * ACROSS_RIVER.length)
  const waterDepth = new Float32Array(rows * ACROSS_RIVER.length)
  const indices: number[] = []
  for (let row = 0; row < rows; row += 1) {
    const z = zone.bounds.minZ + (zone.bounds.maxZ - zone.bounds.minZ) * row / (rows - 1)
    const center = zone.riverCenterAt(z)
    const halfWidth = zone.riverHalfWidthAt(z)
    const waterLevel = zone.waterLevelAt(center, z) ?? zone.definition.river.waterLevel
    ACROSS_RIVER.forEach((across, column) => {
      const index = row * ACROSS_RIVER.length + column
      const x = center + halfWidth * across
      positions.set([x, waterLevel, z], index * 3)
      shore[index] = Math.abs(across)
      waterDepth[index] = Math.max(0, waterLevel - zone.heightAt(x, z))
      if (row === 0 || column === 0) return
      const current = index
      const previousRow = current - ACROSS_RIVER.length
      indices.push(previousRow - 1, current - 1, previousRow, previousRow, current - 1, current)
    })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('shore', new THREE.BufferAttribute(shore, 1))
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(waterDepth, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = new THREE.ShaderMaterial({
    name: 'alderbank-river-water',
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      elapsedSeconds: { value: 0 },
      keyLightDirection: { value: sunlightDirection.clone().normalize() },
      keyLightColor: { value: new THREE.Color(0xffd89c) },
      keyLightIntensity: { value: 2.8 },
      ambientLightColor: { value: new THREE.Color(0xf5e8c9) },
      shallowColor: { value: new THREE.Color(0x6aa9a9) },
      deepColor: { value: new THREE.Color(0x173f50) },
      foamColor: { value: new THREE.Color(0xd5e7dc) },
    }]),
    vertexShader: `
      attribute float shore;
      attribute float waterDepth;
      uniform float elapsedSeconds;
      varying float vShore;
      varying float vWaterDepth;
      varying vec3 vWorldPosition;
      #include <fog_pars_vertex>
      void main() {
        vec3 displaced = position;
        float firstWave = sin(position.z * 0.075 - elapsedSeconds * 1.15 + position.x * 0.035);
        float crossWave = sin(position.x * 0.19 + elapsedSeconds * 0.72 + position.z * 0.025);
        displaced.y += (firstWave * 0.055 + crossWave * 0.028) * (1.0 - smoothstep(0.8, 1.0, shore));
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
        vShore = shore;
        vWaterDepth = waterDepth;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float elapsedSeconds;
      uniform vec3 keyLightDirection;
      uniform vec3 keyLightColor;
      uniform float keyLightIntensity;
      uniform vec3 ambientLightColor;
      uniform vec3 shallowColor;
      uniform vec3 deepColor;
      uniform vec3 foamColor;
      varying float vShore;
      varying float vWaterDepth;
      varying vec3 vWorldPosition;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float phaseA = vWorldPosition.z * 0.72 - elapsedSeconds * 1.4 + vWorldPosition.x * 0.18;
        float phaseB = vWorldPosition.x * 1.25 + vWorldPosition.z * 0.14 + elapsedSeconds * 0.86;
        float dx = cos(phaseA) * 0.055 * 0.18 + cos(phaseB) * 0.036 * 1.25;
        float dz = cos(phaseA) * 0.055 * 0.72 + cos(phaseB) * 0.036 * 0.14;
        vec3 normal = normalize(vec3(-dx, 1.0, -dz));
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
        float keyGlint = pow(max(dot(reflect(-keyLightDirection, normal), viewDirection), 0.0), 96.0);
        float depthMix = smoothstep(0.3, 6.0, vWaterDepth);
        vec3 color = mix(shallowColor, deepColor, depthMix);
        vec3 ambientFactor = 0.38 + ambientLightColor * 0.62;
        color *= ambientFactor;
        color += ambientLightColor * fresnel * 0.3 + keyLightColor * keyGlint * keyLightIntensity * 0.5;
        float foamWave = sin(vWorldPosition.z * 0.34 - elapsedSeconds * 1.65 + sin(vWorldPosition.x * 0.13) * 1.8);
        float foam = smoothstep(0.82, 0.97, vShore) * smoothstep(0.1, 0.72, foamWave);
        vec3 litFoamColor = foamColor * ambientFactor + keyLightColor * keyLightIntensity * 0.03;
        color = mix(color, litFoamColor, foam * 0.68);
        float alpha = mix(0.48, 0.78, depthMix) * mix(1.0, 0.48, smoothstep(0.76, 1.0, vShore)) + foam * 0.28;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'alderbank-river'
  mesh.renderOrder = 2
  return {
    mesh,
    update: (elapsedSeconds, lighting) => {
      material.uniforms.elapsedSeconds!.value = elapsedSeconds
      if (!lighting) return
      material.uniforms.keyLightDirection!.value.copy(lighting.direction)
      material.uniforms.keyLightColor!.value.copy(lighting.color)
      material.uniforms.keyLightIntensity!.value = lighting.intensity
      material.uniforms.ambientLightColor!.value.copy(lighting.ambientColor)
    },
    dispose: () => {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
