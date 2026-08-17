import './style.css'
import { Effects } from './render/fx'
import { InputController } from './render/input'
import { WorldOverlay } from './render/overlay'
import { SceneHost } from './render/scene'
import { WorldView } from './render/views'
import { Sim } from './sim/sim'
import { DT } from './sim/types'
import { Hud } from './ui/hud'

const app = document.getElementById('app')
if (!app) throw new Error('missing #app')

const overlayRoot = document.createElement('div')
overlayRoot.id = 'overlay'
const hudRoot = document.createElement('div')
hudRoot.id = 'hud'
document.body.append(overlayRoot, hudRoot)

const seed = readSeed()
const sim = new Sim({ seed })

const host = new SceneHost(app)
const view = new WorldView(host.scene)
const effects = new Effects(host.scene)
const overlay = new WorldOverlay(overlayRoot, host, (groundItemId) => sim.queue({ kind: 'pickup', itemId: groundItemId }))
const hud = new Hud(
  hudRoot,
  (itemId) => sim.queue({ kind: 'equip', itemId }),
  (nodeId) => sim.queue({ kind: 'allocate_passive', nodeId }),
)
const input = new InputController(host.renderer.domElement, host, {
  toggleInventory: () => hud.toggleInventory(),
  togglePassives: () => hud.togglePassives(),
})

host.buildTerrain(sim.map)
hud.consume(sim.events)

globalThis.addEventListener('resize', () => host.resize())

const MAX_STEPS_PER_FRAME = 5
let accumulator = 0
let previous = performance.now()

function frame(now: number): void {
  const delta = Math.min(0.25, (now - previous) / 1000)
  previous = now

  // Queue a frame's worth of input once, then advance the sim on its own fixed
  // clock. The sim never sees the render rate.
  for (const intent of input.poll(sim)) sim.queue(intent)

  accumulator += delta
  let steps = 0
  while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
    const depthBefore = sim.depth
    sim.tick()
    handleEvents(depthBefore)
    accumulator -= DT
    steps++
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0

  view.sync(sim, delta)
  effects.update(delta)
  overlay.update(sim, delta)
  hud.update(sim)
  host.followPlayer(sim.player.pos, delta)
  host.render()

  requestAnimationFrame(frame)
}

function handleEvents(depthBefore: number): void {
  const events = sim.events
  if (events.length === 0) return

  effects.consume(sim, events)
  overlay.consume(sim, events)
  hud.consume(events)

  if (sim.depth !== depthBefore) {
    host.buildTerrain(sim.map)
    view.clearArea()
    overlay.clearArea()
  }
}

function readSeed(): number {
  const raw = new URLSearchParams(globalThis.location.search).get('seed')
  const parsed = raw === null ? Number.NaN : Number(raw)
  if (Number.isFinite(parsed)) return parsed
  // A fresh run each load; ?seed=7 reproduces one exactly.
  return Math.floor(Math.random() * 0xffffff)
}

if (import.meta.env.DEV) {
  Object.assign(globalThis, { ashveil: { sim, host, view, input } })
}

requestAnimationFrame(frame)
