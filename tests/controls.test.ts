import { describe, expect, it } from 'vitest'
import { Sim } from '../src/sim/sim'
import { AIM_DEADZONE, aimPoint, applyDeadzone, assistCone, softTarget, type Targetable } from '../src/sim/targeting'
import { TICK_RATE } from '../src/sim/types'

function candidate(id: number, x: number, y: number, dead = false): Targetable {
  return { id, pos: { x, y }, radius: 0.4, dead }
}

describe('deadzone', () => {
  it('rests at zero and rescales the usable range', () => {
    expect(applyDeadzone({ x: 0.1, y: 0 }, 0.2)).toEqual({ x: 0, y: 0 })
    // At full deflection the output is still full, not clipped by the deadzone.
    const full = applyDeadzone({ x: 1, y: 0 }, 0.2)
    expect(full.x).toBeCloseTo(1)
    // Just past the threshold the output starts near zero rather than jumping.
    const edge = applyDeadzone({ x: 0.21, y: 0 }, 0.2)
    expect(edge.x).toBeGreaterThan(0)
    expect(edge.x).toBeLessThan(0.05)
  })

  it('is radial, so a diagonal flick is not clipped per axis', () => {
    const diagonal = applyDeadzone({ x: 0.15, y: 0.15 }, 0.2)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeGreaterThan(0)
  })
})

describe('soft targeting', () => {
  const options = { range: 10, coneDegrees: 120 }

  it('prefers what you are facing over what is marginally closer', () => {
    const ahead = candidate(1, 5, 0)
    const besideButCloser = candidate(2, 0.6, 4)
    const picked = softTarget([besideButCloser, ahead], { x: 0, y: 0 }, 0, options)
    expect(picked?.id).toBe(ahead.id)
  })

  it('ignores anything behind the cone', () => {
    const behind = candidate(1, -5, 0)
    expect(softTarget([behind], { x: 0, y: 0 }, 0, options)).toBeNull()
  })

  it('ignores the dead and the out-of-range', () => {
    expect(softTarget([candidate(1, 3, 0, true)], { x: 0, y: 0 }, 0, options)).toBeNull()
    expect(softTarget([candidate(2, 40, 0)], { x: 0, y: 0 }, 0, options)).toBeNull()
  })

  it('gives melee a near-full circle so a swing does not whiff', () => {
    expect(assistCone('melee_arc')).toBeGreaterThan(assistCone('projectile'))
  })
})

describe('aim resolution', () => {
  const origin = { x: 0, y: 0 }

  it('an explicit stick beats assistance', () => {
    const target = candidate(1, 0, 5)
    const aim = aimPoint(origin, 0, { x: 1, y: 0 }, 10, target)
    expect(aim.x).toBeCloseTo(10)
    expect(aim.y).toBeCloseTo(0)
  })

  it('a resting stick falls through to the soft target', () => {
    const target = candidate(1, 3, 4)
    const aim = aimPoint(origin, 0, { x: AIM_DEADZONE * 0.5, y: 0 }, 10, target)
    expect(aim).toEqual({ x: 3, y: 4 })
  })

  it('with neither, it fires straight ahead rather than nowhere', () => {
    const aim = aimPoint(origin, Math.PI / 2, null, 8, null)
    expect(aim.x).toBeCloseTo(0)
    expect(aim.y).toBeCloseTo(8)
  })
})

describe('direct movement', () => {
  it('moves the player without a path', () => {
    const sim = new Sim({ seed: 4 })
    const start = { ...sim.player.pos }
    for (let i = 0; i < 30; i++) {
      sim.queue({ kind: 'move_direction', direction: { x: 1, y: 0 } })
      sim.tick()
    }
    expect(sim.player.pos.x).toBeGreaterThan(start.x)
    expect(sim.player.path).toHaveLength(0)
  })

  it('stops when the host stops sending input', () => {
    const sim = new Sim({ seed: 4 })
    for (let i = 0; i < 20; i++) {
      sim.queue({ kind: 'move_direction', direction: { x: 1, y: 0 } })
      sim.tick()
    }
    for (let i = 0; i < 20; i++) sim.tick()
    const settled = { ...sim.player.pos }
    for (let i = 0; i < 20; i++) sim.tick()
    expect(sim.player.pos.x).toBeCloseTo(settled.x, 5)
    expect(sim.player.moveDirection).toBeNull()
  })

  it('scales speed with stick magnitude', () => {
    const walk = travelled({ x: 0.4, y: 0 })
    const run = travelled({ x: 1, y: 0 })
    expect(run).toBeGreaterThan(walk * 2)
  })

  it('keeps facing independent of travel, so strafing works', () => {
    const sim = new Sim({ seed: 4 })
    const start = { ...sim.player.pos }
    for (let i = 0; i < 30; i++) {
      sim.queue({ kind: 'move_direction', direction: { x: 1, y: 0 }, facing: Math.PI })
      sim.tick()
    }
    expect(sim.player.pos.x).toBeGreaterThan(start.x)
    expect(Math.abs(sim.player.facing)).toBeCloseTo(Math.PI, 3)
  })

  it('cancels a click-to-move path the moment a stick is pushed', () => {
    const sim = new Sim({ seed: 4 })
    sim.queue({ kind: 'move', to: sim.map.portal })
    sim.tick()
    expect(sim.player.path.length).toBeGreaterThan(0)

    sim.queue({ kind: 'move_direction', direction: { x: 0, y: 1 } })
    sim.tick()
    expect(sim.player.path).toHaveLength(0)
    expect(sim.player.moveTarget).toBeNull()
  })

  it('slides along a wall instead of sticking to it', () => {
    const sim = new Sim({ seed: 4 })
    // Drive hard into a corner for a while; the body must never leave the floor.
    for (let i = 0; i < 4 * TICK_RATE; i++) {
      sim.queue({ kind: 'move_direction', direction: { x: -1, y: -1 } })
      sim.tick()
    }
    expect(Number.isFinite(sim.player.pos.x)).toBe(true)
    expect(sim.player.life).toBeGreaterThan(0)
  })
})

function travelled(direction: { x: number; y: number }): number {
  const sim = new Sim({ seed: 4 })
  const start = { ...sim.player.pos }
  for (let i = 0; i < 30; i++) {
    sim.queue({ kind: 'move_direction', direction })
    sim.tick()
  }
  return Math.hypot(sim.player.pos.x - start.x, sim.player.pos.y - start.y)
}

describe('sim-side aim resolution', () => {
  it('snaps a melee swing onto a monster the player is facing', () => {
    const sim = new Sim({ seed: 4 })
    const monster = sim.monsters()[0]!
    sim.player.pos = { x: monster.pos.x - 1.5, y: monster.pos.y }
    sim.player.facing = 0

    const { target, aim } = sim.aimFor(sim.player, 'cleave', null)
    expect(target?.id).toBe(monster.id)
    expect(aim).toEqual({ x: monster.pos.x, y: monster.pos.y })
  })

  it('respects an explicit stick over the nearby monster', () => {
    const sim = new Sim({ seed: 4 })
    const monster = sim.monsters()[0]!
    sim.player.pos = { x: monster.pos.x - 1.5, y: monster.pos.y }
    sim.player.facing = 0

    const { aim } = sim.aimFor(sim.player, 'firebolt', { x: 0, y: -1 })
    expect(aim.y).toBeLessThan(sim.player.pos.y)
  })
})
