import { describe, expect, it } from 'vitest'
import { createTwoBoneChain, solveTwoBone, type TwoBoneChain } from '../src/render/procedural/ik'
import { quatLength, quatRotate } from '../src/render/procedural/quat'

const UPPER = 0.45
const LOWER = 0.42

const out = new Float32Array(8)
const rotated = new Float32Array(3)
const end = new Float32Array(3)
const mid = new Float32Array(3)

function chainDown(): TwoBoneChain {
  const chain = createTwoBoneChain()
  chain.upperLength = UPPER
  chain.lowerLength = LOWER
  chain.restUpper.set([0, -1, 0])
  chain.restLower.set([0, -1, 0])
  chain.root.set([0, 0.9, 0])
  chain.pole.set([0, 0, 1])
  return chain
}

/** Where the solved chain actually puts its middle and end joints. */
function resolve(chain: TwoBoneChain): void {
  quatRotate(out, 0, chain.restUpper[0]!, chain.restUpper[1]!, chain.restUpper[2]!, rotated)
  for (let axis = 0; axis < 3; axis++) mid[axis] = chain.root[axis]! + rotated[axis]! * chain.upperLength
  quatRotate(out, 4, chain.restLower[0]!, chain.restLower[1]!, chain.restLower[2]!, rotated)
  for (let axis = 0; axis < 3; axis++) end[axis] = mid[axis]! + rotated[axis]! * chain.lowerLength
}

function distanceToTarget(chain: TwoBoneChain): number {
  return Math.hypot(end[0]! - chain.target[0]!, end[1]! - chain.target[1]!, end[2]! - chain.target[2]!)
}

describe('two-bone analytic IK', () => {
  it('hits a reachable target', () => {
    const chain = chainDown()
    for (const target of [
      [0, 0.12, 0.3],
      [0.1, 0.15, -0.25],
      [0, 0.2, 0],
      [0.3, 0.4, 0.2],
    ] as const) {
      chain.target.set(target)
      solveTwoBone(chain, out, 0, 4)
      resolve(chain)
      expect(distanceToTarget(chain), target.join(',')).toBeLessThan(1e-5)
    }
  })

  it('keeps both bones at their fixed lengths', () => {
    const chain = chainDown()
    chain.target.set([0.2, 0.1, 0.35])
    solveTwoBone(chain, out, 0, 4)
    resolve(chain)
    const upper = Math.hypot(mid[0]! - chain.root[0]!, mid[1]! - chain.root[1]!, mid[2]! - chain.root[2]!)
    expect(upper).toBeCloseTo(UPPER, 5)
    expect(Math.hypot(end[0]! - mid[0]!, end[1]! - mid[1]!, end[2]! - mid[2]!)).toBeCloseTo(LOWER, 5)
  })

  it('clamps an unreachable target to a straight chain pointing at it', () => {
    const chain = chainDown()
    chain.target.set([0, -4, 2])
    solveTwoBone(chain, out, 0, 4)
    resolve(chain)
    const dx = chain.target[0]! - chain.root[0]!
    const dy = chain.target[1]! - chain.root[1]!
    const dz = chain.target[2]! - chain.root[2]!
    const length = Math.hypot(dx, dy, dz)
    const reach = UPPER + LOWER
    expect(end[0]).toBeCloseTo(chain.root[0]! + (dx / length) * reach, 5)
    expect(end[1]).toBeCloseTo(chain.root[1]! + (dy / length) * reach, 5)
    expect(end[2]).toBeCloseTo(chain.root[2]! + (dz / length) * reach, 5)
  })

  it('bends the middle joint toward the pole', () => {
    const chain = chainDown()
    chain.target.set([0, 0.15, 0.1])
    for (const pole of [
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
    ] as const) {
      chain.pole.set(pole)
      solveTwoBone(chain, out, 0, 4)
      resolve(chain)
      // The mid joint's offset from the straight root-to-target line follows the pole.
      const along = [
        chain.target[0]! - chain.root[0]!,
        chain.target[1]! - chain.root[1]!,
        chain.target[2]! - chain.root[2]!,
      ]
      const length = Math.hypot(along[0]!, along[1]!, along[2]!)
      const offset = [0, 1, 2].map((axis) => mid[axis]! - chain.root[axis]!)
      const projection = (offset[0]! * along[0]! + offset[1]! * along[1]! + offset[2]! * along[2]!) / (length * length)
      const lateral = [0, 1, 2].map((axis) => offset[axis]! - projection * along[axis]!)
      const towardPole = lateral[0]! * pole[0] + lateral[1]! * pole[1] + lateral[2]! * pole[2]
      expect(towardPole, pole.join(',')).toBeGreaterThan(0.01)
    }
  })

  it('survives a pole parallel to the chain', () => {
    const chain = chainDown()
    chain.target.set([0, 0.2, 0])
    chain.pole.set([0, -1, 0])
    solveTwoBone(chain, out, 0, 4)
    expect(quatLength(out, 0)).toBeCloseTo(1, 5)
    expect(quatLength(out, 4)).toBeCloseTo(1, 5)
    resolve(chain)
    expect(distanceToTarget(chain)).toBeLessThan(1e-5)
  })

  it('survives a target on the chain root', () => {
    const chain = chainDown()
    chain.target.set([...chain.root])
    solveTwoBone(chain, out, 0, 4)
    for (let i = 0; i < 8; i++) expect(Number.isFinite(out[i]!)).toBe(true)
    expect(quatLength(out, 0)).toBeCloseTo(1, 5)
  })

  it('never returns NaN over a grid of random targets', () => {
    const chain = chainDown()
    let seed = 1337
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let i = 0; i < 10_000; i++) {
      chain.target.set([(next() - 0.5) * 4, (next() - 0.5) * 4, (next() - 0.5) * 4])
      chain.pole.set([next() - 0.5, next() - 0.5, next() - 0.5])
      solveTwoBone(chain, out, 0, 4)
      for (let j = 0; j < 8; j++) {
        if (!Number.isFinite(out[j]!)) throw new Error(`NaN at iteration ${i}, target ${[...chain.target]}`)
      }
      expect(quatLength(out, 0)).toBeCloseTo(1, 4)
      expect(quatLength(out, 4)).toBeCloseTo(1, 4)
    }
  })

  it('serves an arm chain out of a T-pose', () => {
    const chain = createTwoBoneChain()
    chain.upperLength = 0.24
    chain.lowerLength = 0.33
    chain.restUpper.set([1, 0, 0])
    chain.restLower.set([1, 0, 0])
    chain.root.set([0.21, 1.1, 0])
    chain.pole.set([0.3, 0, -1])
    chain.target.set([0.26, 0.65, 0.12])
    solveTwoBone(chain, out, 0, 4)
    resolve(chain)
    expect(distanceToTarget(chain)).toBeLessThan(1e-5)
    expect(mid[2]).toBeLessThan(0.05)
  })
})
