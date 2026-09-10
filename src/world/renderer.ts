import * as THREE from 'three'
import { ApprovedWorldCharacter, type ApprovedCharacterTemplate } from './approved-character'
import { buildScenery, type BuiltScenery } from './scenery'
import type { SceneryKit } from './scenery-kit'
import { createTerrainGeometryData, heightAt, riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from './terrain'
import { LANDMARKS, PATHS, SOLIDS, type WorldPoint } from './world-data'
import type { Explorer } from './movement'
import { createWorldMaterial } from './world-material'
import { WolfView } from './wolf'
import type { WanderingWolfState } from './wandering-wolf'
import type { WolfTemplate } from './wolf-source'

function buildTerrain(): THREE.Mesh {
  const data = createTerrainGeometryData()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]), 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors.flat(), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.vertices.flatMap((vertex) => [vertex.x / 2, vertex.z / 2]), 2))
  geometry.setAttribute('paintUv', new THREE.Float32BufferAttribute(data.vertices.flatMap((vertex) => [
    (vertex.x - WORLD_BOUNDS.minX) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX),
    (vertex.z - WORLD_BOUNDS.minZ) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ),
  ]), 2))
  geometry.setIndex([...data.indices])
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, createWorldMaterial(PATHS))
}

function buildRiver(): THREE.Mesh {
  const positions: number[] = []
  const indices: number[] = []
  for (let z = -90, row = 0; z <= 90; z += 5, row += 1) {
    const center = riverCenterAt(z)
    const half = riverHalfWidthAt(z) - 0.35
    positions.push(center - half, -0.55, z, center + half, -0.55, z)
    if (row > 0) {
      const start = row * 2
      indices.push(start - 2, start, start - 1, start, start + 1, start - 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: 0x5b8490, roughness: 0.28, metalness: 0.04, transparent: true, opacity: 0.84 }))
}

export const DEFAULT_CAMERA_YAW = 0.45

export class WorldView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600)
  private readonly terrain = buildTerrain()
  private readonly scenery: BuiltScenery
  private readonly explorer: ApprovedWorldCharacter
  private readonly wolf: WolfView
  private readonly raycaster = new THREE.Raycaster()
  private readonly cameraTarget = new THREE.Vector3()
  private yaw = DEFAULT_CAMERA_YAW
  private pitch = 0.42
  private distance = 11.5
  private overview = false

  constructor(
    host: HTMLElement,
    kit: SceneryKit,
    character: ApprovedCharacterTemplate,
    initialExplorer: Explorer,
    wolfTemplate: WolfTemplate,
    initialWolf: WanderingWolfState,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.96
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.prepend(this.renderer.domElement)
    this.explorer = new ApprovedWorldCharacter(character, initialExplorer)
    this.wolf = new WolfView(wolfTemplate, initialWolf)
    this.scene.background = new THREE.Color(0xb7aa8e)
    this.scene.fog = new THREE.FogExp2(0xb7aa8e, 0.003)
    this.terrain.receiveShadow = true
    this.scene.add(this.terrain, buildRiver(), this.explorer.root, this.wolf.root)
    this.scenery = buildScenery(this.scene, { heightAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS, kit })
    this.scene.add(new THREE.HemisphereLight(0xf5e8c9, 0x4b5042, 1.55))
    const sun = new THREE.DirectionalLight(0xffe5b7, 2.8)
    sun.position.set(-60, 85, 25)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    Object.assign(sun.shadow.camera, { left: -115, right: 115, top: 95, bottom: -95, near: 10, far: 220 })
    this.scene.add(sun)
    this.resize()
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement }
  get cameraYaw(): number { return this.yaw }

  setExplorer(explorer: Explorer, delta: number): void { this.explorer.update(explorer, delta) }
  resetExplorer(explorer: Explorer): void { this.explorer.reset(explorer) }
  setWolf(wolf: WanderingWolfState, delta: number): void { this.wolf.update(wolf, delta) }
  resetWolf(wolf: WanderingWolfState): void { this.wolf.reset(wolf) }
  turnCamera(delta: number): void { this.yaw += delta }

  adjustOrbit(x: number, y: number, zoom: number): void {
    if (this.overview) return
    this.yaw -= x * 0.005
    this.pitch = THREE.MathUtils.clamp(this.pitch + y * 0.004, 0.16, 1.05)
    this.distance = THREE.MathUtils.clamp(this.distance + zoom, 4.8, 18)
  }

  setOverview(active: boolean): void { this.overview = active; (this.scene.fog as THREE.FogExp2).density = active ? 0.0013 : 0.003 }
  resetCamera(): void { this.yaw = DEFAULT_CAMERA_YAW; this.pitch = 0.42; this.distance = 11.5 }

  updateCamera(explorer: Explorer, delta: number): void {
    if (this.overview) {
      this.camera.position.lerp(new THREE.Vector3(-18, 175, 96), Math.min(1, delta * 3))
      this.camera.lookAt(-28, 0, -18)
      return
    }
    this.cameraTarget.set(explorer.x, explorer.y + 1.35, explorer.z)
    const horizontal = Math.cos(this.pitch) * this.distance
    const desired = new THREE.Vector3(
      explorer.x + Math.sin(this.yaw) * horizontal,
      explorer.y + 1.35 + Math.sin(this.pitch) * this.distance,
      explorer.z + Math.cos(this.yaw) * horizontal,
    )
    const direction = desired.clone().sub(this.cameraTarget)
    const desiredDistance = direction.length()
    this.raycaster.set(this.cameraTarget, direction.normalize())
    this.raycaster.far = desiredDistance
    const hit = this.raycaster.intersectObjects([this.terrain, ...this.scenery.cameraOccluders], true)[0]
    if (hit) desired.copy(this.cameraTarget).add(direction.multiplyScalar(Math.max(1.8, hit.distance - 0.45)))
    desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 0.85)
    this.camera.position.lerp(desired, Math.min(1, delta * 12))
    this.camera.lookAt(this.cameraTarget)
  }

  resize(): void {
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  render(): void { this.renderer.render(this.scene, this.camera) }

  diagnostics(): { camera: { x: number; y: number; z: number; yaw: number }; forward: WorldPoint; drawCalls: number; triangles: number } {
    return {
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, yaw: this.yaw },
      forward: this.cameraForward(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    }
  }

  cameraForward(): WorldPoint {
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const length = Math.hypot(forward.x, forward.z) || 1
    return { x: forward.x / length, z: forward.z / length }
  }
}
