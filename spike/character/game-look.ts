import * as THREE from 'three'

export type LookMode = 'diagnostic' | 'game'

export const GAME_LOOK_TEXTURE_URL = new URL(
  './assets/ashveil-cream-stone-v2.webp',
  import.meta.url,
).href
export const GAME_LOOK_GROUND_SIZE = 40
export const GAME_LOOK_REVEAL_RADIUS = { start: 3, end: 4.8 } as const

const GAME_BACKGROUND = 0xaeb8ae
const GAME_FOG = 0xb8bbb2
const GAME_FOG_NEAR = 28
const GAME_FOG_FAR = 55
const ASH_GREY = new THREE.Color(0xb8bbb2)
const UNDERSUIT_TEAL = 0x244d4c
const WARM_SKIN = 0xa66f55
const EYE_TEAL = 0x64c4b2
const SAFFRON = 0xe9ad42

interface MaterialAssignment {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
  game: THREE.Material | THREE.Material[]
}

export interface GameLookOwnerOptions {
  scene: THREE.Scene
  diagnosticGround: THREE.Object3D
  characterMeshes: readonly THREE.Mesh[]
  floorTexture: THREE.Texture
}

export function nextLookMode(mode: LookMode): LookMode {
  return mode === 'diagnostic' ? 'game' : 'diagnostic'
}

export class GameLookOwner {
  readonly environment: THREE.Group
  private readonly scene: THREE.Scene
  private readonly diagnosticGround: THREE.Object3D
  private readonly originalBackground: THREE.Scene['background']
  private readonly originalFog: THREE.Scene['fog']
  private readonly assignments: MaterialAssignment[]
  private readonly gameMaterials = new Set<THREE.Material>()
  private currentMode: LookMode = 'diagnostic'

  constructor(options: GameLookOwnerOptions) {
    this.scene = options.scene
    this.diagnosticGround = options.diagnosticGround
    this.originalBackground = options.scene.background
    this.originalFog = options.scene.fog
    this.assignments = options.characterMeshes.map((mesh) => this.createAssignment(mesh))
    this.environment = createEnvironment(options.floorTexture)
    this.environment.visible = false
    this.scene.add(this.environment)
  }

  get mode(): LookMode {
    return this.currentMode
  }

  setMode(mode: LookMode): void {
    if (mode === this.currentMode) return
    this.currentMode = mode
    const game = mode === 'game'
    this.environment.visible = game
    this.diagnosticGround.visible = !game
    this.scene.background = game ? new THREE.Color(GAME_BACKGROUND) : this.originalBackground
    this.scene.fog = game ? new THREE.Fog(GAME_FOG, GAME_FOG_NEAR, GAME_FOG_FAR) : this.originalFog
    for (const assignment of this.assignments) {
      assignment.mesh.material = game ? assignment.game : assignment.original
    }
  }

  setWireframe(visible: boolean): void {
    for (const material of this.gameMaterials) {
      if (!('wireframe' in material)) continue
      ;(material as THREE.MeshStandardMaterial).wireframe = visible
      material.needsUpdate = true
    }
  }

  dispose(): void {
    this.setMode('diagnostic')
    this.scene.remove(this.environment)
    disposeEnvironment(this.environment)
    for (const material of this.gameMaterials) material.dispose()
    this.gameMaterials.clear()
  }

  private createAssignment(mesh: THREE.Mesh): MaterialAssignment {
    const original = mesh.material
    const materials = Array.isArray(original) ? original : [original]
    const gameMaterials = materials.map((material) => {
      const cloned = material.clone()
      applyCharacterPalette(cloned, mesh.name)
      this.gameMaterials.add(cloned)
      return cloned
    })
    return { mesh, original, game: Array.isArray(original) ? gameMaterials : gameMaterials[0]! }
  }
}

function applyCharacterPalette(material: THREE.Material, meshName: string): void {
  if (!('color' in material) || !((material as THREE.MeshStandardMaterial).color instanceof THREE.Color)) return
  const standard = material as THREE.MeshStandardMaterial
  standard.color.set(
    meshName.startsWith('Eye_')
      ? EYE_TEAL
      : meshName.startsWith('Facial_Feature_')
        ? SAFFRON
        : meshName === 'Body'
          ? UNDERSUIT_TEAL
          : WARM_SKIN,
  )
  if ('metalness' in standard) standard.metalness = 0
  if ('roughness' in standard) standard.roughness = meshName === 'Body' ? 0.82 : 0.72
  standard.needsUpdate = true
}

function createEnvironment(floorTexture: THREE.Texture): THREE.Group {
  floorTexture.wrapS = THREE.MirroredRepeatWrapping
  floorTexture.wrapT = THREE.MirroredRepeatWrapping
  floorTexture.repeat.set(8.5, 8.5)
  floorTexture.colorSpace = THREE.SRGBColorSpace
  floorTexture.needsUpdate = true

  const environment = new THREE.Group()
  environment.name = 'Game_Look_Environment'

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GAME_LOOK_GROUND_SIZE, GAME_LOOK_GROUND_SIZE),
    new THREE.MeshStandardMaterial({ map: floorTexture, color: 0xfff0c9, roughness: 0.94, metalness: 0 }),
  )
  ground.name = 'Game_Look_Cream_Stone'
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.004
  ground.receiveShadow = true

  const ashBoundary = new THREE.Mesh(
    new THREE.PlaneGeometry(GAME_LOOK_GROUND_SIZE, GAME_LOOK_GROUND_SIZE),
    ashBoundaryMaterial(),
  )
  ashBoundary.name = 'Game_Look_Ash_Boundary'
  ashBoundary.rotation.x = -Math.PI / 2
  ashBoundary.position.y = 0.003

  environment.add(ground, ashBoundary, createTealStones(), createSaffronShards(), createAshParticles())
  return environment
}

function ashBoundaryMaterial(): THREE.ShaderMaterial {
  const radiusScale = GAME_LOOK_GROUND_SIZE / 2
  const revealStart = GAME_LOOK_REVEAL_RADIUS.start / radiusScale
  const revealEnd = GAME_LOOK_REVEAL_RADIUS.end / radiusScale
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ashColor: { value: ASH_GREY } },
    vertexShader: `
      varying vec2 lookUv;
      void main() {
        lookUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 ashColor;
      varying vec2 lookUv;
      void main() {
        float radius = length((lookUv - 0.5) * 2.0);
        float opacity = smoothstep(${revealStart.toFixed(6)}, ${revealEnd.toFixed(6)}, radius) * 0.86;
        gl_FragColor = vec4(ashColor, opacity);
      }
    `,
  })
}

function createTealStones(): THREE.InstancedMesh {
  const placements = [
    [-2.7, 0.12, -1.7, 0.8],
    [2.45, 0.09, -2.1, 0.62],
    [-1.9, 0.08, 2.4, 0.55],
    [2.9, 0.11, 1.4, 0.72],
    [-3.3, 0.07, 0.65, 0.48],
  ] as const
  const stones = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.34, 0),
    new THREE.MeshStandardMaterial({ color: 0x6eaaa0, roughness: 0.8, metalness: 0 }),
    placements.length,
  )
  const matrix = new THREE.Matrix4()
  placements.forEach(([x, y, z, scale], index) => {
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 0.83),
      new THREE.Vector3(scale * 1.4, scale * 0.65, scale),
    )
    stones.setMatrixAt(index, matrix)
  })
  stones.name = 'Game_Look_Teal_Stones'
  stones.castShadow = true
  stones.receiveShadow = true
  return stones
}

function createSaffronShards(): THREE.InstancedMesh {
  const placements = [
    [-2.1, 0.13, -2.45],
    [2.15, 0.13, 2.2],
    [3.05, 0.13, -0.4],
  ] as const
  const shards = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.11, 0.34, 5),
    new THREE.MeshStandardMaterial({ color: SAFFRON, roughness: 0.66, metalness: 0.05 }),
    placements.length,
  )
  const matrix = new THREE.Matrix4()
  placements.forEach(([x, y, z], index) => {
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.1),
      new THREE.Vector3(1, 1, 1),
    )
    shards.setMatrixAt(index, matrix)
  })
  shards.name = 'Game_Look_Saffron_Shards'
  shards.castShadow = true
  return shards
}

function createAshParticles(): THREE.Points {
  const count = 72
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2
    const wave = Math.sin(index * 2.17)
    const radius = 3.25 + 0.45 * wave
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = 0.08 + ((index * 17) % 19) * 0.028
    positions[index * 3 + 2] = Math.sin(angle) * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const particles = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xd3d1c8, size: 0.055, transparent: true, opacity: 0.62 }),
  )
  particles.name = 'Game_Look_Ash_Particles'
  return particles
}

function disposeEnvironment(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Points)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose()
      material.dispose()
    }
  })
}
