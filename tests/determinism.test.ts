import { describe, expect, it } from 'vitest'
import { Harness } from '../src/sim/harness'
import { Sim } from '../src/sim/sim'

/** A compact fingerprint of everything a replay would have to reproduce. */
function fingerprint(sim: Sim): string {
  const actors = sim.actors
    .map((a) => `${a.id}:${a.pos.x.toFixed(4)},${a.pos.y.toFixed(4)}:${a.life.toFixed(3)}:${a.state}`)
    .join('|')
  const items = sim.groundItems.map((g) => `${g.id}:${g.item.name}`).join('|')
  return [
    sim.tickCount,
    sim.rng.state,
    sim.monstersKilled,
    sim.progress.xp,
    sim.progress.level,
    sim.depth,
    actors,
    items,
  ].join('#')
}

describe('determinism', () => {
  it('two runs of the same seed are identical tick for tick', () => {
    const a = new Harness({ seed: 12345 })
    const b = new Harness({ seed: 12345 })
    a.run(1800)
    b.run(1800)
    expect(fingerprint(a.sim)).toBe(fingerprint(b.sim))
    expect(a.report()).toEqual(b.report())
  })

  it('different seeds diverge', () => {
    const a = new Harness({ seed: 1 })
    const b = new Harness({ seed: 2 })
    a.run(600)
    b.run(600)
    expect(fingerprint(a.sim)).not.toBe(fingerprint(b.sim))
  })

  it('resuming from a mid-run state continues identically', () => {
    const reference = new Harness({ seed: 99 })
    reference.run(1200)
    const expected = fingerprint(reference.sim)

    const stepwise = new Harness({ seed: 99 })
    for (let i = 0; i < 1200; i++) stepwise.step()
    expect(fingerprint(stepwise.sim)).toBe(expected)
  })
})
