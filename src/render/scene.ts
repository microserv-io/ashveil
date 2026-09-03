import * as THREE from 'three'
import type { AreaMap, Vec2 } from '../sim/types'
import { LOOK } from './look'
import { spawnModel } from './models'
import { PALETTE } from './palette'
import { buildTerrain as buildTerrainGeometry } from './terrain'

const CAMERA_OFFSET = new THREE.Vector3(0, 19, 14.5)

/** Where a world point landed on screen. Callers own the object so projecting allocates nothing. */
export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

export class SceneHost {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  private terrain: THREE.Group | null = null
  private readonly cameraTarget = new THREE.Vector3()
  private readonly cameraDesired = new THREE.Vector3()
  private readonly projected = new THREE.Vector3()
  /**
   * Cached rather than read from the canvas. `clientWidth` forces a synchronous
   * layout, and the overlay projects once per label per frame in between writing
   * their transforms: reading it here made every frame a layout thrash.
   */
  private viewportWidth = 1
  private viewportHeight = 1
  /**
   * Lives on the scene rather than on the terrain it belongs to. Rebuilding an area
   * would otherwise change the scene's light count, and three.js recompiles every
   * shader when that happens — see `lights.ts`.
   */
  private readonly portalGlow = new THREE.PointLight(PALETTE.portal, 6, 12, 2)

  constructor(canvasParent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    // The painterly look wants the authored colours back untouched.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
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
    this.scene.add(this.portalGlow)
    this.resize()
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(LOOK.skyLight, LOOK.groundLight, LOOK.fillIntensity))

    const key = new THREE.DirectionalLight(LOOK.keyColour, LOOK.keyIntensity)
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
    key.shadow.intensity = LOOK.shadowIntensity
    this.scene.add(key)
    this.scene.add(key.target)
    this.keyLight = key

    const rim = new THREE.DirectionalLight(LOOK.rimColour, LOOK.rimIntensity)
    rim.position.set(-14, 10, -12)
    this.scene.add(rim)
  }

  private keyLight!: THREE.DirectionalLight

  /**
   * Rebuilds terrain for a new area. `terrain.ts` owns the geometry; this owns the
   * scene graph it hangs from.
   */
  buildTerrain(map: AreaMap): void {
    if (this.terrain) {
      this.scene.remove(this.terrain)
      disposeGroup(this.terrain)
    }

    const group = buildTerrainGeometry(map)
    group.add(buildPortal(map.portal))
    this.portalGlow.position.set(map.portal.x, 1.4, map.portal.y)
    this.terrain = group
    this.scene.add(group)
  }

  followPlayer(position: Vec2, delta: number): void {
    this.cameraTarget.set(position.x, 0, position.y)
    this.cameraDesired.copy(this.cameraTarget).add(CAMERA_OFFSET)
    // Critically damped follow: keeps up without the camera feeling welded on.
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-9 * delta))
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

  /** Writes into `out` so the overlay can project every label without allocating. */
  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    const projected = this.projected.set(x, y, z).project(this.camera)
    out.x = (projected.x * 0.5 + 0.5) * this.viewportWidth
    out.y = (-projected.y * 0.5 + 0.5) * this.viewportHeight
    out.visible = projected.z < 1
    return out
  }

  resize(): void {
    const width = globalThis.innerWidth
    const height = globalThis.innerHeight
    this.viewportWidth = width
    this.viewportHeight = height
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}

function buildPortal(position: Vec2): THREE.Group {
  const group = new THREE.Group()
  group.position.set(position.x, 0, position.y)

  const stairs = spawnModel('portal')
  stairs.scale.setScalar(0.4)
  group.add(stairs)

  // The stairs alone read as scenery; the ring is what says "this is the way out".
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.14, 12, 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.portal, emissive: PALETTE.portal, emissiveIntensity: 1.5, roughness: 0.4 }),
  )
  ring.position.y = 1.3
  ring.name = 'portal-ring'
  group.add(ring)

  return group
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
