import '../src/style.css'
import { Effects } from '../src/render/fx'
import { FrameLoop, type FramePhase } from '../src/render/loop'
import { loadModels } from '../src/render/models'
import { readMotionMode, type MotionMode } from '../src/render/motionmode'
import { prewarmShaders } from '../src/render/prewarm'
import { WorldOverlay } from '../src/render/overlay'
import { SceneHost } from '../src/render/scene'
import { WorldView } from '../src/render/views'
import { POLICIES } from '../src/sim/policies'
import { Sim } from '../src/sim/sim'
import { DT } from '../src/sim/types'
import { Hud } from '../src/ui/hud'

/**
 * Plays the game against itself and reports what each frame cost.
 *
 * Two things make this a regression test rather than a benchmark. The clock is
 * fixed at `DT`, so the bot walks the identical run every time and the workload
 * cannot drift with the frame rate. And the run reports a fingerprint of what it
 * actually played, so a comparison against a stale baseline is caught as an
 * invalid measurement instead of being reported as a regression.
 *
 * `scripts/perf.mjs` drives this in real Chrome and reads `__ashveilPerf`.
 */

/** Shader compilation and model upload are not the steady state a player sees. */
const WARMUP_FRAMES = 180
const DEFAULT_FRAMES = 2400
/** Matches the headless harness, so both measure a bot with human-ish reactions. */
const DECISION_INTERVAL = 3

export type { MotionMode }

export interface FramePerf {
  seed: number
  policy: string
  motion: MotionMode
  frames: number
  viewport: { width: number; height: number; pixelRatio: number }
  renderer: string
  softwareRasterised: boolean
  /** Milliseconds of CPU inside the frame: the part of the budget we control. */
  advanceMs: Percentiles
  presentMs: Percentiles
  frameMs: Percentiles
  /** Wall clock between frames. Informational: the compositor paces this, not us. */
  presentedDeltaMs: Percentiles
  scene: { drawCalls: number; triangles: number; worstDrawCalls: number }
  /** How often the frame missed 60fps at all, which is the question being asked. */
  overBudget: { count: number; share: number }
  /** The worst offenders, with the tick they landed on, so a hitch can be chased down. */
  worstFrames: {
    tick: number
    ms: number
    drawCalls: number
    monsters: number
    spawned: number
    phases: Record<FramePhase, number>
    programs: number
    heapMb: number
    depth: number
  }[]
  /** What the bot actually played. A change here invalidates the comparison. */
  workload: { motion: MotionMode; ticks: number; depth: number; monstersKilled: number; level: number; deaths: number }
}

export interface Percentiles {
  p50: number
  p95: number
  p99: number
  max: number
}

const params = new URLSearchParams(globalThis.location.search)
const seed = Number(params.get('seed') ?? 7)
const frameTarget = Number(params.get('frames') ?? DEFAULT_FRAMES)
const policy = POLICIES[params.get('policy') ?? 'brawler'] ?? POLICIES.brawler!
// The same flag the bodies read, so the report can never name a mode it did not play.
const motion: MotionMode = readMotionMode(globalThis.location.search)

const app = document.getElementById('app')!
const overlayRoot = document.createElement('div')
overlayRoot.id = 'overlay'
const hudRoot = document.createElement('div')
hudRoot.id = 'hud'
document.body.append(overlayRoot, hudRoot)

const sim = new Sim({ seed })
await loadModels('models')

const host = new SceneHost(app)
const view = new WorldView(host.scene)
const effects = new Effects(host.scene)
const overlay = new WorldOverlay(overlayRoot, host, (itemId) => sim.queue({ kind: 'pickup', itemId }))
const hud = new Hud(
  hudRoot,
  (itemId) => sim.queue({ kind: 'equip', itemId }),
  (nodeId) => sim.queue({ kind: 'allocate_passive', nodeId }),
)
const phase: Record<FramePhase, number> = { sync: 0, effects: 0, overlay: 0, hud: 0, render: 0 }
const loop = new FrameLoop({ sim, host, view, effects, overlay, hud }, undefined, (name, ms) => {
  phase[name] = ms
})

host.buildTerrain(sim.map)
prewarmShaders(host)
hud.consume(sim.events)

const advanceTimes: number[] = []
const presentTimes: number[] = []
const frameTimes: number[] = []
const deltas: number[] = []
const drawCalls: number[] = []
const triangles: number[] = []
const samples: {
  tick: number
  ms: number
  drawCalls: number
  monsters: number
  spawned: number
  phases: Record<FramePhase, number>
  programs: number
  heapMb: number
  depth: number
}[] = []
const seenActors = new Set<number>()

const FRAME_BUDGET_MS = 1000 / 60

let deaths = 0
let frames = 0
let previous = performance.now()

function frame(): void {
  const now = performance.now()
  const delta = now - previous
  previous = now

  if (sim.tickCount % DECISION_INTERVAL === 0) {
    for (const intent of policy.decide(sim)) sim.queue(intent)
  }

  const beforeAdvance = performance.now()
  loop.advance(DT)
  const afterAdvance = performance.now()
  for (const event of sim.events) if (event.kind === 'player_died') deaths++
  loop.present(DT, { point: sim.player.pos, targetId: null })
  const afterPresent = performance.now()

  frames++
  if (frames > WARMUP_FRAMES) {
    advanceTimes.push(afterAdvance - beforeAdvance)
    presentTimes.push(afterPresent - afterAdvance)
    frameTimes.push(afterPresent - beforeAdvance)
    deltas.push(delta)
    drawCalls.push(host.renderer.info.render.calls)
    triangles.push(host.renderer.info.render.triangles)
    samples.push({
      tick: sim.tickCount,
      ms: round(afterPresent - beforeAdvance),
      drawCalls: host.renderer.info.render.calls,
      monsters: liveMonsters(),
      spawned: countNewActors(),
      phases: { ...phase },
      programs: host.renderer.info.programs?.length ?? 0,
      heapMb: heapMb(),
      depth: sim.depth,
    })
  }

  if (frames < WARMUP_FRAMES + frameTarget) requestAnimationFrame(frame)
  else publish()
}

function publish(): void {
  const gl = host.renderer.getContext()
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(
    debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  )

  const report: FramePerf = {
    seed,
    policy: policy.name,
    motion,
    frames: frameTimes.length,
    viewport: {
      width: host.renderer.domElement.clientWidth,
      height: host.renderer.domElement.clientHeight,
      pixelRatio: host.renderer.getPixelRatio(),
    },
    renderer,
    softwareRasterised: /llvmpipe|swiftshader|softpipe|software/i.test(renderer),
    advanceMs: percentiles(advanceTimes),
    presentMs: percentiles(presentTimes),
    frameMs: percentiles(frameTimes),
    presentedDeltaMs: percentiles(deltas),
    scene: {
      drawCalls: Math.round(median(drawCalls)),
      triangles: Math.round(median(triangles)),
      worstDrawCalls: Math.max(...drawCalls),
    },
    overBudget: {
      count: samples.filter((sample) => sample.ms > FRAME_BUDGET_MS).length,
      // Not rounded to milliseconds' precision: one frame in 2400 is a real number.
      share: samples.filter((sample) => sample.ms > FRAME_BUDGET_MS).length / (samples.length || 1),
    },
    worstFrames: [...samples].sort((a, b) => b.ms - a.ms).slice(0, 12),
    workload: {
      motion,
      ticks: sim.tickCount,
      depth: sim.depth,
      monstersKilled: sim.monstersKilled,
      level: sim.progress.level,
      deaths,
    },
  }

  Object.assign(globalThis, { __ashveilPerf: report })
  const done = document.createElement('div')
  done.id = 'perf-done'
  done.textContent = JSON.stringify(report)
  document.body.append(done)
}

/** A sawtooth here is garbage collection, which is what a periodic spike usually is. */
function heapMb(): number {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : 0
}

/** How many actors were drawn for the first time this frame, which is when their view is built. */
function countNewActors(): number {
  let fresh = 0
  for (const actor of sim.actors) {
    if (seenActors.has(actor.id)) continue
    seenActors.add(actor.id)
    fresh++
  }
  return fresh
}

/** Counted by hand: the harness must not add garbage to the frame it is measuring. */
function liveMonsters(): number {
  let count = 0
  for (const actor of sim.actors) if (actor.kind === 'monster' && !actor.dead) count++
  return count
}

function percentiles(values: readonly number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: round(at(sorted, 0.5)),
    p95: round(at(sorted, 0.95)),
    p99: round(at(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
  }
}

function at(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? 0
}

function median(values: readonly number[]): number {
  return at([...values].sort((a, b) => a - b), 0.5)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

requestAnimationFrame(frame)
