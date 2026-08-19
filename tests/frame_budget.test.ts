import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Harness } from '../src/sim/harness'
import { POLICIES } from '../src/sim/policies'
import { TICK_RATE } from '../src/sim/types'

/**
 * The CPU half of the 60fps question, and the only half that runs without a GPU.
 *
 * A frame has 16.67ms to advance the sim *and* draw it. The draw side needs a real
 * browser and lives in `npm run perf`; this pins the sim side so a pathfinding or
 * AI regression cannot quietly eat the whole budget before anyone opens the game.
 *
 * The ceiling is deliberately loose. This runs on whatever machine CI hands us,
 * next to other tests, so it is a guard against a change of order, not a benchmark.
 */

const FRAME_BUDGET_MS = 1000 / TICK_RATE
/** The sim may not spend more than this share of a frame, leaving the rest to draw. */
const SIM_SHARE_OF_BUDGET = 0.25
const CEILING_MS = FRAME_BUDGET_MS * SIM_SHARE_OF_BUDGET

const SEEDS = [7, 11, 23]
const MEASURED_SECONDS = 45

function tickTimes(seed: number): number[] {
  const harness = new Harness({ seed, policy: POLICIES.brawler! })
  // A cold run measures the JIT warming up, not the game.
  harness.run(TICK_RATE * 5)

  const times: number[] = []
  for (let i = 0; i < TICK_RATE * MEASURED_SECONDS; i++) {
    const started = performance.now()
    harness.step()
    times.push(performance.now() - started)
  }
  return times
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? 0
}

describe('the sim fits inside a 60fps frame', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed} keeps its worst ticks under ${CEILING_MS.toFixed(2)}ms`, () => {
      const times = tickTimes(seed)
      const p99 = percentile(times, 0.99)
      expect(
        p99,
        `seed ${seed}: p99 tick ${p99.toFixed(3)}ms of the ${FRAME_BUDGET_MS.toFixed(2)}ms frame. ` +
          'The sim is meant to leave most of the frame to rendering.',
      ).toBeLessThan(CEILING_MS)
    })
  }
})

/**
 * The scene's light count is baked into every shader program three.js compiles, so a
 * light that comes and goes recompiles all of them mid-fight. That measured 85ms on
 * a frame with a 16.67ms budget, and it is invisible in review: attaching a light to
 * a projectile is the obvious way to write it.
 */
describe('lights never come and go', () => {
  const RENDER = join(import.meta.dirname, '..', 'src', 'render')

  it('only the pool and the scene own a point light', () => {
    const offenders = readdirSync(RENDER)
      .filter((entry) => entry.endsWith('.ts'))
      .filter((entry) => entry !== 'lights.ts' && entry !== 'scene.ts')
      .filter((entry) => /new THREE\.PointLight/.test(readFileSync(join(RENDER, entry), 'utf8')))
    expect(
      offenders,
      'add the light to LightPool in src/render/lights.ts instead: a light that enters or ' +
        'leaves the scene recompiles every shader in it.',
    ).toEqual([])
  })
})

/**
 * The perf harness is only worth trusting while it drives the same frame the player
 * does. Two loops would drift, and the drift would be invisible: the numbers would
 * stay green while the game got slower.
 */
describe('the perf harness measures the real frame', () => {
  const ROOT = join(import.meta.dirname, '..')
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

  it('the game and the harness both drive FrameLoop', () => {
    for (const entry of ['src/main.ts', 'perf/main.ts']) {
      expect(read(entry), `${entry} must drive the shared loop, not a copy of it`).toMatch(
        /from '(\.\.\/src)?\.?\/render\/loop'/,
      )
    }
  })
})
