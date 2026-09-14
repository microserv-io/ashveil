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

export function buildWaterSurface(zone: CompiledZone, sunlightDirection: THREE.Vector3): BuiltWaterSurface {
  const surface = zone.waterGeometry()
  const positions = new Float32Array(surface.vertices.length * 3)
  const waterDepth = new Float32Array(surface.vertices.length)
  surface.vertices.forEach((vertex, index) => {
    positions.set([vertex.x, zone.definition.river.waterLevel, vertex.z], index * 3)
    waterDepth[index] = vertex.depth
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(waterDepth, 1))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(surface.indices), 1))
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
      shallowColor: { value: new THREE.Color(0x42bde8) },
      deepColor: { value: new THREE.Color(0x075ca8) },
      foamColor: { value: new THREE.Color(0xf4f0dc) },
    }]),
    vertexShader: `
      attribute float waterDepth;
      uniform float elapsedSeconds;
      varying float vWaterDepth;
      varying vec3 vWorldPosition;
      #include <fog_pars_vertex>
      void main() {
        vec3 displaced = position;
        float firstWave = sin(position.z * 0.075 - elapsedSeconds * 1.15 + position.x * 0.035);
        float crossWave = sin(position.x * 0.19 + elapsedSeconds * 0.72 + position.z * 0.025);
        float rawDisplacement = firstWave * 0.05 + crossWave * 0.025;
        float maximumDisplacement = min(0.075, waterDepth * 0.45);
        displaced.y += clamp(rawDisplacement, -maximumDisplacement, maximumDisplacement);
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
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
      varying float vWaterDepth;
      varying vec3 vWorldPosition;
      #include <common>
      #include <fog_pars_fragment>
      float waterHash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float waterNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        return mix(
          mix(waterHash(cell), waterHash(cell + vec2(1.0, 0.0)), local.x),
          mix(waterHash(cell + vec2(0.0, 1.0)), waterHash(cell + vec2(1.0, 1.0)), local.x),
          local.y
        );
      }
      void main() {
        float depthMix = smoothstep(0.25, 6.0, vWaterDepth);
        vec2 waterPosition = vWorldPosition.xz;
        float broadWash = waterNoise(waterPosition * 0.012 + vec2(elapsedSeconds * 0.008, 0.0));
        broadWash = mix(broadWash, waterNoise(waterPosition * 0.005 - vec2(0.0, elapsedSeconds * 0.004)), 0.42);
        vec3 paintedBlue = mix(shallowColor * 0.88, shallowColor * 1.12, smoothstep(0.12, 0.88, broadWash));
        vec3 color = mix(paintedBlue, deepColor, depthMix * 0.9);
        vec3 ambientFactor = vec3(0.55) + ambientLightColor * 0.45;
        color *= ambientFactor;
        vec3 paintedNormal = normalize(vec3(-cos(vWorldPosition.x * 0.035) * 0.1, 1.0, -cos(vWorldPosition.z * 0.027) * 0.08));
        float keyWash = max(dot(paintedNormal, keyLightDirection), 0.0);
        color += keyLightColor * keyLightIntensity * (0.012 + keyWash * 0.025);
        float domainWarp = (waterNoise(waterPosition * 0.018 + vec2(4.7, elapsedSeconds * 0.015)) - 0.5) * 13.0;
        float ribbonPhase = (vWorldPosition.x + domainWarp) * 0.115
          + sin(vWorldPosition.z * 0.016 + elapsedSeconds * 0.12) * 0.7;
        float ribbon = 1.0 - smoothstep(0.035, 0.16, abs(sin(ribbonPhase)));
        float breakup = waterNoise(vec2(vWorldPosition.z * 0.052 - elapsedSeconds * 0.09,
          vWorldPosition.x * 0.016 + waterNoise(waterPosition * 0.009) * 2.0));
        float dash = smoothstep(0.58, 0.78, breakup);
        float distanceFade = 1.0 - smoothstep(90.0, 280.0, distance(cameraPosition, vWorldPosition));
        float shorelineBreakup = mix(0.32, 0.78, waterNoise(waterPosition * 0.075 + vec2(2.3, 7.1)));
        float shoreline = (1.0 - smoothstep(0.02, 1.25, vWaterDepth)) * shorelineBreakup;
        float channelStroke = ribbon * dash * distanceFade * smoothstep(0.35, 1.3, vWaterDepth)
          * (1.0 - smoothstep(5.8, 7.5, vWaterDepth));
        float foam = max(shoreline * 0.42, channelStroke * 0.68);
        vec3 litFoamColor = foamColor * ambientFactor + keyLightColor * keyLightIntensity * 0.035;
        color = mix(color, litFoamColor, foam * 0.72);
        color += keyLightColor * keyLightIntensity * channelStroke * 0.018;
        float alpha = mix(0.52, 0.82, depthMix) + foam * 0.1;
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
