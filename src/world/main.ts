import './world.css'
import { createWorldHud } from './hud'
import { WorldInput } from './input'
import { createExplorer, moveExplorer, type Explorer } from './movement'
import { WorldView } from './renderer'
import { loadSceneryKit, type SceneryKit } from './scenery-kit'
import { nearestLandmark, SPAWN } from './world-data'

interface DiagnosticState {
  position: { x: number; y: number; z: number }; location: string; overview: boolean
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
        <p class="mt-2 text-sm leading-6 text-stone-400">${failed ? 'The scenery did not arrive. Try loading the valley again.' : 'Setting the valley and refuge in place…'}</p>
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
    const kit = await loadSceneryKit()
    app!.replaceChildren()
    startWorld(app!, kit)
  } catch (error) {
    console.error(error)
    booting = false
    showLoading(true)
  }
}

function startWorld(host: HTMLElement, kit: SceneryKit): void {
  const hud = createWorldHud(host)
  const view = new WorldView(host, kit)
  const input = new WorldInput(view.canvas, hud.joystick, hud.joystickKnob, hud.sprintButton)
  let explorer: Explorer = createExplorer(SPAWN)
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
    explorer = createExplorer(SPAWN)
    injected = { x: 0, z: 0, sprint: false }
    input.clear()
    view.resetCamera()
    if (overview) toggleOverview()
  }

  hud.resetButton.addEventListener('click', reset)
  hud.overviewButton.addEventListener('click', toggleOverview)
  window.addEventListener('resize', () => view.resize())
  window.addEventListener('error', (event) => { errors.push(event.message) })
  window.addEventListener('unhandledrejection', (event) => { errors.push(String(event.reason)) })

  const diagnostics: WorldDiagnostics = {
    state: {
      position: { x: explorer.x, y: explorer.y, z: explorer.z }, location: 'Alderbank Refuge', overview,
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
      const forward = view.cameraForward()
      const right = { x: -forward.z, z: forward.x }
      const localRight = controls.right + injected.x
      const localForward = controls.forward + injected.z
      explorer = moveExplorer(explorer, {
        x: right.x * localRight + forward.x * localForward,
        z: right.z * localRight + forward.z * localForward,
        sprint: controls.sprint || injected.sprint,
      }, delta)
    }
    view.setExplorer(explorer)
    view.updateCamera(explorer, delta)
    view.render()
    const frameMs = performance.now() - frameStart
    averageFrameMs += (frameMs - averageFrameMs) * 0.05
    const rendered = view.diagnostics()
    Object.assign(diagnostics.state, {
      position: { x: explorer.x, y: explorer.y, z: explorer.z }, location: nearestLandmark(explorer.x, explorer.z).label,
      overview, frameMs: averageFrameMs, camera: rendered.camera, forward: rendered.forward,
      drawCalls: rendered.drawCalls, triangles: rendered.triangles,
    })
    diagnostics.state.frameTimes.push(frameMs)
    if (diagnostics.state.frameTimes.length > 240) diagnostics.state.frameTimes.shift()
    hud.setLocation(diagnostics.state.location)
    requestAnimationFrame(frame)
  }

  view.setExplorer(explorer)
  view.updateCamera(explorer, 1)
  requestAnimationFrame(frame)
}

void boot()
