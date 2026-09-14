import * as THREE from 'three'
import { ApprovedWorldCharacter, type ApprovedCharacterTemplate } from './approved-character'
import { buildScenery, disposeScenery, type BuiltScenery } from './scenery'
import type { SceneryKit } from './scenery-kit'
import { LANDMARKS, PATHS, SOLIDS, type WorldPoint } from './world-data'
import type { Explorer } from './movement'
import { QuestNpcView } from './quest-npcs'
import { QuestTargetView, type VisibleQuestMarker } from './quest-target-view'
import { QUEST_NPCS, QUEST_TARGETS, questTarget } from './quest-world-data'
import { buildTerrainSurface, type BuiltTerrainSurface } from './terrain-surface'
import { terrainCameraHitDistance } from './terrain-camera-collision'
import { getActiveZone } from './zone-active'
import type { CompiledZone } from './zone-types'
import { buildWaterSurface, type BuiltWaterSurface } from './water-surface'

const SUN_OFFSET = new THREE.Vector3(-60, 85, 25)
const SHADOW_RADIUS = 42
const BACKGROUND = 0xb7aa8e

export const DEFAULT_CAMERA_YAW = 0.45

export class WorldView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private readonly zone: CompiledZone
  private readonly terrain: BuiltTerrainSurface
  private readonly water: BuiltWaterSurface
  private readonly scenery: BuiltScenery
  private readonly explorer: ApprovedWorldCharacter
  private readonly questNpcs: QuestNpcView
  private readonly questTargets: QuestTargetView
  private readonly raycaster = new THREE.Raycaster()
  private readonly cameraTarget = new THREE.Vector3()
  private readonly desiredCamera = new THREE.Vector3()
  private readonly cameraDirection = new THREE.Vector3()
  private readonly overviewPosition = new THREE.Vector3()
  private readonly overviewTarget = new THREE.Vector3()
  private readonly zoneSpanX: number
  private readonly zoneSpanZ: number
  private readonly zoneDiagonal: number
  private readonly sun: THREE.DirectionalLight
  private readonly sunTarget = new THREE.Object3D()
  private readonly normalFogDensity: number
  private readonly overviewFogDensity: number
  private waterElapsedSeconds = 0
  private yaw = DEFAULT_CAMERA_YAW
  private pitch = 0.42
  private distance = 11.5
  private overview = false

  constructor(
    host: HTMLElement,
    kit: SceneryKit,
    character: ApprovedCharacterTemplate,
    initialExplorer: Explorer,
    zone: CompiledZone = getActiveZone(),
  ) {
    this.zone = zone
    const spanX = zone.bounds.maxX - zone.bounds.minX
    const spanZ = zone.bounds.maxZ - zone.bounds.minZ
    const diagonal = Math.hypot(spanX, spanZ)
    this.zoneSpanX = spanX
    this.zoneSpanZ = spanZ
    this.zoneDiagonal = diagonal
    const centerX = (zone.bounds.minX + zone.bounds.maxX) * 0.5
    const centerZ = (zone.bounds.minZ + zone.bounds.maxZ) * 0.5
    this.normalFogDensity = THREE.MathUtils.clamp(5.5 / Math.max(spanX, spanZ), 0.0018, 0.003)
    this.overviewFogDensity = 0.35 / Math.max(spanX, spanZ)
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, Math.max(600, diagonal * 1.35))
    this.overviewTarget.set(centerX, zone.definition.terrain.baseHeight, centerZ)
    this.overviewPosition.set(centerX, Math.max(spanX, spanZ) * 0.8, centerZ)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.96
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.prepend(this.renderer.domElement)

    this.explorer = new ApprovedWorldCharacter(character, initialExplorer)
    this.scene.background = new THREE.Color(BACKGROUND)
    this.scene.fog = new THREE.FogExp2(BACKGROUND, this.normalFogDensity)
    this.terrain = buildTerrainSurface(zone)
    this.water = buildWaterSurface(zone, SUN_OFFSET)
    this.scene.add(this.terrain.mesh, this.water.mesh, this.explorer.root)
    this.questNpcs = new QuestNpcView(this.scene, character, QUEST_NPCS, zone.heightAt)
    this.questTargets = new QuestTargetView(this.scene, QUEST_TARGETS, zone.heightAt)
    this.scenery = buildScenery(this.scene, {
      heightAt: zone.heightAt, isWaterAt: zone.isWaterAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS, kit,
    })
    this.scene.add(new THREE.HemisphereLight(0xf5e8c9, 0x4b5042, 1.55))
    this.sun = new THREE.DirectionalLight(0xffe5b7, 2.8)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    Object.assign(this.sun.shadow.camera, {
      left: -SHADOW_RADIUS, right: SHADOW_RADIUS, top: SHADOW_RADIUS, bottom: -SHADOW_RADIUS, near: 1, far: 160,
    })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.scene.add(this.sun, this.sunTarget)
    this.updateSun(initialExplorer)
    this.resize()
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement }
  get cameraYaw(): number { return this.yaw }

  setExplorer(explorer: Explorer, delta: number): void {
    this.explorer.update(explorer, delta)
    this.questNpcs.updateLabels(explorer)
    this.updateSun(explorer)
  }

  resetExplorer(explorer: Explorer): void { this.explorer.reset(explorer); this.updateSun(explorer) }
  turnCamera(delta: number): void { this.yaw += delta }

  setQuestMarkers(markers: readonly VisibleQuestMarker[]): void {
    this.questNpcs.clearMarkers()
    this.questTargets.show(markers)
    for (const marker of markers) {
      const target = questTarget(marker.id)
      if (target?.kind !== 'prop') this.questNpcs.setMarker(marker.id, marker.category, marker.status)
    }
  }

  adjustOrbit(x: number, y: number, zoom: number): void {
    if (this.overview) return
    this.yaw -= x * 0.005
    this.pitch = THREE.MathUtils.clamp(this.pitch + y * 0.004, 0.16, 1.05)
    this.distance = THREE.MathUtils.clamp(this.distance + zoom, 4.8, 18)
  }

  setOverview(active: boolean): void {
    this.overview = active
    ;(this.scene.fog as THREE.FogExp2).density = active ? this.overviewFogDensity : this.normalFogDensity
    this.sun.castShadow = !active
    this.camera.up.set(0, active ? 0 : 1, active ? 1 : 0)
  }

  resetCamera(): void { this.yaw = DEFAULT_CAMERA_YAW; this.pitch = 0.42; this.distance = 11.5 }

  updateCamera(explorer: Explorer, delta: number): void {
    if (this.overview) {
      this.camera.position.lerp(this.overviewPosition, Math.min(1, delta * 3))
      this.camera.lookAt(this.overviewTarget)
      return
    }
    this.cameraTarget.set(explorer.x, explorer.y + 1.35, explorer.z)
    const horizontal = Math.cos(this.pitch) * this.distance
    this.desiredCamera.set(
      explorer.x + Math.sin(this.yaw) * horizontal,
      explorer.y + 1.35 + Math.sin(this.pitch) * this.distance,
      explorer.z + Math.cos(this.yaw) * horizontal,
    )
    this.cameraDirection.copy(this.desiredCamera).sub(this.cameraTarget)
    const desiredDistance = this.cameraDirection.length()
    this.raycaster.set(this.cameraTarget, this.cameraDirection.normalize())
    this.raycaster.far = desiredDistance
    const sceneryHit = this.raycaster.intersectObjects(this.scenery.cameraOccluders, true)[0]?.distance
    const terrainHit = terrainCameraHitDistance(
      this.zone,
      this.cameraTarget,
      this.cameraDirection,
      desiredDistance,
    )
    const hitDistance = Math.min(sceneryHit ?? Infinity, terrainHit ?? Infinity)
    if (Number.isFinite(hitDistance)) {
      this.desiredCamera.copy(this.cameraTarget).add(this.cameraDirection.multiplyScalar(Math.max(1.8, hitDistance - 0.45)))
    }
    this.desiredCamera.y = Math.max(
      this.desiredCamera.y,
      this.zone.heightAt(this.desiredCamera.x, this.desiredCamera.z) + 0.85,
    )
    this.camera.position.lerp(this.desiredCamera, Math.min(1, delta * 12))
    this.camera.lookAt(this.cameraTarget)
  }

  resize(): void {
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    this.camera.aspect = width / height
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov)
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * this.camera.aspect)
    const overviewDistance = Math.max(
      this.zoneSpanZ / (2 * Math.tan(verticalFov * 0.5)),
      this.zoneSpanX / (2 * Math.tan(horizontalFov * 0.5)),
    ) * 1.08
    this.overviewPosition.y = this.overviewTarget.y + overviewDistance
    this.camera.far = Math.max(600, this.zoneDiagonal * 1.35, overviewDistance * 1.25)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  render(): void {
    this.waterElapsedSeconds = performance.now() * 0.001
    this.water.update(this.waterElapsedSeconds)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.terrain.dispose()
    this.water.dispose()
    disposeScenery(this.scenery)
    this.questNpcs.dispose()
    this.questTargets.dispose()
    this.explorer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  diagnostics(): {
    camera: { x: number; y: number; z: number; yaw: number }
    forward: WorldPoint
    drawCalls: number
    triangles: number
    water: { elapsedSeconds: number; level: number }
  } {
    return {
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, yaw: this.yaw },
      forward: this.cameraForward(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      water: { elapsedSeconds: this.waterElapsedSeconds, level: this.zone.definition.river.waterLevel },
    }
  }

  cameraForward(): WorldPoint {
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const length = Math.hypot(forward.x, forward.z) || 1
    return { x: forward.x / length, z: forward.z / length }
  }

  private updateSun(explorer: Pick<Explorer, 'x' | 'y' | 'z'>): void {
    this.sunTarget.position.set(explorer.x, explorer.y, explorer.z)
    this.sun.position.copy(this.sunTarget.position).add(SUN_OFFSET)
    this.sun.target = this.sunTarget
    this.sunTarget.updateMatrixWorld()
  }
}
