import { describe, expect, it, vi } from 'vitest'
import {
  ATTACK_SECONDS,
  HOME,
  MAX_FRAME_DELTA,
  ROAM_RADIUS,
  WanderingWolfController,
  type WolfOccupancy,
} from '../src/world/wandering-wolf'
import { canOccupy } from '../src/world/movement'

function trace(controller: WanderingWolfController, seconds: number, frame = 1 / 60) {
  const samples = []
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += frame) {
    controller.advance(Math.min(frame, seconds - elapsed))
    samples.push(controller.snapshot())
  }
  return samples
}

describe('ambient wandering wolf', () => {
  it('replays the same seeded trace after reset and across controllers', () => {
    const first = new WanderingWolfController({ seed: 0x51f15e })
    const second = new WanderingWolfController({ seed: 0x51f15e })
    const expected = trace(first, 9)
    expect(trace(second, 9)).toEqual(expected)
    first.reset()
    expect(trace(first, 9)).toEqual(expected)
  })

  it('attacks after three to seven non-attack seconds, freezes for exactly one second, then resumes walking', () => {
    const wolf = new WanderingWolfController({ seed: 7 })
    let nonAttackSeconds = 0
    while (wolf.state.action !== 'attack') {
      wolf.advance(1 / 60)
      nonAttackSeconds += 1 / 60
      expect(nonAttackSeconds).toBeLessThanOrEqual(7 + 1 / 60)
    }
    expect(nonAttackSeconds).toBeGreaterThanOrEqual(3)
    const anchor = wolf.snapshot().position
    for (let tick = 0; tick < 59; tick += 1) {
      wolf.advance(1 / 60)
      expect(wolf.state.action).toBe('attack')
      expect(wolf.snapshot().position).toEqual(anchor)
    }
    wolf.advance(1 / 60)
    expect(wolf.state.action).toBe('walk')
    expect(wolf.state.attackCount).toBe(1)
    expect(wolf.state.actionTime).toBe(0)
    expect(ATTACK_SECONDS).toBe(1)
  })

  it('stays grounded, occupiable, and inside its home radius while validating the whole route', () => {
    const heightAt = (x: number, z: number) => x * 0.01 + z * 0.02
    const occupancy = vi.fn((from: WolfOccupancy, x: number, z: number) => (
      Math.hypot(x - HOME.x, z - HOME.z) <= ROAM_RADIUS + 1e-9
      && Math.hypot(x - from.x, z - from.z) <= 0.2 + 1e-9
    ))
    const wolf = new WanderingWolfController({ seed: 31, heightAt, canOccupy: occupancy })
    for (const state of trace(wolf, 20)) {
      expect(Math.hypot(state.position.x - HOME.x, state.position.z - HOME.z)).toBeLessThanOrEqual(ROAM_RADIUS + 1e-8)
      expect(state.position.y).toBe(heightAt(state.position.x, state.position.z))
    }
    expect(occupancy).toHaveBeenCalled()
  })

  it('uses occupiable routes in the actual first-zone terrain', () => {
    const wolf = new WanderingWolfController({ seed: 47 })
    let previous: WolfOccupancy = { x: wolf.state.x, z: wolf.state.z, radius: 0.7 }
    for (const state of trace(wolf, 30)) {
      expect(canOccupy(previous, state.position.x, state.position.z)).toBe(true)
      previous = { x: state.position.x, z: state.position.z, radius: 0.7 }
    }
  })

  it('clamps a short goal without overshoot and bounds retries when every candidate is blocked', () => {
    const short = new WanderingWolfController({ seed: 1, roamRadius: 0.001, speed: 0.5 })
    trace(short, 1)
    expect(Math.hypot(short.state.x - HOME.x, short.state.z - HOME.z)).toBeLessThanOrEqual(0.001 + 1e-9)

    const blocked = vi.fn(() => false)
    const trapped = new WanderingWolfController({ seed: 2, canOccupy: blocked })
    expect(blocked).toHaveBeenCalledTimes(8)
    trapped.advance(0.1)
    expect(blocked).toHaveBeenCalledTimes(8)
    trace(trapped, 0.5)
    expect(blocked.mock.calls.length).toBeLessThanOrEqual(16)
    expect(trapped.state.action).toBe('walk')
  })

  it('abandons a route when occupancy changes after selection', () => {
    let blocked = false
    const occupancy = vi.fn(() => !blocked)
    const wolf = new WanderingWolfController({ seed: 13, canOccupy: occupancy })
    const selectedCalls = occupancy.mock.calls.length
    blocked = true
    const start = wolf.snapshot().position
    wolf.advance(1 / 60)
    expect(wolf.snapshot().position).toEqual(start)
    expect(occupancy).toHaveBeenCalledTimes(selectedCalls + 1)
    wolf.advance(0.1)
    expect(occupancy).toHaveBeenCalledTimes(selectedCalls + 1)
  })

  it('uses fixed ticks, retains sub-frame time, and clamps large rendered frames', () => {
    const single = new WanderingWolfController({ seed: 19 })
    const chunked = new WanderingWolfController({ seed: 19 })
    single.advance(0.1)
    for (let index = 0; index < 10; index += 1) chunked.advance(0.01)
    expect(chunked.snapshot()).toEqual(single.snapshot())

    const clamped = new WanderingWolfController({ seed: 19 })
    clamped.advance(4)
    expect(clamped.snapshot()).toEqual(single.snapshot())
    expect(MAX_FRAME_DELTA).toBe(0.1)
  })
})
