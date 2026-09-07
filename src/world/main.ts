import './world.css'
import { createWorldHud } from './hud'
import { WorldInput } from './input'
import { createExplorer, moveExplorer, type Explorer } from './movement'
import { WorldView } from './renderer'
import { nearestLandmark, SPAWN } from './world-data'

interface DiagnosticState {
  position: { x: number; y: number; z: number }
  location: string
  overview: boolean
  frameMs: number
  frameTimes: number[]
  camera: { x: number; y: number; z: number; yaw: number }
  forward: { x: number; z: number }
  drawCalls: number
  triangles: number
  errors: string[]
}

interface WorldDiagnostics {
  readonly state: DiagnosticState
  readonly controls: {
    move(x: number, z: number, sprint?: boolean): void
    stop(): void
    reset(): void
    toggleOverview(): void
  }
}

declare global { var ashveilWorld: WorldDiagnostics | undefined }

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('World root is missing')

const hud = createWorldHud(app)
const view = new WorldView(app)
const input = new WorldInput(view.canvas, hud.joystick, hud.joystickKnob, hud.sprintButton)
let explorer: Explorer = createExplorer(SPAWN)
let overview = false
let injected = { x: 0, z: 0, sprint: false }
let previous = performance.now()
let averageFrameMs = 0
const errors: string[] = []

function reset(): void {
  explorer = createExplorer(SPAWN)
  injected = { x: 0, z: 0, sprint: false }
  input.clear()
  view.resetCamera()
  if (overview) toggleOverview()
}

function toggleOverview(): void {
  overview = !overview
  input.clear()
  injected = { x: 0, z: 0, sprint: false }
  view.setOverview(overview)
  hud.setOverview(overview)
}

hud.resetButton.addEventListener('click', reset)
hud.overviewButton.addEventListener('click', toggleOverview)
window.addEventListener('resize', () => view.resize())
window.addEventListener('error', (event) => { errors.push(event.message) })
window.addEventListener('unhandledrejection', (event) => { errors.push(String(event.reason)) })

const diagnostics: WorldDiagnostics = {
  state: {
    position: { x: explorer.x, y: explorer.y, z: explorer.z },
    location: 'Alderbank Refuge', overview, frameMs: 0, frameTimes: [],
    camera: { x: 0, y: 0, z: 0, yaw: 0 }, forward: { x: 0, z: 1 }, drawCalls: 0, triangles: 0, errors,
  },
  controls: {
    move: (x, z, sprint = false) => { injected = { x, z, sprint } },
    stop: () => { injected = { x: 0, z: 0, sprint: false } },
    reset,
    toggleOverview,
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
  const location = nearestLandmark(explorer.x, explorer.z).label
  hud.setLocation(location)
  const frameMs = performance.now() - frameStart
  averageFrameMs += (frameMs - averageFrameMs) * 0.05
  const renderState = view.diagnostics()
  diagnostics.state.position = { x: explorer.x, y: explorer.y, z: explorer.z }
  diagnostics.state.location = location
  diagnostics.state.overview = overview
  diagnostics.state.frameMs = averageFrameMs
  diagnostics.state.frameTimes.push(frameMs)
  if (diagnostics.state.frameTimes.length > 240) diagnostics.state.frameTimes.shift()
  diagnostics.state.camera = renderState.camera
  diagnostics.state.forward = renderState.forward
  diagnostics.state.drawCalls = renderState.drawCalls
  diagnostics.state.triangles = renderState.triangles
  requestAnimationFrame(frame)
}

view.setExplorer(explorer)
view.updateCamera(explorer, 1)
requestAnimationFrame(frame)
