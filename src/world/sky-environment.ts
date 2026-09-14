import * as THREE from 'three'

export const SKY_TEXTURE_PATH = 'textures/sky/ashveil-sky-day-v2.png'

export interface SkyState {
  readonly hour: number
  readonly sunDirection: THREE.Vector3
  readonly moonDirection: THREE.Vector3
  readonly sunIntensity: number
  readonly moonIntensity: number
  readonly hemisphereIntensity: number
  readonly daylight: number
  readonly twilight: number
  readonly starOpacity: number
  readonly fogColor: THREE.Color
  readonly sunColor: THREE.Color
  readonly moonColor: THREE.Color
  readonly hemisphereSkyColor: THREE.Color
  readonly hemisphereGroundColor: THREE.Color
}

interface TextureLoaderLike {
  loadAsync(url: string): Promise<THREE.Texture>
}

export class SkyTextureSource {
  private pending: Promise<THREE.Texture> | undefined

  constructor(
    private readonly loader: TextureLoaderLike = new THREE.TextureLoader(),
    private readonly baseUrl: string = import.meta.env.BASE_URL,
  ) {}

  load(): Promise<THREE.Texture> {
    if (this.pending) return this.pending
    this.pending = this.loader.loadAsync(`${this.baseUrl}${SKY_TEXTURE_PATH}`)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        return texture
      })
      .catch((cause: unknown) => {
        throw new Error('Could not load the Alderbank sky.', { cause })
      })
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}

const sharedSkySource = new SkyTextureSource()
export function loadSkyTexture(): Promise<THREE.Texture> { return sharedSkySource.load() }

export interface BuiltSkyEnvironment {
  readonly sun: THREE.DirectionalLight
  readonly moon: THREE.DirectionalLight
  readonly hemisphere: THREE.HemisphereLight
  update(state: SkyState, cameraPosition: THREE.Vector3, explorer: { readonly x: number; readonly y: number; readonly z: number }): void
  setFogDensity(density: number): void
  setSunShadows(enabled: boolean): void
  dispose(): void
}

const LIGHT_DISTANCE = 100
const SKY_RADIUS = 320
const SHADOW_RADIUS = 42
const NIGHT_FOG = new THREE.Color(0x354863)
const DAY_FOG = new THREE.Color(0xb7cbd2)
const TWILIGHT_FOG = new THREE.Color(0xb57d73)
const CLOUD_CHROMA_WEIGHT = 0.35
const CLOUD_COVERAGE_START = 0.04
const CLOUD_COVERAGE_END = 0.38
const CLOUD_HORIZON_FADE_END = 0.18

const PANORAMA_SAMPLE_GLSL = `
  vec2 panoramaUv(vec3 direction) {
    return vec2(fract(atan(direction.z, direction.x) / (2.0 * PI) + 0.5), asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5);
  }
  vec3 linearPanoramaSample(vec3 direction) {
    vec2 uv = panoramaUv(normalize(direction));
    uv.y = clamp(uv.y, 0.025, 0.975);
    vec3 painted = texture2D(skyMap, uv).rgb;
    float seamDistance = min(uv.x, 1.0 - uv.x);
    vec3 seam = 0.5 * (texture2D(skyMap, vec2(0.003, uv.y)).rgb + texture2D(skyMap, vec2(0.997, uv.y)).rgb);
    return mix(seam, painted, smoothstep(0.0, 0.004, seamDistance));
  }
`

const CLOUD_COVERAGE_GLSL = `
  float panoramaCloudCoverage(vec3 painted, float elevation) {
    float highChannel = max(painted.r, max(painted.g, painted.b));
    float lowChannel = min(painted.r, min(painted.g, painted.b));
    float chroma = highChannel - lowChannel;
    float luminance = dot(painted, vec3(0.2126, 0.7152, 0.0722));
    float cloudSignal = luminance - chroma * ${CLOUD_CHROMA_WEIGHT.toFixed(2)};
    float coverage = smoothstep(${CLOUD_COVERAGE_START.toFixed(2)}, ${CLOUD_COVERAGE_END.toFixed(2)}, cloudSignal);
    return coverage * smoothstep(0.02, ${CLOUD_HORIZON_FADE_END.toFixed(2)}, elevation);
  }
`

export function cloudCoverageFromLinearRgb(red: number, green: number, blue: number, elevation = 1): number {
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
  const coverage = smoothstep(CLOUD_COVERAGE_START, CLOUD_COVERAGE_END, luminance - chroma * CLOUD_CHROMA_WEIGHT)
  return coverage * smoothstep(0.02, CLOUD_HORIZON_FADE_END, elevation)
}

export function sampleSkyState(hour: number): SkyState {
  const wrapped = wrappedHour(hour)
  const angle = (wrapped - 6) / 24 * Math.PI * 2
  const sunDirection = new THREE.Vector3(-Math.cos(angle) * 0.74, Math.sin(angle), Math.cos(angle) * 0.67).normalize()
  const moonDirection = sunDirection.clone().negate()
  const daylight = smoothstep(-0.35, 0.45, sunDirection.y)
  const sunlight = smoothstep(0, 0.22, sunDirection.y)
  const moonlight = smoothstep(0.02, 0.3, moonDirection.y)
  const twilight = Math.exp(-Math.abs(sunDirection.y) * 4) * (1 - daylight * 0.35)
  const fogColor = NIGHT_FOG.clone().lerp(DAY_FOG, daylight).lerp(TWILIGHT_FOG, twilight * 0.34)
  const sunColor = new THREE.Color(0xffe2ae).lerp(new THREE.Color(0xffa878), twilight * 0.55)
  return {
    hour: wrapped,
    sunDirection,
    moonDirection,
    sunIntensity: sunlight * (2.15 + Math.max(0, sunDirection.y) * 0.65),
    moonIntensity: moonlight * 1.1,
    hemisphereIntensity: 1.5 + daylight * 0.05,
    daylight,
    twilight,
    starOpacity: 1 - smoothstep(-0.2, 0.08, sunDirection.y),
    fogColor,
    sunColor,
    moonColor: new THREE.Color(0xb8ceff),
    hemisphereSkyColor: new THREE.Color(0xdbe8ff).lerp(new THREE.Color(0xf5e8c9), daylight),
    hemisphereGroundColor: new THREE.Color(0xbac7dc).lerp(new THREE.Color(0x4b5042), daylight),
  }
}

export function buildSkyEnvironment(
  scene: THREE.Scene,
  texture: THREE.Texture,
  fogDensity: number,
): BuiltSkyEnvironment {
  texture.colorSpace = THREE.SRGBColorSpace
  const fog = new THREE.FogExp2(NIGHT_FOG, fogDensity)
  scene.fog = fog
  scene.background = null

  const root = new THREE.Group()
  root.name = 'sky-environment'
  const skyMaterial = createSkyMaterial(texture)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), skyMaterial)
  sky.name = 'painterly-sky'
  sky.frustumCulled = false
  sky.renderOrder = -100
  root.add(sky)

  const stars = createStars(texture)
  root.add(stars)
  const sunDisc = createDisc('sun-disc', 0xffe5b7, 11, texture)
  const moonDisc = createDisc('moon-disc', 0xc9dcff, 9.5, texture)
  root.add(sunDisc, moonDisc)

  const hemisphere = new THREE.HemisphereLight(0xe7e9ff, 0x364253, 0.9)
  hemisphere.name = 'sky-hemisphere-light'
  const sun = new THREE.DirectionalLight(0xffe5b7, 0)
  sun.name = 'sky-sun-light'
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_RADIUS, right: SHADOW_RADIUS, top: SHADOW_RADIUS, bottom: -SHADOW_RADIUS, near: 1, far: 160,
  })
  sun.shadow.camera.updateProjectionMatrix()
  const moon = new THREE.DirectionalLight(0xb8ceff, 0)
  moon.name = 'sky-moon-light'
  moon.castShadow = false
  const sunTarget = new THREE.Object3D()
  const moonTarget = new THREE.Object3D()
  sun.target = sunTarget
  moon.target = moonTarget
  scene.add(root, hemisphere, sun, moon, sunTarget, moonTarget)

  let shadowsEnabled = true
  return {
    sun,
    moon,
    hemisphere,
    update: (state, cameraPosition, explorer) => {
      root.position.copy(cameraPosition)
      fog.color.copy(state.fogColor)
      skyMaterial.uniforms.daylight!.value = state.daylight
      skyMaterial.uniforms.twilight!.value = state.twilight
      skyMaterial.uniforms.fogColor!.value.copy(state.fogColor)
      const starMaterial = stars.material as THREE.ShaderMaterial
      starMaterial.uniforms.opacity!.value = state.starOpacity
      sun.color.copy(state.sunColor)
      sun.intensity = state.sunIntensity
      moon.color.copy(state.moonColor)
      moon.intensity = state.moonIntensity
      hemisphere.intensity = state.hemisphereIntensity
      hemisphere.color.copy(state.hemisphereSkyColor)
      hemisphere.groundColor.copy(state.hemisphereGroundColor)
      updateDirectionalLight(sun, sunTarget, state.sunDirection, explorer)
      updateDirectionalLight(moon, moonTarget, state.moonDirection, explorer)
      updateDisc(sunDisc, state.sunDirection, state.sunIntensity / 2.8)
      updateDisc(moonDisc, state.moonDirection, state.moonIntensity / 1.1)
      sun.castShadow = shadowsEnabled
    },
    setFogDensity: (density) => { fog.density = density },
    setSunShadows: (enabled) => { shadowsEnabled = enabled; sun.castShadow = enabled },
    dispose: () => {
      scene.remove(root, hemisphere, sun, moon, sunTarget, moonTarget)
      if (scene.fog === fog) scene.fog = null
      sky.geometry.dispose()
      skyMaterial.dispose()
      stars.geometry.dispose()
      stars.material.dispose()
      sunDisc.geometry.dispose()
      sunDisc.material.dispose()
      moonDisc.geometry.dispose()
      moonDisc.material.dispose()
      texture.dispose()
      sun.dispose()
      moon.dispose()
    },
  }
}

function createSkyMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'ashveil-painterly-sky',
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: true,
    uniforms: {
      skyMap: { value: texture },
      daylight: { value: 1 },
      twilight: { value: 0 },
      fogColor: { value: NIGHT_FOG.clone() },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D skyMap;
      uniform float daylight;
      uniform float twilight;
      uniform vec3 fogColor;
      varying vec3 vSkyDirection;
      #include <common>
      ${PANORAMA_SAMPLE_GLSL}
      void main() {
        vec3 direction = normalize(vSkyDirection);
        vec3 painted = linearPanoramaSample(direction);
        float zenithBlend = smoothstep(0.86, 0.98, direction.y);
        vec3 zenith = 0.25 * (texture2D(skyMap, vec2(0.125, 0.965)).rgb + texture2D(skyMap, vec2(0.375, 0.965)).rgb + texture2D(skyMap, vec2(0.625, 0.965)).rgb + texture2D(skyMap, vec2(0.875, 0.965)).rgb);
        painted = mix(painted, zenith, zenithBlend);
        vec3 night = painted * vec3(0.055, 0.1, 0.22) + fogColor * 0.28;
        vec3 color = mix(night, painted, daylight);
        color = mix(color, color * vec3(1.12, 0.77, 0.67), twilight * 0.25);
        color = mix(fogColor, color, smoothstep(-0.04, 0.13, direction.y));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

function createStars(texture: THREE.Texture): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const positions = new Float32Array(220 * 3)
  let seed = 0x9e3779b9
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return seed / 0x1_0000_0000
  }
  for (let index = 0; index < positions.length; index += 3) {
    const y = 0.06 + random() * 0.94
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(1 - y * y) * (SKY_RADIUS - 3)
    positions.set([Math.cos(angle) * radius, y * (SKY_RADIUS - 3), Math.sin(angle) * radius], index)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.ShaderMaterial({
    name: 'ashveil-night-stars',
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
    uniforms: { skyMap: { value: texture }, opacity: { value: 0 } },
    vertexShader: `
      varying vec3 vStarDirection;
      void main() {
        vStarDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
        gl_PointSize = 1.5;
      }
    `,
    fragmentShader: `
      uniform sampler2D skyMap;
      uniform float opacity;
      varying vec3 vStarDirection;
      #include <common>
      ${PANORAMA_SAMPLE_GLSL}
      ${CLOUD_COVERAGE_GLSL}
      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float shape = 1.0 - smoothstep(0.1, 0.5, length(point));
        vec3 direction = normalize(vStarDirection);
        float cloudCoverage = panoramaCloudCoverage(linearPanoramaSample(direction), direction.y);
        gl_FragColor = vec4(vec3(0.72, 0.82, 1.0), shape * opacity * (1.0 - cloudCoverage));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const stars = new THREE.Points(geometry, material)
  stars.name = 'night-stars'
  stars.frustumCulled = false
  stars.renderOrder = -90
  return stars
}

function createDisc(
  name: string,
  color: THREE.ColorRepresentation,
  radius: number,
  texture: THREE.Texture,
): THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: true,
      uniforms: { skyMap: { value: texture }, discColor: { value: new THREE.Color(color) }, opacity: { value: 0 } },
      vertexShader: `
        varying vec2 vDiscUv;
        varying vec3 vSkyDirection;
        void main() {
          vDiscUv = uv;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vSkyDirection = normalize(worldPosition.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
          gl_Position.z = gl_Position.w;
        }
      `,
      fragmentShader: `
        uniform sampler2D skyMap;
        uniform vec3 discColor;
        uniform float opacity;
        varying vec2 vDiscUv;
        varying vec3 vSkyDirection;
        #include <common>
        ${PANORAMA_SAMPLE_GLSL}
        ${CLOUD_COVERAGE_GLSL}
        void main() {
          float softEdge = 1.0 - smoothstep(0.38, 0.5, length(vDiscUv - 0.5));
          float cloudCoverage = panoramaCloudCoverage(linearPanoramaSample(vSkyDirection), vSkyDirection.y);
          gl_FragColor = vec4(discColor, opacity * softEdge * (1.0 - cloudCoverage));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  )
  disc.name = name
  disc.frustumCulled = false
  disc.renderOrder = -80
  return disc
}

const DISC_NORMAL = new THREE.Vector3(0, 0, 1)
const DISC_FACING = new THREE.Vector3()
function updateDisc(
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>,
  direction: THREE.Vector3,
  opacity: number,
): void {
  disc.visible = direction.y > 0 && opacity > 0.001
  disc.position.copy(direction).multiplyScalar(SKY_RADIUS - 5)
  disc.quaternion.setFromUnitVectors(DISC_NORMAL, DISC_FACING.copy(direction).negate())
  disc.material.uniforms.opacity!.value = smoothstep(0, 0.12, direction.y) * THREE.MathUtils.clamp(opacity, 0, 1)
}

function updateDirectionalLight(
  light: THREE.DirectionalLight,
  target: THREE.Object3D,
  direction: THREE.Vector3,
  explorer: { readonly x: number; readonly y: number; readonly z: number },
): void {
  target.position.set(explorer.x, explorer.y, explorer.z)
  light.position.copy(target.position).addScaledVector(direction, LIGHT_DISTANCE)
  target.updateMatrixWorld()
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const phase = THREE.MathUtils.clamp((value - minimum) / (maximum - minimum), 0, 1)
  return phase * phase * (3 - 2 * phase)
}

function wrappedHour(hour: number): number {
  if (!Number.isFinite(hour)) throw new Error('Sky hour must be finite.')
  return ((hour % 24) + 24) % 24
}
