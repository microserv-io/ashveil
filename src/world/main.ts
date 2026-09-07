import './world.css'
import { loadWorldCharacter, type WorldCharacterTemplate } from './character'
import { createWorldHud } from './hud'
import { keyboardSteeringActive, WorldInput } from './input'
import { createExplorer, moveExplorer, type Explorer } from './movement'
import { DEFAULT_CAMERA_YAW, WorldView } from './renderer'
import { loadSceneryKit, type SceneryKit } from './scenery-kit'
import { explorerFacingFromCamera, steerExplorer } from './steering'
import { nearestLandmark, SPAWN } from './world-data'

interface DiagnosticState {
  position: { x: number; y: number; z: number }; facing: number; location: string; overview: boolean
  frameMs: number; frameTimes: number[]
  camera: { x: number; y: number; z: number; yaw: number }; forward: { x: number; z: number }
  drawCalls: number; triangles: number; errors: string[]
}

interface WorldDiagnostics {
  readonly state: DiagnosticState
  readonly controls: {
    move(x: number, z: number, sprint?: boolean): void; stop(): void; reset(): void; toggleOverview(): void
  }
}

declare global { var ashveilWorld: WorldDiagnostics | undefined }

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('World root is missing')
let booting = false

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
    const [kit, character] = await Promise.all([loadSceneryKit(), loadWorldCharacter()])
    app!.replaceChildren()
    startWorld(app!, kit, character)
  } catch (error) {
    console.error(error)
    booting = false
    showLoading(true)
  }
}

function initialExplorer(cameraYaw = DEFAULT_CAMERA_YAW): Explorer {
  return { ...createExplorer(SPAWN), facing: explorerFacingFromCamera(cameraYaw) }
}

function startWorld(host: HTMLElement, kit: SceneryKit, character: WorldCharacterTemplate): void {
  let explorer = initialExplorer()
  const hud = createWorldHud(host)
  const view = new WorldView(host, kit, character, explorer)
  const input = new WorldInput(view.canvas, hud.joystick, hud.joystickKnob, hud.sprintButton)
  let overview = false
  let injected = { x: 0, z: 0, sprint: false }
  let previous = performance.now()
  let averageFrameMs = 0
  const errors: string[] = []

  function toggleOverview(): void {
    overview = !overview
    input.clear()
    injected = { x: 0, z: 0, sprint: false }
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

  hud.resetButton.addEventListener('click', reset)
  hud.overviewButton.addEventListener('click', toggleOverview)
  window.addEventListener('resize', () => view.resize())
  window.addEventListener('error', (event) => { errors.push(event.message) })
  window.addEventListener('unhandledrejection', (event) => { errors.push(String(event.reason)) })

  const diagnostics: WorldDiagnostics = {
    state: {
      position: { x: explorer.x, y: explorer.y, z: explorer.z }, facing: explorer.facing, location: 'Alderbank Refuge', overview,
      frameMs: 0, frameTimes: [], camera: { x: 0, y: 0, z: 0, yaw: 0 }, forward: { x: 0, z: 1 },
      drawCalls: 0, triangles: 0, errors,
    },
    controls: {
      move: (x, z, sprint = false) => { injected = { x, z, sprint } },
      stop: () => { injected = { x: 0, z: 0, sprint: false } }, reset, toggleOverview,
    },
  }
  if (import.meta.env.DEV) globalThis.ashveilWorld = diagnostics

  function frame(now: number): void {
    const frameStart = performance.now()
    const delta = Math.min((now - previous) / 1000, 0.1)
    previous = now
    const controls = input.read()
    view.adjustOrbit(controls.orbitX, controls.orbitY, controls.zoom)
    if (!overview) {
      const keyboardActive = keyboardSteeringActive(controls)
      if (keyboardActive) {
        const steered = steerExplorer(explorer, {
          forward: controls.keyboardForward,
          strafe: controls.keyboardStrafe,
          turn: controls.keyboardTurn,
          sprint: controls.sprint,
        }, delta)
        explorer = steered.explorer
        view.turnCamera(steered.turnDelta)
      } else {
        const forward = view.cameraForward()
        const right = { x: -forward.z, z: forward.x }
        const localRight = controls.touchRight + injected.x
        const localForward = controls.touchForward + injected.z
        explorer = moveExplorer(explorer, {
          x: right.x * localRight + forward.x * localForward,
          z: right.z * localRight + forward.z * localForward,
          sprint: controls.sprint || injected.sprint,
        }, delta)
      }
    }
    view.setExplorer(explorer, delta)
    view.updateCamera(explorer, delta)
    view.render()
    const frameMs = performance.now() - frameStart
    averageFrameMs += (frameMs - averageFrameMs) * 0.05
    const rendered = view.diagnostics()
    Object.assign(diagnostics.state, {
      position: { x: explorer.x, y: explorer.y, z: explorer.z }, facing: explorer.facing, location: nearestLandmark(explorer.x, explorer.z).label,
      overview, frameMs: averageFrameMs, camera: rendered.camera, forward: rendered.forward,
      drawCalls: rendered.drawCalls, triangles: rendered.triangles,
    })
    diagnostics.state.frameTimes.push(frameMs)
    if (diagnostics.state.frameTimes.length > 240) diagnostics.state.frameTimes.shift()
    hud.setLocation(diagnostics.state.location)
    requestAnimationFrame(frame)
  }

  view.updateCamera(explorer, 1)
  requestAnimationFrame(frame)
}

void boot()
