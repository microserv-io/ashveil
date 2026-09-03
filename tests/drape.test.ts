import { runInNewContext } from 'node:vm'
import { setFlagsFromString } from 'node:v8'
import { describe, expect, it } from 'vitest'
import {
  createDrapeRoot,
  createDrapeState,
  DRAPE,
  resetDrapeState,
  stepDrape,
  type DrapeParams,
  type DrapeRoot,
} from '../src/render/drape'
import { CAPSULE, createDrapeColliders, type DrapeColliders } from '../src/render/drapecollide'

/**
 * The pendulum on its own, with no skeleton under it.
 *
 * Cloth is judged by eye, but the two things that make it read as cloth are
 * numbers: it settles rather than ringing forever, and it leans by the amount the
 * body's own acceleration says it should. Both are asserted here against closed
 * forms, so a damping or gravity change has to justify itself.
 */

const DT = 1 / 60
const SEGMENT = 0.25

function params(segments = 1, segmentLength = SEGMENT): DrapeParams {
  return { segments, segmentLength, reach: segmentLength, clearance: 0.01 }
}

/** Steps for `seconds` with the root standing still, or moving as `move` says. */
function run(
  state: ReturnType<typeof createDrapeState>,
  shape: DrapeParams,
  seconds: number,
  move: (root: DrapeRoot, at: number) => void = () => {},
): void {
  const root = createDrapeRoot()
  for (let frame = 0; frame * DT < seconds; frame++) {
    move(root, frame * DT)
    stepDrape(state, shape, root, DT)
  }
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI
}

describe('a drape released from an angle', () => {
  it('settles under a degree within four seconds', () => {
    const state = createDrapeState(1)
    state.swing[0] = (30 * Math.PI) / 180
    run(state, params(), 4)
    expect(Math.abs(degrees(state.swing[0]!))).toBeLessThan(1)
    expect(Math.abs(state.swingRate[0]!)).toBeLessThan(0.1)
  })

  /** Cloth that snapped straight back would read as rubber, not as fabric. */
  it('swings through the bottom rather than creeping back to it', () => {
    const state = createDrapeState(1)
    state.swing[0] = (30 * Math.PI) / 180
    let crossed = false
    for (let frame = 0; frame < 120; frame++) {
      stepDrape(state, params(), createDrapeRoot(), DT)
      if (state.swing[0]! < 0) crossed = true
    }
    expect(crossed, 'the release must overshoot the vertical').toBe(true)
  })

  it('settles the whole chain, not only the segment that was moved', () => {
    const state = createDrapeState(3)
    state.swing.fill((25 * Math.PI) / 180)
    state.side.fill((-15 * Math.PI) / 180)
    run(state, params(3), 6)
    for (let at = 0; at < 3; at++) {
      expect(Math.abs(degrees(state.swing[at]!)), `segment ${at}`).toBeLessThan(1)
      expect(Math.abs(degrees(state.side[at]!)), `segment ${at}`).toBeLessThan(1)
    }
  })
})

/**
 * The equilibrium of a pendulum whose pivot is driven: the rod lines up with the pull
 * on it, so the angle off the vertical is the sideways part of that pull over the
 * downward part. The sideways part is the root's acceleration plus the drag of the
 * air the cloth is pulled through, and both are asserted here because both are what
 * makes a cape read as a cape.
 */
describe('a drape behind a body that is moving', () => {
  /** Steady speed, no acceleration at all: the trail is the drag term on its own. */
  it('trails by the angle a steady walk asks for', () => {
    for (const speed of [1.6, 3, 5]) {
      const state = createDrapeState(1)
      run(state, params(), 6, (root, at) => {
        root.z = speed * at
      })
      const expected = degrees(Math.atan((DRAPE.drag * speed) / DRAPE.gravity))
      expect(degrees(state.swing[0]!), `${speed} m/s`).toBeCloseTo(expected, 0)
    }
  })

  /**
   * Speeding up adds the acceleration on top of the drag. The angle chases the
   * standing answer for the speed it has reached rather than arriving at it, so
   * what is pinned is that the acceleration term is there and is the right size.
   */
  it('leans further while the body is still speeding up', () => {
    const metres = 1.5
    const state = createDrapeState(1)
    run(state, params(), 3, (root, at) => {
      root.z = 0.5 * metres * at * at
    })
    const speed = metres * 3
    const dragged = degrees(Math.atan((DRAPE.drag * speed) / DRAPE.gravity))
    const driven = degrees(Math.atan((metres + DRAPE.drag * speed) / DRAPE.gravity))
    expect(degrees(state.swing[0]!)).toBeGreaterThan(dragged)
    expect(driven - degrees(state.swing[0]!), 'trailing a rising drive by a couple of degrees').toBeLessThan(3)
  })

  /** Massless segments hang in a line under a steady pull; the whip is transient. */
  it('carries the whole chain to the same angle', () => {
    const state = createDrapeState(3)
    run(state, params(3), 6, (root, at) => {
      root.z = 3 * at
    })
    const expected = degrees(Math.atan((DRAPE.drag * 3) / DRAPE.gravity))
    for (let at = 0; at < 3; at++) expect(degrees(state.swing[at]!), `segment ${at}`).toBeCloseTo(expected, 0)
  })

  /** Sideways is the same pendulum about the `toward` axis, and must not mix in. */
  it('reads sideways motion on the side angle and not on the swing', () => {
    const state = createDrapeState(1)
    run(state, params(), 6, (root, at) => {
      root.x = 2 * at
    })
    expect(Math.abs(degrees(state.swing[0]!))).toBeLessThan(0.5)
    expect(Math.abs(degrees(state.side[0]!))).toBeCloseTo(degrees(Math.atan((DRAPE.drag * 2) / DRAPE.gravity)), 0)
  })

  /** The travel the clip gate feeds a walking body arrives as velocity, not position. */
  it('takes a root velocity the position does not carry', () => {
    const state = createDrapeState(1)
    const root = createDrapeRoot()
    for (let frame = 0; frame < 360; frame++) {
      root.vz = 1.6
      stepDrape(state, params(), root, DT)
    }
    expect(degrees(state.swing[0]!)).toBeCloseTo(degrees(Math.atan((DRAPE.drag * 1.6) / DRAPE.gravity)), 0)
  })
})

/**
 * Gravity is what a drape hangs by, so it has to be measured against where the chain
 * now hangs rather than where it was fitted. A shoulder that rolls forward carries
 * the rest line with it, and the cloth swings back toward the vertical — as far as
 * the cone allows, which is what stops a corpse's cloak diving through its own back.
 */
describe('a drape whose attach bone has turned', () => {
  /** The rest line tipped back, so hanging down again is a swing away from the body. */
  function tipped(degreesOff: number): DrapeRoot {
    const root = createDrapeRoot()
    const turn = (degreesOff * Math.PI) / 180
    root.rest.set([0, -Math.cos(turn), Math.sin(turn)])
    root.away.set([0, -Math.sin(turn), -Math.cos(turn)])
    return root
  }

  it('swings back to the vertical when the cone allows it', () => {
    const state = createDrapeState(1)
    const root = tipped(20)
    for (let frame = 0; frame < 360; frame++) stepDrape(state, params(), root, DT)
    expect(degrees(state.swing[0]!), 'hanging straight down again').toBeCloseTo(20, 0)
  })

  it('stops at the cone rather than following gravity through the body', () => {
    const state = createDrapeState(1)
    const root = tipped(85)
    for (let frame = 0; frame < 360; frame++) stepDrape(state, params(), root, DT)
    expect(state.swing[0]!).toBeCloseTo(DRAPE.awayLimit, 5)
  })

  /** Nothing to correct when the bone has not turned: the chain must sit still. */
  it('leaves an upright chain exactly where it was fitted', () => {
    const state = createDrapeState(1)
    for (let frame = 0; frame < 360; frame++) stepDrape(state, params(), createDrapeRoot(), DT)
    expect(state.swing[0]).toBe(0)
    expect(state.side[0]).toBe(0)
  })
})

/**
 * The limits stop a drape swinging into the body. They cannot stop the body walking
 * into the drape, and that is the failure the clip gate actually reports: a thigh
 * sweeping through cloth that is hanging exactly where it was fitted. Only the limb
 * itself can move it, so the limb is in the solve.
 */
describe('a drape against the limbs it hangs beside', () => {
  /** A capsule standing where a thigh would, straight down from the chain's root. */
  function capsules(...limbs: readonly (readonly [number, number, number, number, number, number, number])[]) {
    const colliders = createDrapeColliders(limbs.length)
    limbs.forEach((limb, at) => colliders.capsules.set(limb, at * CAPSULE))
    colliders.count = limbs.length
    return colliders
  }

  /** How far the chain's tip sits from a capsule's axis, given its angles. */
  function tipFrom(state: ReturnType<typeof createDrapeState>, shape: DrapeParams, root: DrapeRoot): number {
    let x = root.localX
    let y = root.localY
    let z = root.localZ
    for (let at = 0; at < shape.segments; at++) {
      const swing = state.swing[at]!
      const side = state.side[at]!
      for (const [axis, add] of [[0, (v: number) => (x += v)], [1, (v: number) => (y += v)],
        [2, (v: number) => (z += v)]] as const) {
        add(shape.reach * (root.rest[axis]! * Math.cos(swing) * Math.cos(side)
          + root.away[axis]! * Math.sin(swing) * Math.cos(side) + root.side[axis]! * Math.sin(side)))
      }
    }
    return Math.hypot(x, z)
  }

  const RADIUS = 0.09

  it('ends up outside a limb it was left hanging inside', () => {
    const shape = params(2)
    const state = createDrapeState(2)
    const root = createDrapeRoot()
    // The chain hangs straight down the capsule's own axis: fully inside it.
    const limbs = capsules([0, 1, 0, 0, 0, 0, RADIUS])
    root.localY = 1
    for (let frame = 0; frame < 240; frame++) stepDrape(state, shape, root, DT, limbs)
    expect(tipFrom(state, shape, root)).toBeGreaterThan(RADIUS + shape.clearance - 1e-3)
  })

  it('is pushed by a limb sweeping through it, and swings back when it passes', () => {
    const shape = params(2)
    const state = createDrapeState(2)
    const root = createDrapeRoot()
    const limbs = capsules([0, 1, 0.4, 0, 0, 0.4, RADIUS])
    root.localY = 1
    for (let frame = 0; frame < 120; frame++) stepDrape(state, shape, root, DT, limbs)
    expect(Math.abs(degrees(state.swing[0]!)), 'clear of the chain to start with').toBeLessThan(1)

    // The limb sweeps forward onto the chain, then away again.
    for (let frame = 0; frame < 60; frame++) {
      const z = 0.4 - (frame / 60) * 0.45
      limbs.capsules[2] = z
      limbs.capsules[5] = z
      stepDrape(state, shape, root, DT, limbs)
    }
    // The limb comes from the front, so the cloth is shoved to the back: a swing away.
    const shoved = degrees(state.swing[0]!)
    expect(shoved, 'the limb has to have moved the cloth').toBeGreaterThan(1)

    limbs.capsules[2] = 2
    limbs.capsules[5] = 2
    for (let frame = 0; frame < 240; frame++) stepDrape(state, shape, root, DT, limbs)
    expect(Math.abs(degrees(state.swing[0]!)), 'and it has to hang again once it passes').toBeLessThan(1)
  })

  it('leaves a chain that clears every limb exactly where it was', () => {
    const shape = params(2)
    const state = createDrapeState(2)
    const root = createDrapeRoot()
    const limbs = capsules([0, 1, 0.6, 0, 0, 0.6, RADIUS])
    root.localY = 1
    for (let frame = 0; frame < 240; frame++) stepDrape(state, shape, root, DT, limbs)
    expect(state.swing[0]).toBe(0)
    expect(state.side[0]).toBe(0)
  })
})

describe('the limits', () => {
  it('never swings further into the body than the toward limit', () => {
    const state = createDrapeState(2)
    run(state, params(2), 4, (root, at) => {
      root.z = -0.5 * 40 * at * at
    })
    for (let at = 0; at < 2; at++) {
      expect(state.swing[at]!).toBeGreaterThanOrEqual(-DRAPE.towardLimit - 1e-6)
    }
  })

  it('holds the away and side limits and stops dead at them', () => {
    const state = createDrapeState(2)
    run(state, params(2), 4, (root, at) => {
      root.x = 0.5 * 60 * at * at
      root.z = 0.5 * 60 * at * at
    })
    for (let at = 0; at < 2; at++) {
      expect(state.swing[at]!).toBeLessThanOrEqual(DRAPE.awayLimit + 1e-6)
      expect(Math.abs(state.side[at]!)).toBeLessThanOrEqual(DRAPE.sideLimit + 1e-6)
    }
    expect(state.swingRate[0]).toBe(0)
  })
})

describe('determinism and allocation', () => {
  it('gives the same swing for the same inputs', () => {
    const sample = (): number[] => {
      const state = createDrapeState(3)
      run(state, params(3), 2, (root, at) => {
        root.x = Math.sin(at * 5) * 0.3
        root.yaw = at
      })
      return [...state.swing, ...state.side]
    }
    expect(sample()).toEqual(sample())
  })

  /** A body that turns has moved its drape, even standing still: the yaw says so. */
  it('reads a turn on the spot as motion', () => {
    const state = createDrapeState(1)
    run(state, params(), 2, (root, at) => {
      root.x = Math.cos(at * 3) * 0.2
      root.z = Math.sin(at * 3) * 0.2
      root.yaw = at * 3
    })
    expect(Math.hypot(degrees(state.swing[0]!), degrees(state.side[0]!))).toBeGreaterThan(1)
  })

  it('forgets where the root was when it is reset', () => {
    const state = createDrapeState(2)
    run(state, params(2), 1, (root, at) => {
      root.z = at * 2
    })
    resetDrapeState(state)
    expect([...state.swing, ...state.side, ...state.root]).toEqual(new Array(4 + 9).fill(0))
    expect(state.tracked).toBe(false)

    // A reset root must not read the jump back to the origin as a lurch.
    stepDrape(state, params(2), createDrapeRoot(), DT)
    expect(state.swing[0]).toBe(0)
  })

  it('allocates nothing on the frame path', () => {
    const state = createDrapeState(3)
    const shape = params(3)
    const root = createDrapeRoot()
    const limbs: DrapeColliders = createDrapeColliders(6)
    limbs.count = 6
    for (let limb = 0; limb < 6; limb++) {
      limbs.capsules.set([limb * 0.05, 1, 0.1, limb * 0.05, 0.4, 0.1, 0.08], limb * CAPSULE)
    }
    const walk = (times: number): void => {
      for (let frame = 0; frame < times; frame++) {
        root.x = Math.sin(frame * DT) * 0.2
        stepDrape(state, shape, root, DT, limbs)
      }
    }
    walk(20_000)
    collect()
    const before = process.memoryUsage().heapUsed
    walk(100_000)
    collect()
    const grown = process.memoryUsage().heapUsed - before
    expect(grown, `heap grew ${(grown / 1024).toFixed(0)} kB over 100k steps`).toBeLessThan(256 * 1024)
  })
})

/**
 * Without a real collection `heapUsed` only reports nursery garbage that has not
 * been swept yet, which is megabytes whether or not the step path allocates.
 */
function collect(): void {
  setFlagsFromString('--expose-gc')
  ;(runInNewContext('gc') as () => void)()
  setFlagsFromString('--no-expose-gc')
}
