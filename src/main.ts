import './style.css'
import { Effects } from './render/fx'
import { Controls } from './render/input'
import { WorldOverlay } from './render/overlay'
import { SceneHost } from './render/scene'
import { WorldView } from './render/views'
import { Sim } from './sim/sim'
import { DT, type SimEvent } from './sim/types'
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
const controls = new Controls(host.renderer.domElement, host)

host.buildTerrain(sim.map)
hud.consume(sim.events)
applyUiScale(false)

globalThis.addEventListener('resize', () => host.resize())

const MAX_STEPS_PER_FRAME = 5
let accumulator = 0
let previous = performance.now()

function frame(now: number): void {
  const delta = Math.min(0.25, (now - previous) / 1000)
  previous = now

  // Queue a frame's worth of input once, then advance the sim on its own fixed
  // clock. The sim never sees the render rate.
  const { intents, ui } = controls.poll(sim, hud.panelOpen)
  for (const action of ui) hud.handleUi(action)
  for (const intent of intents) sim.queue(intent)
  hud.setScheme(controls.scheme, controls.profile)
  applyUiScale(controls.padConnected)

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
  view.updateAimIndicator(sim, controls.aimPreview.point, controls.aimPreview.targetId)
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
  feelEvents(events)

  if (sim.depth !== depthBefore) {
    host.buildTerrain(sim.map)
    view.clearArea()
    overlay.clearArea()
  }
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
