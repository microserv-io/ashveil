import { REQUIRED_SEMANTIC_MESHES, type SemanticMeshName } from './review-contract'
import type { RigReport } from './asset-inspection'
import type { CameraPreset, ScaleMode } from './view-contract'

export interface ReviewUiEvents {
  selectFrame(frame: number): void
  stepPose(direction: -1 | 1): void
  togglePlayback(): void
  setCamera(preset: CameraPreset | 'reset'): void
  showSkeleton(visible: boolean): void
  showWireframe(visible: boolean): void
  setTurntable(enabled: boolean): void
  showKnight(visible: boolean): void
  showSemanticMesh(name: SemanticMeshName, visible: boolean): void
  setScale(mode: ScaleMode): void
}

export interface AssetStatus {
  meshes: number
  primitives: number
  materials: number
  bones: number
  animations: number
  nativeHeight: number
}

export class ReviewUi {
  readonly stage = element<HTMLElement>('stage')
  private readonly loadState = element<HTMLElement>('load-state')
  private readonly poseState = element<HTMLElement>('pose-state')
  private readonly timeState = element<HTMLElement>('time-state')
  private readonly assetCounts = element<HTMLElement>('asset-counts')
  private readonly rigCounts = element<HTMLElement>('rig-counts')
  private readonly fitState = element<HTMLElement>('fit-state')
  private readonly intentState = element<HTMLElement>('intent-state')
  private readonly renderCounts = element<HTMLElement>('render-counts')
  private readonly heightState = element<HTMLElement>('height-state')
  private readonly scaleState = element<HTMLElement>('scale-state')
  private readonly poseSelect = element<HTMLSelectElement>('pose-select')
  private readonly previousPose = element<HTMLButtonElement>('previous-pose')
  private readonly playPause = element<HTMLButtonElement>('play-pause')
  private readonly nextPose = element<HTMLButtonElement>('next-pose')
  private readonly timeScrub = element<HTMLInputElement>('time-scrub')
  private readonly showSkeleton = element<HTMLInputElement>('show-skeleton')
  private readonly showWireframe = element<HTMLInputElement>('show-wireframe')
  private readonly turntable = element<HTMLInputElement>('turntable')
  private readonly showKnight = element<HTMLInputElement>('show-knight')
  private readonly meshToggles = element<HTMLElement>('mesh-toggles')
  private readonly failure = element<HTMLPreElement>('failure')
  private report: RigReport | null = null

  constructor(private readonly events: ReviewUiEvents) {
    this.bindControls()
    this.enableRigControls(false)
  }

  populateReport(report: RigReport): void {
    this.report = report
    this.poseSelect.replaceChildren(
      ...report.animation.poses.map((pose) => {
        const option = document.createElement('option')
        option.value = String(pose.frame)
        option.textContent = `${pose.name} — frame ${pose.frame}`
        return option
      }),
    )
    this.timeScrub.min = String(report.animation.frameStart)
    this.timeScrub.max = String(report.animation.frameEnd)
    this.meshToggles.replaceChildren(...REQUIRED_SEMANTIC_MESHES.map((name) => this.meshToggle(name)))
    this.enableRigControls(true)
    const passingJoints = report.jointFit.joints.filter((joint) => joint.pass).length
    const maximumTwist = Math.max(
      0,
      ...report.orientationEvidence.poses.flatMap((pose) =>
        Object.values(pose.axialTwistDegrees).map(Math.abs),
      ),
    )
    const deformation = report.productionDeformation.pass ? 'deformation passed' : 'deformation blocked'
    this.fitState.textContent = `${report.jointFit.contract} · ${passingJoints}/${report.jointFit.joints.length} · fit ${(report.jointFit.maximumErrorMetres * 1000).toFixed(1)} mm · pelvis ${(report.pelvisCogFit.pelvisToHipMidpointMetres * 1000).toFixed(1)} mm · twist ${maximumTwist.toFixed(2)}° · ${deformation}`
  }

  validated(status: AssetStatus): void {
    this.loadState.textContent = 'Validated'
    this.loadState.style.color = '#9be07a'
    this.assetCounts.textContent = `${status.meshes} meshes · ${status.primitives} primitives · ${status.materials} materials`
    this.rigCounts.textContent = `${status.bones} bones · ${status.animations} animation${status.animations === 1 ? '' : 's'}`
    this.heightState.textContent = `${status.nativeHeight.toFixed(3)} m native · grounded`
  }

  setTimeline(pose: string, frame: number, framesPerSecond: number): void {
    this.poseState.textContent = `${pose} · frame ${frame}`
    this.timeState.textContent = `${(frame / framesPerSecond).toFixed(2)} s`
    this.timeScrub.value = String(frame)
    const exactOption = [...this.poseSelect.options].find((option) => Number(option.value) === frame)
    this.poseSelect.value = exactOption?.value ?? ''
    this.intentState.textContent = this.poseMetric(pose)
  }

  private poseMetric(name: string): string {
    const pose = this.report?.poseIntent.poses.find((candidate) => candidate.name === name)
    if (!pose) return 'Bind · fitted rest contract'
    if (pose.targetErrorMetres !== undefined) return `Reach error ${(pose.targetErrorMetres * 1000).toFixed(1)} mm`
    if (pose.actualFlexionDegrees !== undefined) return `Elbow ${pose.actualFlexionDegrees.toFixed(1)}°`
    if (pose.actualWorldYawDegrees !== undefined) return `Head ${pose.actualWorldYawDegrees.toFixed(1)}° / target ${pose.intendedWorldYawDegrees!.toFixed(1)}°`
    if (pose.leadFootWorldDelta && pose.knees) {
      return `Lead ${(-pose.leadFootWorldDelta[1]! * 100).toFixed(0)} cm · knees ${pose.knees.L.flexionDegrees.toFixed(0)}°/${pose.knees.R.flexionDegrees.toFixed(0)}° · trail ${(pose.trailFootGroundErrorMetres! * 1000).toFixed(1)} mm`
    }
    return pose.pass ? 'Evaluated intent passed' : 'Evaluated intent failed'
  }

  setPlaying(playing: boolean): void {
    this.playPause.textContent = playing ? 'Pause' : 'Play'
  }

  setScale(mode: ScaleMode, scale: number): void {
    this.scaleState.textContent = mode === 'native' ? 'Native 1:1' : `Runtime ×${scale.toFixed(4)}`
    document.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.scale === mode))
    })
  }

  setCamera(preset: CameraPreset): void {
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.camera === preset))
    })
  }

  setTurntable(enabled: boolean): void {
    this.turntable.checked = enabled
  }

  setRenderCounts(triangles: number, draws: number): void {
    this.renderCounts.textContent = `${triangles.toLocaleString()} triangles · ${draws} draws`
  }

  setKnightPending(pending: boolean): void {
    this.showKnight.disabled = pending
  }

  rejectKnight(error: unknown): void {
    this.showKnight.checked = false
    this.showKnight.title = `Optional comparison unavailable: ${messageOf(error)}`
  }

  fail(error: unknown): void {
    this.loadState.textContent = 'FAILED VALIDATION'
    this.loadState.style.color = '#ff5a4d'
    this.failure.hidden = false
    this.failure.textContent = `Required rig artifact rejected:\n${messageOf(error)}`
    this.enableRigControls(false)
  }

  private bindControls(): void {
    this.poseSelect.addEventListener('change', () => this.events.selectFrame(Number(this.poseSelect.value)))
    this.timeScrub.addEventListener('input', () => this.events.selectFrame(Number(this.timeScrub.value)))
    this.previousPose.addEventListener('click', () => this.events.stepPose(-1))
    this.nextPose.addEventListener('click', () => this.events.stepPose(1))
    this.playPause.addEventListener('click', () => this.events.togglePlayback())
    this.showSkeleton.addEventListener('change', () => this.events.showSkeleton(this.showSkeleton.checked))
    this.showWireframe.addEventListener('change', () => this.events.showWireframe(this.showWireframe.checked))
    this.turntable.addEventListener('change', () => this.events.setTurntable(this.turntable.checked))
    this.showKnight.addEventListener('change', () => this.events.showKnight(this.showKnight.checked))
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((button) => {
      button.addEventListener('click', () => this.events.setCamera(button.dataset.camera as CameraPreset | 'reset'))
    })
    document.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((button) => {
      button.addEventListener('click', () => this.events.setScale(button.dataset.scale as ScaleMode))
    })
    globalThis.addEventListener('keydown', (event) => this.handleKeyboard(event))
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (keyboardBelongsToControl(event.target)) return
    const command = event.key.toLowerCase()
    if (event.code === 'Space') {
      event.preventDefault()
      this.events.togglePlayback()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      this.events.stepPose(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      this.events.stepPose(1)
    } else if (command === 'g') this.events.setCamera('gameplay')
    else if (command === 'f') this.events.setCamera('front')
    else if (command === 's') this.events.setCamera('side')
    else if (command === 'b') this.events.setCamera('back')
    else if (command === 'r') this.events.setCamera('reset')
    else if (command === 'k') this.showSkeleton.click()
    else if (command === 'w') this.showWireframe.click()
    else if (command === 't') this.turntable.click()
  }

  private meshToggle(name: SemanticMeshName): HTMLLabelElement {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    input.dataset.mesh = name
    input.addEventListener('change', () => this.events.showSemanticMesh(name, input.checked))
    label.append(input, document.createTextNode(name))
    return label
  }

  private enableRigControls(enabled: boolean): void {
    this.poseSelect.disabled = !enabled
    this.previousPose.disabled = !enabled
    this.playPause.disabled = !enabled
    this.nextPose.disabled = !enabled
    this.timeScrub.disabled = !enabled
  }
}

function keyboardBelongsToControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(target.tagName)
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing required element #${id}`)
  return found as T
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
