import './world.css'
import { createWorldHud } from './hud'
import { HILLSIDE_REVIEW_HOUR, hillsideReviewRoute, type HillsideTerrainLook } from './hillside-review'
import { createHillsideReviewPanel, type HillsideReviewPanel } from './hillside-review-panel'
import { WorldInput } from './input'
import { canOccupy, createExplorer, type Explorer } from './movement'
import { DEFAULT_CAMERA_YAW, WorldView } from './renderer'
import { WorldQuestController } from './quest-controller'
import { sampleSkyState } from './sky-environment'
import { explorerFacingFromCamera } from './steering'
import { createTimePanel, type TimePanel } from './time-panel'
import { loadWorldAssets, type WorldAssets } from './world-assets'
import { WorldClock } from './world-clock'
import { getActiveZone } from './zone-active'
import { LANDMARKS, nearestLandmark, SPAWN } from './world-data'
import { advanceExplorer } from './world-controls'
import { worldStartPresentation } from './world-start'
import { loadBaselineTerrainTextures, type TerrainTextureSet } from './terrain-textures'

interface DiagnosticState {
  position: { x: number; y: number; z: number }; facing: number; location: string; overview: boolean
  grounded: boolean; jumpPhase: string
  frameMs: number; frameTimes: number[]
  camera: { x: number; y: number; z: number; yaw: number }; forward: { x: number; z: number }
  drawCalls: number; triangles: number; water: { elapsedSeconds: number; level: number }; errors: string[]
  time: { hour: number; durationSeconds: number; paused: boolean }
  hillsideReview?: { enabled: true; look: HillsideTerrainLook; ready: boolean; error?: string }
}

interface WorldDiagnostics {
  readonly state: DiagnosticState
  readonly controls: {
    move(x: number, z: number, sprint?: boolean): void; stop(): void; reset(): void; toggleOverview(): void
    visitLandmark(id: string): void
    setHour(hour: number): void; setDayDuration(durationSeconds: number): void; setTimePaused(paused: boolean): void
    setTerrainLook(look: HillsideTerrainLook): void
  }
}

declare global { var ashveilWorld: WorldDiagnostics | undefined }

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('World root is missing')
let booting = false
const hillsideRoute = hillsideReviewRoute(location.search)

function showLoading(failed = false): void {
  app!.innerHTML = `
    <main class="grid min-h-full place-items-center bg-stone-950 px-6 text-center text-stone-100">
      <section class="max-w-md rounded-2xl border border-amber-100/15 bg-stone-900 px-8 py-7 shadow-2xl">
        <p class="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-amber-200/65">Terrain exploration</p>
        <h1 class="mt-3 font-serif text-2xl">${failed ? 'Alderbank could not be opened' : 'Preparing Alderbank'}</h1>
        <p class="mt-2 text-sm leading-6 text-stone-400">${failed ? 'The world assets did not arrive. Try loading the valley again.' : 'Setting the valley and refuge in place…'}</p>
        ${failed ? '<button id="retry-world" class="mt-5 rounded-lg border border-amber-100/20 bg-amber-100/10 px-4 py-2 text-sm font-medium text-amber-50 hover:bg-amber-100/15">Try again</button>' : ''}
      </section>
    </main>`
  const retry = document.querySelector<HTMLButtonElement>('#retry-world')
  if (retry) retry.onclick = () => { retry.disabled = true; void boot() }
}

async function boot(): Promise<void> {
  if (booting) return
  booting = true
  showLoading()
  try {
    const [assetsResult, baselineResult] = await Promise.allSettled([
      loadWorldAssets(),
      hillsideRoute.enabled ? loadBaselineTerrainTextures() : Promise.resolve(undefined),
    ])
    if (assetsResult.status === 'rejected') {
      if (baselineResult.status === 'fulfilled') baselineResult.value?.dispose()
      throw assetsResult.reason
    }
    const baseline = baselineResult.status === 'fulfilled' ? baselineResult.value : undefined
    const baselineError = baselineResult.status === 'rejected'
      ? baselineResult.reason instanceof Error ? baselineResult.reason.message : String(baselineResult.reason)
      : undefined
    app!.replaceChildren()
    startWorld(app!, assetsResult.value, baseline, baselineError)
  } catch (error) {
    console.error(error)
    booting = false
    showLoading(true)
  }
}

function initialExplorer(cameraYaw = DEFAULT_CAMERA_YAW): Explorer {
  return { ...createExplorer(SPAWN), facing: explorerFacingFromCamera(cameraYaw) }
}

function startWorld(host: HTMLElement, assets: WorldAssets, baseline?: TerrainTextureSet, baselineError?: string): void {
  let explorer = initialExplorer()
  const start = worldStartPresentation(getActiveZone())
  const hud = createWorldHud(host, start)
  const view = new WorldView(host, assets.scenery, assets.character, assets.sky, explorer, assets.terrain, getActiveZone(), baseline)
  if (hillsideRoute.enabled) view.adjustOrbit(0, -80, 0)
  const input = new WorldInput(view.canvas, hud.joystick, hud.joystickKnob, hud.sprintButton, hud.jumpButton)
  const quests = new WorldQuestController(host, view, input, explorer)
  let overview = false
  let injected = { x: 0, z: 0, sprint: false }
  let previous = performance.now()
  const clock = new WorldClock({
    nowMilliseconds: previous,
    startHour: hillsideRoute.enabled ? HILLSIDE_REVIEW_HOUR : undefined,
    paused: hillsideRoute.enabled,
  })
  let averageFrameMs = 0
  let animationFrame = 0
  let pausedForPageCache = false
  let disposed = false
  const errors: string[] = []
  let timePanel: TimePanel | undefined
  let hillsidePanel: HillsideReviewPanel | undefined
  let hillsideLook: HillsideTerrainLook = 'painterly'
  let hillsideLoading = false
  let hillsideLoadError = baselineError

  const clearMovement = (): void => {
    injected = { x: 0, z: 0, sprint: false }
    input.clear()
  }

  const setHour = (hour: number): void => { clock.setHour(hour, performance.now()) }
  const setDayDuration = (durationSeconds: number): void => { clock.setDuration(durationSeconds, performance.now()) }
  const setTimePaused = (paused: boolean): void => { clock.setPaused(paused, performance.now()) }

  const hillsidePanelState = () => ({
    look: hillsideLook,
    loading: hillsideLoading,
    error: hillsideLoadError,
  })

  function setTerrainLook(look: HillsideTerrainLook): void {
    if (!hillsideRoute.enabled || !view.setTerrainLook(look)) return
    hillsideLook = look
    if (diagnostics.state.hillsideReview) {
      diagnostics.state.hillsideReview.look = look
      diagnostics.state.hillsideReview.ready = view.baselineTerrainReady
      diagnostics.state.hillsideReview.error = hillsideLoadError
    }
    hillsidePanel?.update(hillsidePanelState())
  }

  async function retryBaselineTerrain(): Promise<void> {
    if (hillsideLoading || disposed) return
    hillsideLoading = true
    hillsideLoadError = undefined
    hillsidePanel?.update(hillsidePanelState())
    try {
      const textures = await loadBaselineTerrainTextures()
      if (disposed) {
        textures.dispose()
        return
      }
      view.installBaselineTerrain(textures)
      setTerrainLook('baseline')
    } catch (error) {
      hillsideLoadError = error instanceof Error ? error.message : String(error)
    } finally {
      hillsideLoading = false
      if (diagnostics.state.hillsideReview) {
        diagnostics.state.hillsideReview.ready = view.baselineTerrainReady
        diagnostics.state.hillsideReview.error = hillsideLoadError
      }
      hillsidePanel?.update(hillsidePanelState())
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(animationFrame)
    window.removeEventListener('pagehide', handlePageHide)
    window.removeEventListener('pageshow', handlePageShow)
    if (import.meta.env.DEV && globalThis.ashveilWorld === diagnostics) globalThis.ashveilWorld = undefined
    timePanel?.dispose()
    hillsidePanel?.dispose()
    view.dispose()
  }

  function handlePageHide(event: PageTransitionEvent): void {
    if (!event.persisted) {
      dispose()
      return
    }
    pausedForPageCache = true
    cancelAnimationFrame(animationFrame)
    animationFrame = 0
    clearMovement()
  }

  function handlePageShow(event: PageTransitionEvent): void {
    if (!event.persisted || !pausedForPageCache || disposed) return
    pausedForPageCache = false
    previous = performance.now()
    animationFrame = requestAnimationFrame(frame)
  }

  function toggleOverview(): void {
    overview = !overview
    clearMovement()
    view.setOverview(overview)
    hud.setOverview(overview)
  }

  function reset(): void {
    injected = { x: 0, z: 0, sprint: false }
    input.clear()
    view.resetCamera()
    explorer = initialExplorer(view.cameraYaw)
    view.resetExplorer(explorer)
    if (overview) toggleOverview()
  }

  function visitLandmark(id: string): void {
    const landmark = LANDMARKS.find((candidate) => candidate.id === id)
    if (!landmark) throw new Error(`Unknown landmark: ${id}`)
    const candidate = createExplorer(landmark)
    if (!canOccupy(candidate, candidate.x, candidate.z)) throw new Error(`Landmark is not safe to visit: ${id}`)
    injected = { x: 0, z: 0, sprint: false }
    input.clear()
    view.resetCamera()
    explorer = { ...candidate, facing: explorerFacingFromCamera(view.cameraYaw) }
    view.resetExplorer(explorer)
    if (overview) toggleOverview()
  }

  hud.resetButton.addEventListener('click', () => { reset(); hud.resetButton.blur() })
  hud.overviewButton.addEventListener('click', () => { toggleOverview(); hud.overviewButton.blur() })
  window.addEventListener('resize', () => view.resize())
  window.addEventListener('error', (event) => { errors.push(event.message) })
  window.addEventListener('unhandledrejection', (event) => { errors.push(String(event.reason)) })
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('pageshow', handlePageShow)
  void quests.initialize()

  const diagnostics: WorldDiagnostics = {
    state: {
      position: { x: explorer.x, y: explorer.y, z: explorer.z }, facing: explorer.facing, location: start.locationLabel, overview,
      grounded: explorer.grounded, jumpPhase: explorer.jumpPhase,
      frameMs: 0, frameTimes: [], camera: { x: 0, y: 0, z: 0, yaw: 0 }, forward: { x: 0, z: 1 },
      drawCalls: 0, triangles: 0, water: { elapsedSeconds: 0, level: 0 }, errors,
      time: clock.read(previous),
      hillsideReview: hillsideRoute.enabled
        ? { enabled: true, look: hillsideLook, ready: view.baselineTerrainReady, error: hillsideLoadError }
        : undefined,
    },
    controls: {
      move: (x, z, sprint = false) => { injected = { x, z, sprint } },
      stop: () => { injected = { x: 0, z: 0, sprint: false } }, reset, toggleOverview, visitLandmark,
      setHour, setDayDuration, setTimePaused, setTerrainLook,
    },
  }
  if (hillsideRoute.enabled) {
    hillsidePanel = createHillsideReviewPanel(host, {
      clearMovement,
      retry: () => { void retryBaselineTerrain() },
      setLook: setTerrainLook,
    })
    hillsidePanel.update(hillsidePanelState())
    setTerrainLook('painterly')
  }
  if (import.meta.env.DEV) {
    globalThis.ashveilWorld = diagnostics
    if (!hillsideRoute.enabled) {
      timePanel = createTimePanel(host, { clearMovement, setHour, setDuration: setDayDuration, setPaused: setTimePaused })
      timePanel.update(diagnostics.state.time)
    }
  }

  function frame(now: number): void {
    if (disposed) return
    const frameStart = performance.now()
    const delta = Math.min((now - previous) / 1000, 0.1)
    previous = now
    const controls = input.read()
    const intendedMouseFacing = explorerFacingFromCamera(view.cameraYawAfterOrbit(controls.mouseSteeringOrbitX))
    view.adjustOrbit(controls.orbitX, controls.orbitY, controls.zoom)
    if (!overview) {
      const controlled = advanceExplorer(explorer, controls, view.cameraForward(), intendedMouseFacing, injected, delta)
      explorer = controlled.explorer
      view.turnCamera(controlled.turnDelta)
    }
    view.setExplorer(explorer, overview ? 0 : delta)
    quests.update(explorer)
    view.updateCamera(explorer, delta)
    const time = clock.read(now)
    view.render(sampleSkyState(time.hour), now * 0.001, explorer)
    const frameMs = performance.now() - frameStart
    averageFrameMs += (frameMs - averageFrameMs) * 0.05
    const rendered = view.diagnostics()
    Object.assign(diagnostics.state, {
      position: { x: explorer.x, y: explorer.y, z: explorer.z }, facing: explorer.facing, location: nearestLandmark(explorer.x, explorer.z).label,
      overview, grounded: explorer.grounded, jumpPhase: explorer.jumpPhase,
      frameMs: averageFrameMs, camera: rendered.camera, forward: rendered.forward,
      drawCalls: rendered.drawCalls, triangles: rendered.triangles, water: rendered.water,
      time,
    })
    diagnostics.state.frameTimes.push(frameMs)
    if (diagnostics.state.frameTimes.length > 240) diagnostics.state.frameTimes.shift()
    hud.setLocation(diagnostics.state.location)
    timePanel?.update(time)
    animationFrame = requestAnimationFrame(frame)
  }

  view.updateCamera(explorer, 1)
  animationFrame = requestAnimationFrame(frame)
}

void boot()
