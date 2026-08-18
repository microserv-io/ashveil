import './style.css'
import { Effects } from './render/fx'
import { Controls } from './render/input'
import { FrameLoop } from './render/loop'
import { loadModels } from './render/models'
import { prewarmShaders } from './render/prewarm'
import { WorldOverlay } from './render/overlay'
import { SceneHost } from './render/scene'
import { WorldView } from './render/views'
import { Sim } from './sim/sim'
import { type SimEvent } from './sim/types'
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

// Every actor and tile is a model, so there is nothing to draw until they arrive.
await loadModels('models', (done, total) => showLoading(`${done} / ${total}`))
hideLoading()

const host = new SceneHost(app)
const view = new WorldView(host.scene)
const effects = new Effects(host.scene)
const overlay = new WorldOverlay(overlayRoot, host, (groundItemId) => sim.queue({ kind: 'pickup', itemId: groundItemId }))
const hud = new Hud(
  hudRoot,
  (itemId) => sim.queue({ kind: 'equip', itemId }),
  (nodeId) => sim.queue({ kind: 'allocate_passive', nodeId }),
)
const controls = new Controls(host.renderer.domElement, host)

host.buildTerrain(sim.map)
prewarmShaders(host)
hud.consume(sim.events)
applyUiScale(false)

globalThis.addEventListener('resize', () => host.resize())

const loop = new FrameLoop({ sim, host, view, effects, overlay, hud }, feelEvents)
let previous = performance.now()

function frame(now: number): void {
  const delta = Math.min(0.25, (now - previous) / 1000)
  previous = now

  // Queue a frame's worth of input once; the loop owns the fixed-step clock.
  const { intents, ui } = controls.poll(sim, hud.panelOpen)
  for (const action of ui) hud.handleUi(action)
  for (const intent of intents) sim.queue(intent)
  hud.setScheme(controls.scheme, controls.profile)
  applyUiScale(controls.padConnected)

  loop.advance(delta)
  loop.present(delta, controls.aimPreview)

  requestAnimationFrame(frame)
}

/**
 * Haptics stay sparse: a thump for damage taken, a tick for a crit landed. Rumble
 * on every hit in an ARPG is a blur that stops meaning anything.
 */
function feelEvents(events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.kind === 'player_died') controls.rumble(1, 0.8, 320)
    else if (event.kind === 'level_up') controls.rumble(0.3, 0.6, 220)
    else if (event.kind === 'hit') {
      if (event.targetId === sim.player.id) controls.rumble(0.55, 0.3, 110)
      else if (event.damage.crit && event.sourceId === sim.player.id) controls.rumble(0.12, 0.35, 55)
    }
  }
}

/**
 * A handheld or a couch needs a bigger interface than a desk. A connected pad is
 * the best signal the web gives us; `?ui=1.4` overrides it outright.
 */
function applyUiScale(padConnected: boolean): void {
  const override = Number(new URLSearchParams(globalThis.location.search).get('ui'))
  const scale = Number.isFinite(override) && override > 0 ? override : padConnected ? 1.2 : 1
  const next = `${(16 * scale).toFixed(2)}px`
  if (document.documentElement.style.fontSize !== next) document.documentElement.style.fontSize = next
}

function showLoading(progress: string): void {
  let node = document.getElementById('loading')
  if (!node) {
    node = document.createElement('div')
    node.id = 'loading'
    document.body.append(node)
  }
  node.textContent = `Loading art ${progress}`
}

function hideLoading(): void {
  document.getElementById('loading')?.remove()
}

function readSeed(): number {
  const raw = new URLSearchParams(globalThis.location.search).get('seed')
  const parsed = raw === null ? Number.NaN : Number(raw)
  if (Number.isFinite(parsed)) return parsed
  // A fresh run each load; ?seed=7 reproduces one exactly.
  return Math.floor(Math.random() * 0xffffff)
}

if (import.meta.env.DEV) {
  Object.assign(globalThis, { ashveil: { sim, host, view, controls } })
}

requestAnimationFrame(frame)
