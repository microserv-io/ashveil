import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PALETTE } from '../../src/render/palette'
import { GAMEPLAY_CAMERA_FOV } from './review-contract'
import { cameraPlacement, type CameraPreset } from './view-contract'

export interface ReviewScene {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controller: OrbitControls
}

export function createReviewScene(stage: HTMLElement): ReviewScene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETTE.background)
  scene.fog = new THREE.Fog(PALETTE.fog, 30, 62)

  const camera = new THREE.PerspectiveCamera(GAMEPLAY_CAMERA_FOV, 1, 0.5, 220)
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  stage.append(renderer.domElement)

  const controller = new OrbitControls(camera, renderer.domElement)
  controller.enableDamping = true
  controller.dampingFactor = 0.08
  controller.minDistance = 1.2
  controller.maxDistance = 42
  controller.maxPolarAngle = Math.PI * 0.49

  addLighting(scene)
  addReviewGround(scene)
  return { scene, camera, renderer, controller }
}

export function placeReviewCamera(review: ReviewScene, preset: CameraPreset, nativeHeight: number): void {
  const placement = cameraPlacement(preset, nativeHeight)
  review.camera.position.fromArray(placement.position)
  review.controller.target.fromArray(placement.target)
  review.controller.update()
}

export function resizeReviewScene(review: ReviewScene): void {
  const width = globalThis.innerWidth
  const height = globalThis.innerHeight
  review.renderer.setSize(width, height)
  review.camera.aspect = width / height
  review.camera.updateProjectionMatrix()
}

function addLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x404a5c, 1.1))
  const key = new THREE.DirectionalLight(0xffe6c4, 1.5)
  key.position.set(12, 26, 8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 80
  key.shadow.camera.left = -26
  key.shadow.camera.right = 26
  key.shadow.camera.top = 26
  key.shadow.camera.bottom = -26
  key.shadow.bias = -0.0016
  scene.add(key, key.target)
  const rim = new THREE.DirectionalLight(0x4a6cff, 0.35)
  rim.position.set(-14, 10, -12)
  scene.add(rim)
}

function addReviewGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5, 64),
    new THREE.MeshStandardMaterial({ color: PALETTE.floorLow, roughness: 0.95, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(10, 20, PALETTE.playerAccent, PALETTE.floorHigh)
  grid.position.y = 0.002
  scene.add(grid)
}
