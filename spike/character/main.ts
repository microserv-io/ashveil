import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assertCharacterAssetSummary, type SemanticMeshName } from './review-contract'
import { assertRigReport, configureAsset, summarizeAsset, type RigReport } from './asset-inspection'
import { createReviewScene, placeReviewCamera, resizeReviewScene } from './review-scene'
import { ReviewUi, type ReviewUiEvents } from './review-ui'
import {
  resetRootYaw,
  sampleTimeForFrame,
  scaleForMode,
  type CameraPreset,
  type ScaleMode,
} from './view-contract'

const ARTIFACT_URL = new URL(
  '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/masculine-auto-rig-pro-diagnostic.glb',
  import.meta.url,
).href
const REPORT_URL = new URL(
  '../../docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged-auto-rig-pro/report.json',
  import.meta.url,
).href
const KNIGHT_URL = './models/player.glb'

interface ReviewState {
  loaded: boolean
  playing: boolean
  turntable: boolean
  scaleMode: ScaleMode
  cameraPreset: CameraPreset
  frame: number
  pose: string
  failure: string | null
}

const state: ReviewState = {
  loaded: false,
  playing: false,
  turntable: false,
  scaleMode: 'native',
  cameraPreset: 'front',
  frame: 0,
  pose: 'bind',
  failure: null,
}

let model: THREE.Object3D | null = null
let knight: THREE.Object3D | null = null
let skeleton: THREE.SkeletonHelper | null = null
let mixer: THREE.AnimationMixer | null = null
let stressAction: THREE.AnimationAction | null = null
let report: RigReport | null = null
let clips: readonly THREE.AnimationClip[] = []
let nativeHeight = 1.8
let semanticMeshes = new Map<SemanticMeshName, THREE.SkinnedMesh>()
let sourceMaterials: { material: THREE.Material; wireframe: boolean }[] = []

const ui = new ReviewUi(createUiEvents())
const reviewScene = createReviewScene(ui.stage)
const clock = new THREE.Clock()

declare global {
  var characterReview:
    | {
        scene: THREE.Scene
        camera: THREE.PerspectiveCamera
        renderer: THREE.WebGLRenderer
        model: THREE.Object3D | null
        mixer: THREE.AnimationMixer | null
        clips: readonly THREE.AnimationClip[]
        report: RigReport | null
        controller: typeof reviewScene.controller
        state: ReviewState
      }
    | undefined
}

globalThis.characterReview = { ...reviewScene, model, mixer, clips, report, state }

placeCamera('front')
resizeReviewScene(reviewScene)
globalThis.addEventListener('resize', () => resizeReviewScene(reviewScene))
void loadReviewAsset()
reviewScene.renderer.setAnimationLoop(render)

function createUiEvents(): ReviewUiEvents {
  return {
    selectFrame: showPoseFrame,
    stepPose,
    togglePlayback,
    setCamera: placeCamera,
    showSkeleton: (visible) => {
      if (skeleton) skeleton.visible = visible
    },
    showWireframe: applyWireframe,
    setTurntable: (enabled) => {
      state.turntable = enabled
    },
    showKnight: (visible) => void toggleKnight(visible),
    showSemanticMesh: (name, visible) => {
      const mesh = semanticMeshes.get(name)
      if (mesh) mesh.visible = visible
    },
    setScale: updateScale,
  }
}

async function loadReviewAsset(): Promise<void> {
  try {
    const [loadedReport, gltf] = await Promise.all([loadReport(), new GLTFLoader().loadAsync(ARTIFACT_URL)])
    const summary = summarizeAsset(gltf)
    assertRigReport(loadedReport)
    assertCharacterAssetSummary(summary, loadedReport.animation.name)

    report = loadedReport
    clips = gltf.animations
    model = gltf.scene
    model.name = 'Ashveil_Masculine_Diagnostic'
    const configured = configureAsset(model)
    semanticMeshes = configured.semanticMeshes
    sourceMaterials = configured.materials
    reviewScene.scene.add(model)

    nativeHeight = summary.bounds.maximum[1] - summary.bounds.minimum[1]
    skeleton = new THREE.SkeletonHelper(model)
    skeleton.visible = false
    skeleton.name = 'Skeleton_Diagnostic'
    reviewScene.scene.add(skeleton)

    mixer = new THREE.AnimationMixer(model)
    const stressClip = clips.find((candidate) => candidate.name === report!.animation.name)!
    stressAction = mixer.clipAction(stressClip)
    stressAction.setLoop(THREE.LoopOnce, 1)
    stressAction.clampWhenFinished = true
    stressAction.play()
    mixer.addEventListener('finished', finishPlayback)
    mixer.setTime(0)

    state.loaded = true
    Object.assign(globalThis.characterReview!, { model, mixer, clips, report })
    ui.populateReport(report)
    ui.validated({
      meshes: configured.meshes,
      primitives: configured.primitives,
      materials: configured.materialCount,
      bones: summary.joints,
      animations: clips.length,
      nativeHeight,
    })
    updateScale('native')
    showPoseFrame(report.animation.frameStart)
  } catch (error) {
    state.failure = error instanceof Error ? error.message : String(error)
    state.loaded = false
    ui.fail(error)
    console.error(error)
  }
}

async function loadReport(): Promise<RigReport> {
  const response = await fetch(REPORT_URL)
  if (!response.ok) throw new Error(`Report failed to load: ${response.status} ${response.statusText}`)
  return (await response.json()) as RigReport
}

function togglePlayback(): void {
  if (!stressAction || !mixer || !report) return
  if (!state.playing && state.frame >= report.animation.frameEnd) {
    stressAction.reset().play()
    showPoseFrame(report.animation.frameStart)
  }
  state.playing = !state.playing
  stressAction.paused = false
  ui.setPlaying(state.playing)
}

function showPoseFrame(frame: number): void {
  if (!report || !mixer || !stressAction) return
  state.playing = false
  stressAction.paused = false
  ui.setPlaying(false)
  state.frame = clamp(frame, report.animation.frameStart, report.animation.frameEnd)
  mixer.setTime(
    sampleTimeForFrame(state.frame, report.animation.framesPerSecond, stressAction.getClip().duration),
  )
  state.pose = report.animation.poses.find((pose) => pose.frame === state.frame)?.name ?? 'between poses'
  ui.setTimeline(state.pose, state.frame, report.animation.framesPerSecond)
}

function stepPose(direction: -1 | 1): void {
  if (!report) return
  const poses = report.animation.poses
  const exact = poses.findIndex((pose) => pose.frame === state.frame)
  const current = exact < 0 ? nearestPoseIndex(poses, state.frame) : exact
  showPoseFrame(poses[(current + direction + poses.length) % poses.length]!.frame)
}

function nearestPoseIndex(poses: RigReport['animation']['poses'], frame: number): number {
  return poses.reduce((nearest, pose, index) => {
    return Math.abs(pose.frame - frame) < Math.abs(poses[nearest]!.frame - frame) ? index : nearest
  }, 0)
}

function placeCamera(requested: CameraPreset | 'reset'): void {
  const preset = requested === 'reset' ? state.cameraPreset : requested
  state.turntable = false
  ui.setTurntable(false)
  resetRootYaw(model, knight)
  state.cameraPreset = preset
  placeReviewCamera(reviewScene, preset, nativeHeight)
  ui.setCamera(preset)
}

function updateScale(mode: ScaleMode): void {
  state.scaleMode = mode
  const scale = scaleForMode(mode)
  model?.scale.setScalar(scale)
  knight?.scale.setScalar(scale)
  ui.setScale(mode, scale)
}

async function toggleKnight(visible: boolean): Promise<void> {
  if (knight) {
    knight.visible = visible
    return
  }
  if (!visible) return
  ui.setKnightPending(true)
  try {
    const gltf = await new GLTFLoader().loadAsync(KNIGHT_URL)
    knight = gltf.scene
    knight.name = 'Knight_Comparison'
    knight.position.x = 1.35
    knight.scale.setScalar(scaleForMode(state.scaleMode))
    knight.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    reviewScene.scene.add(knight)
  } catch (error) {
    ui.rejectKnight(error)
  } finally {
    ui.setKnightPending(false)
  }
}

function applyWireframe(visible: boolean): void {
  for (const entry of sourceMaterials) {
    if (!('wireframe' in entry.material)) continue
    ;(entry.material as THREE.MeshStandardMaterial).wireframe = visible || entry.wireframe
    entry.material.needsUpdate = true
  }
}

function render(): void {
  const delta = Math.min(clock.getDelta(), 0.1)
  if (state.loaded && state.playing && mixer && report) updatePlayback(delta)
  if (state.turntable && model) {
    model.rotation.y += delta * 0.6
    if (knight) knight.rotation.y = model.rotation.y
  }
  reviewScene.controller.update()
  reviewScene.renderer.render(reviewScene.scene, reviewScene.camera)
  ui.setRenderCounts(reviewScene.renderer.info.render.triangles, reviewScene.renderer.info.render.calls)
}

function updatePlayback(delta: number): void {
  mixer!.update(delta)
  const animation = report!.animation
  const seconds = mixer!.time % ((animation.frameEnd + 1) / animation.framesPerSecond)
  state.frame = clamp(Math.round(seconds * animation.framesPerSecond), animation.frameStart, animation.frameEnd)
  state.pose = animation.poses.find((pose) => pose.frame === state.frame)?.name ?? 'between poses'
  ui.setTimeline(state.pose, state.frame, animation.framesPerSecond)
}

function finishPlayback(): void {
  if (!report) return
  state.playing = false
  state.frame = report.animation.frameEnd
  state.pose = report.animation.poses.at(-1)?.name ?? 'finished'
  ui.setPlaying(false)
  ui.setTimeline(state.pose, state.frame, report.animation.framesPerSecond)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
