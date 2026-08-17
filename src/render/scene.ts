import * as THREE from 'three'
import { isFloor } from '../sim/mapgen'
import type { AreaMap, Vec2 } from '../sim/types'
import { PALETTE } from './palette'

const WALL_HEIGHT = 2.1
const CAMERA_OFFSET = new THREE.Vector3(0, 19, 14.5)

export class SceneHost {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  private terrain: THREE.Group | null = null
  private readonly cameraTarget = new THREE.Vector3()

  constructor(canvasParent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    canvasParent.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(PALETTE.background)
    this.scene.fog = new THREE.Fog(PALETTE.fog, 30, 62)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220)
    this.camera.position.copy(CAMERA_OFFSET)

    this.addLights()
    this.resize()
  }

  private addLights(): void {
    this.scene.add(new THREE.AmbientLight(0x404a5c, 1.1))

    const key = new THREE.DirectionalLight(0xffe6c4, 1.5)
    key.position.set(12, 26, 8)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 80
    const extent = 26
    key.shadow.camera.left = -extent
    key.shadow.camera.right = extent
    key.shadow.camera.top = extent
    key.shadow.camera.bottom = -extent
    key.shadow.bias = -0.0016
    this.scene.add(key)
    this.scene.add(key.target)
    this.keyLight = key

    const rim = new THREE.DirectionalLight(0x4a6cff, 0.35)
    rim.position.set(-14, 10, -12)
    this.scene.add(rim)
  }

  private keyLight!: THREE.DirectionalLight

  /**
   * Rebuilds terrain for a new area. Floor and walls are instanced: a full area is
   * a few thousand tiles, and one draw call each keeps the frame budget for effects.
   */
  buildTerrain(map: AreaMap): void {
    if (this.terrain) {
      this.scene.remove(this.terrain)
      disposeGroup(this.terrain)
    }

    const group = new THREE.Group()
    const floorTiles: { x: number; y: number }[] = []
    const wallTiles: { x: number; y: number }[] = []

    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (isFloor(map, tx, ty)) {
          floorTiles.push({ x: tx, y: ty })
        } else if (touchesFloor(map, tx, ty)) {
          wallTiles.push({ x: tx, y: ty })
        }
      }
    }

    group.add(this.buildFloor(floorTiles))
    group.add(this.buildWalls(wallTiles))
    group.add(buildPortal(map.portal))

    this.terrain = group
    this.scene.add(group)
  }

  private buildFloor(tiles: readonly { x: number; y: number }[]): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 0.2, 1)
    const material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02 })
    const mesh = new THREE.InstancedMesh(geometry, material, tiles.length)
    mesh.receiveShadow = true

    const matrix = new THREE.Matrix4()
    const low = new THREE.Color(PALETTE.floorLow)
    const high = new THREE.Color(PALETTE.floorHigh)
    const colour = new THREE.Color()

    tiles.forEach((tile, index) => {
      matrix.setPosition(tile.x + 0.5, -0.1, tile.y + 0.5)
      mesh.setMatrixAt(index, matrix)
      // Deterministic per-tile variation so the floor is not a flat sheet.
      const noise = hash2(tile.x, tile.y)
      colour.copy(low).lerp(high, noise)
      mesh.setColorAt(index, colour)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return mesh
  }

  private buildWalls(tiles: readonly { x: number; y: number }[]): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, WALL_HEIGHT, 1)
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 })
    const mesh = new THREE.InstancedMesh(geometry, material, tiles.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const matrix = new THREE.Matrix4()
    const base = new THREE.Color(PALETTE.wall)
    const top = new THREE.Color(PALETTE.wallTop)
    const colour = new THREE.Color()

    tiles.forEach((tile, index) => {
      const jitter = hash2(tile.x, tile.y)
      matrix.setPosition(tile.x + 0.5, WALL_HEIGHT / 2 - jitter * 0.25, tile.y + 0.5)
      mesh.setMatrixAt(index, matrix)
      colour.copy(base).lerp(top, jitter)
      mesh.setColorAt(index, colour)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return mesh
  }

  followPlayer(position: Vec2, delta: number): void {
    this.cameraTarget.set(position.x, 0, position.y)
    const desired = this.cameraTarget.clone().add(CAMERA_OFFSET)
    // Critically damped follow: keeps up without the camera feeling welded on.
    this.camera.position.lerp(desired, 1 - Math.exp(-9 * delta))
    this.camera.lookAt(this.cameraTarget)

    this.keyLight.position.set(position.x + 12, 26, position.y + 8)
    this.keyLight.target.position.copy(this.cameraTarget)
    this.keyLight.target.updateMatrixWorld()
  }

  /** Where the cursor meets the ground, in sim coordinates. */
  pointerToGround(ndcX: number, ndcY: number): Vec2 | null {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const point = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(this.groundPlane, point)) return null
    return { x: point.x, y: point.z }
  }

  project(position: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const projected = position.clone().project(this.camera)
    return {
      x: (projected.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight,
      visible: projected.z < 1,
    }
  }

  resize(): void {
    const width = globalThis.innerWidth
    const height = globalThis.innerHeight
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}

function touchesFloor(map: AreaMap, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isFloor(map, tx + dx, ty + dy)) return true
    }
  }
  return false
}

function buildPortal(position: Vec2): THREE.Group {
  const group = new THREE.Group()
  group.position.set(position.x, 0, position.y)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.14, 12, 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.portal, emissive: PALETTE.portal, emissiveIntensity: 1.5, roughness: 0.4 }),
  )
  ring.position.y = 1.3
  ring.name = 'portal-ring'
  group.add(ring)

  const glow = new THREE.PointLight(PALETTE.portal, 6, 12, 2)
  glow.position.y = 1.4
  group.add(glow)

  return group
}

/** Stable 0..1 value per tile, so terrain looks the same on every replay. */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else if (material) material.dispose()
  })
}
