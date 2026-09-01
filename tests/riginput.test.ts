import { describe, expect, it } from 'vitest'
import { buildRigInput, createRigInputOwner, resetRigInput } from '../src/render/riginput'
import { Sim } from '../src/sim/sim'
import { HIT_FLASH_DURATION, type Actor } from '../src/sim/types'

type ActorWithTotals = Actor & { windupTotal: number; recoveryTotal: number }

describe('rig input', () => {
  it('projects every animation signal from deterministic sim state', () => {
    const sim = new Sim({ seed: 7 })
    const actor = sim.player as ActorWithTotals
    actor.state = 'acting'
    actor.activeSkill = 'cleave'
    actor.velocity = { x: 3, y: 4 }
    actor.dash = { direction: { x: 1, y: 0 }, distanceLeft: 2, speed: 12 }
    actor.facing = 1.2
    actor.windup = 0.15
    actor.windupTotal = 0.3
    actor.hitFlash = 0.08
    actor.ailments = [{ kind: 'chilled', magnitude: 0.2, expiresAt: 3, sourceId: 91 }]
    sim.time = 2.5

    const owner = createRigInputOwner()
    owner.lastFacing = 0.7

    expect(buildRigInput(actor, sim, owner)).toEqual({
      state: 'cleave',
      speed: 5,
      dashing: true,
      facingDelta: 0.5,
      phase: { windup: 0.5 },
      hitAge: HIT_FLASH_DURATION - 0.08,
      ailments: actor.ailments,
      time: 2.5,
      seed: actor.id,
      castLeft: 0.15,
      recovering: false,
    })
  })

  it('uses recovery progress after windup ends', () => {
    const sim = new Sim({ seed: 11 })
    const actor = sim.player as ActorWithTotals
    actor.state = 'acting'
    actor.windup = 0
    actor.recovery = 0.15
    actor.recoveryTotal = 0.6

    const input = buildRigInput(actor, sim, createRigInputOwner())

    expect(input.phase).toEqual({ recovery: 0.75 })
    expect(input.castLeft).toBe(0.15)
    expect(input.recovering).toBe(true)
  })

  it('wraps facing delta across positive pi to negative pi', () => {
    const sim = new Sim({ seed: 13 })
    const actor = sim.player as ActorWithTotals
    const owner = createRigInputOwner()
    owner.lastFacing = Math.PI - 0.05
    actor.facing = -Math.PI + 0.05

    expect(buildRigInput(actor, sim, owner).facingDelta).toBeCloseTo(0.1, 12)
  })

  it('mutates the view-owned input rather than allocating each frame', () => {
    const sim = new Sim({ seed: 17 })
    const owner = createRigInputOwner()

    expect(buildRigInput(sim.player, sim, owner)).toBe(buildRigInput(sim.player, sim, owner))
  })

  it('clears stored facing on pool reset', () => {
    const sim = new Sim({ seed: 19 })
    const owner = createRigInputOwner()
    owner.lastFacing = 2
    sim.player.facing = -1

    resetRigInput(owner)

    expect(buildRigInput(sim.player, sim, owner).facingDelta).toBe(0)
  })
})
