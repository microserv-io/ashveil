import type { Effects } from './fx'
import type { WorldOverlay } from './overlay'
import type { SceneHost } from './scene'
import type { WorldView } from './views'
import type { Sim } from '../sim/sim'
import { DT, type EntityId, type SimEvent, type Vec2 } from '../sim/types'
import type { Hud } from '../ui/hud'

/**
 * One frame of the game, minus the things only a real player needs: input,
 * haptics and the wall clock. What is left is the work every host does, which is
 * also the work the frame budget is spent on.
 *
 * It exists as a module so the perf harness can drive the same frame the browser
 * does. A harness with its own loop would drift, and the drift would be silent:
 * the measurements would stay green while the game got slower.
 */

/** Beyond this the host is so far behind that catching up makes it worse. */
const MAX_STEPS_PER_FRAME = 5

export interface FrameParts {
  sim: Sim
  host: SceneHost
  view: WorldView
  effects: Effects
  overlay: WorldOverlay
  hud: Hud
}

/** Structurally satisfied by `Controls.aimPreview`; kept local so the loop owes input nothing. */
export interface AimTarget {
  point: Vec2 | null
  targetId: EntityId | null
}

/** Which part of a frame the time went to. Only the perf harness asks. */
export type FramePhase = 'sync' | 'effects' | 'overlay' | 'hud' | 'render'

export class FrameLoop {
  private accumulator = 0

  constructor(
    private readonly parts: FrameParts,
    /** Presentation the loop does not own: haptics, and anything host-shaped. */
    private readonly onEvents?: (events: readonly SimEvent[]) => void,
    /** Absent in the game: the frame is not instrumented unless something is measuring it. */
    private readonly onPhase?: (phase: FramePhase, ms: number) => void,
  ) {}

  /**
   * Advances the sim by a frame's worth of time on its own fixed clock, so the
   * sim never sees the render rate.
   */
  advance(delta: number): void {
    const { sim } = this.parts
    this.accumulator += delta

    let steps = 0
    while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
      const depthBefore = sim.depth
      sim.tick()
      this.consume(depthBefore)
      this.accumulator -= DT
      steps++
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0
  }

  /** Draws the sim as it currently stands. Reads state, never changes it. */
  present(delta: number, aim: AimTarget): void {
    const { sim, host, view, effects, overlay, hud } = this.parts
    if (!this.onPhase) {
      view.sync(sim, delta)
      view.updateAimIndicator(sim, aim.point, aim.targetId)
      effects.update(delta)
      overlay.update(sim, delta)
      hud.update(sim)
      host.followPlayer(sim.player.pos, delta)
      host.render()
      return
    }

    this.timed('sync', () => {
      view.sync(sim, delta)
      view.updateAimIndicator(sim, aim.point, aim.targetId)
    })
    this.timed('effects', () => effects.update(delta))
    this.timed('overlay', () => overlay.update(sim, delta))
    this.timed('hud', () => hud.update(sim))
    this.timed('render', () => {
      host.followPlayer(sim.player.pos, delta)
      host.render()
    })
  }

  private timed(phase: FramePhase, work: () => void): void {
    const started = performance.now()
    work()
    this.onPhase?.(phase, performance.now() - started)
  }

  private consume(depthBefore: number): void {
    const { sim, host, view, effects, overlay, hud } = this.parts
    const events = sim.events
    if (events.length === 0) return

    effects.consume(sim, events)
    overlay.consume(sim, events)
    hud.consume(events)
    this.onEvents?.(events)

    if (sim.depth !== depthBefore) {
      host.buildTerrain(sim.map)
      view.clearArea()
      overlay.clearArea()
    }
  }
}
