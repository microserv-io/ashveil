import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assertCharacterAssetSummary, type SemanticMeshName } from './review-contract'
import { assertRigReport, configureAsset, summarizeAsset, type RigReport } from './asset-inspection'
import { createReviewScene, placeReviewCamera, resizeReviewScene } from './review-scene'
import { ReviewUi, type ReviewUiEvents } from './review-ui'
import { GameLookOwner, GAME_LOOK_TEXTURE_URL, type LookMode } from './game-look'
import {
  activateReviewAction,
  assertReviewClipInventory,
  buildReviewClips,
  frameForReviewTime,
  loopConfiguration,
  nearestContactPhase,
  sampleTimeForReviewFrame,
  type ReviewClip,
} from './animation-review'
import {
  resetRootYaw,
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
  lookMode: LookMode
  wireframe: boolean
  selectedClip: string
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
  lookMode: 'diagnostic',
  wireframe: false,
  selectedClip: 'Ashveil_ARP_Benchmark',
  frame: 0,
  pose: 'bind',
  failure: null,
}

let model: THREE.Object3D | null = null
let knight: THREE.Object3D | null = null
let skeleton: THREE.SkeletonHelper | null = null
let mixer: THREE.AnimationMixer | null = null
let activeAction: THREE.AnimationAction | null = null
let report: RigReport | null = null
let clips: readonly THREE.AnimationClip[] = []
let reviewClips: readonly ReviewClip[] = []
let selectedClip: ReviewClip | null = null
let nativeHeight = 1.8
let semanticMeshes = new Map<SemanticMeshName, THREE.SkinnedMesh>()
let sourceMaterials: { material: THREE.Material; wireframe: boolean }[] = []
let gameLook: GameLookOwner | null = null
let gameLookActivated = false

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
        gameLook: GameLookOwner | null
        state: ReviewState
      }
    | undefined
}

globalThis.characterReview = { ...reviewScene, model, mixer, clips, report, gameLook, state }

placeCamera('front')
resizeReviewScene(reviewScene)
globalThis.addEventListener('resize', () => resizeReviewScene(reviewScene))
void loadReviewAsset()
reviewScene.renderer.setAnimationLoop(render)

function createUiEvents(): ReviewUiEvents {
  return {
    selectFrame: showReviewFrame,
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
    setLookMode: updateLookMode,
    selectClip: selectAnimationClip,
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
    reviewClips = buildReviewClips(report)
    assertReviewClipInventory(reviewClips, clips)
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
    mixer.addEventListener('finished', finishPlayback)

    state.loaded = true
    Object.assign(globalThis.characterReview!, { model, mixer, clips, report })
    ui.populateReport(report)
    ui.populateClips(reviewClips, report.animation.name)
    ui.validated({
      meshes: configured.meshes,
      primitives: configured.primitives,
      materials: configured.materialCount,
      bones: summary.joints,
      animations: clips.length,
      nativeHeight,
    })
    updateScale('native')
    selectAnimationClip(report.animation.name)
    void prepareGameLook([...semanticMeshes.values()])
  } catch (error) {
    state.failure = error instanceof Error ? error.message : String(error)
    state.loaded = false
    ui.fail(error)
    console.error(error)
  }
}

async function prepareGameLook(characterMeshes: readonly THREE.Mesh[]): Promise<void> {
  try {
    const floorTexture = await new THREE.TextureLoader().loadAsync(GAME_LOOK_TEXTURE_URL)
    gameLook = new GameLookOwner({
      scene: reviewScene.scene,
      diagnosticGround: reviewScene.diagnosticGround,
      characterMeshes,
      floorTexture,
    })
    gameLook.setWireframe(state.wireframe)
    Object.assign(globalThis.characterReview!, { gameLook })
    ui.setLookReady(true)
  } catch (error) {
    ui.rejectGameLook(error)
    console.error(error)
  }
}

async function loadReport(): Promise<RigReport> {
  const response = await fetch(REPORT_URL)
  if (!response.ok) throw new Error(`Report failed to load: ${response.status} ${response.statusText}`)
  return (await response.json()) as RigReport
}

function togglePlayback(): void {
  if (!activeAction || !mixer || !selectedClip) return
  if (!state.playing && state.frame >= selectedClip.frameEnd) {
    activeAction.reset().play()
    showReviewFrame(selectedClip.frameStart)
  }
  state.playing = !state.playing
  activeAction.paused = !state.playing
  ui.setPlaying(state.playing)
}

function showReviewFrame(frame: number): void {
  if (!report || !mixer || !activeAction || !selectedClip) return
  state.playing = false
  ui.setPlaying(false)
  state.frame = clamp(frame, selectedClip.frameStart, selectedClip.frameEnd)
  activeAction.paused = false
  mixer.setTime(sampleTimeForReviewFrame(selectedClip, state.frame))
  activeAction.paused = true
  updateTimelineUi()
}

function stepPose(direction: -1 | 1): void {
  if (!report || selectedClip?.kind !== 'stress') return
  const poses = report.animation.poses
  const exact = poses.findIndex((pose) => pose.frame === state.frame)
  const current = exact < 0 ? nearestPoseIndex(poses, state.frame) : exact
  showReviewFrame(poses[(current + direction + poses.length) % poses.length]!.frame)
}

function selectAnimationClip(name: string): void {
  if (!mixer || !report) return
  const metadata = reviewClips.find((clip) => clip.name === name)
  const animation = clips.find((clip) => clip.name === name)
  if (!metadata || !animation) throw new Error(`Unknown review animation clip ${name}`)
  const nextAction = mixer.clipAction(animation)
  activateReviewAction(activeAction, nextAction, loopConfiguration(metadata.kind))
  activeAction = nextAction
  selectedClip = metadata
  state.selectedClip = metadata.name
  state.playing = false
  ui.setPlaying(false)
  ui.setSelectedClip(metadata)
  mixer.setTime(0)
  showReviewFrame(metadata.frameStart)
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

function updateLookMode(mode: LookMode): void {
  if (!gameLook) return
  gameLook.setMode(mode)
  gameLook.setWireframe(state.wireframe)
  state.lookMode = mode
  if (mode === 'game' && !gameLookActivated) {
    gameLookActivated = true
    state.cameraPreset = 'gameplay'
    placeReviewCamera(reviewScene, 'gameplay', nativeHeight)
    ui.setCamera('gameplay')
    updateScale('runtime')
  }
  ui.setLookMode(mode)
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
  state.wireframe = visible
  for (const entry of sourceMaterials) {
    if (!('wireframe' in entry.material)) continue
    ;(entry.material as THREE.MeshStandardMaterial).wireframe = visible || entry.wireframe
    entry.material.needsUpdate = true
  }
  gameLook?.setWireframe(visible)
}

function render(): void {
  const delta = Math.min(clock.getDelta(), 0.1)
  if (state.loaded && state.playing && mixer && selectedClip) updatePlayback(delta)
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
  state.frame = frameForReviewTime(selectedClip!, activeAction!.time)
  updateTimelineUi()
}

function finishPlayback(): void {
  if (!selectedClip || selectedClip.kind !== 'stress') return
  state.playing = false
  state.frame = selectedClip.frameEnd
  ui.setPlaying(false)
  updateTimelineUi()
}

function updateTimelineUi(): void {
  if (!report || !selectedClip) return
  if (selectedClip.kind === 'stress') {
    state.pose = report.animation.poses.find((pose) => pose.frame === state.frame)?.name ?? 'between poses'
    ui.setTimeline(state.pose, state.frame, selectedClip.framesPerSecond)
    return
  }
  const contact = nearestContactPhase(selectedClip.contactSchedule, state.frame)
  state.pose = contact.phase
  ui.setLocomotionTimeline(contact.phase, state.frame, selectedClip.framesPerSecond)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
