import { describe, expect, it } from 'vitest'
import {
  canOccupy,
  createExplorer,
  GRAVITY,
  JUMP_PREPARATION_SECONDS,
  JUMP_SPEED,
  MAX_FRAME_DELTA,
  moveExplorer,
  RUN_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
} from '../src/world/movement'
import { PATHS, SPAWN } from '../src/world/world-data'
import { heightAt, riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from '../src/world/terrain'

describe('first-zone movement', () => {
  it('substeps a long frame and caps elapsed time', () => {
    const explorer = createExplorer(SPAWN)
    const moved = moveExplorer(explorer, { x: 1, z: 0, sprint: true }, 2)
    expect(moved.x - explorer.x).toBeLessThanOrEqual(SPRINT_SPEED * MAX_FRAME_DELTA + 0.001)
    expect(moved.y).toBeCloseTo(heightAt(moved.x, moved.z), 10)
  })

  it('uses distinct walk, default run, and sprint paces', () => {
    const explorer = createExplorer({ x: -70, z: -70 })
    const walked = moveExplorer(explorer, { x: 1, z: 0, sprint: false, walk: true }, MAX_FRAME_DELTA)
    const ran = moveExplorer(explorer, { x: 1, z: 0, sprint: false }, MAX_FRAME_DELTA)
    const sprinted = moveExplorer(explorer, { x: 1, z: 0, sprint: true }, MAX_FRAME_DELTA)
    expect(walked.x - explorer.x).toBeCloseTo(WALK_SPEED * MAX_FRAME_DELTA)
    expect(ran.x - explorer.x).toBeCloseTo(RUN_SPEED * MAX_FRAME_DELTA)
    expect(sprinted.x - explorer.x).toBeCloseTo(SPRINT_SPEED * MAX_FRAME_DELTA)
  })

  it('holds a grounded anticipation phase without resetting on repeated jump input', () => {
    let explorer = createExplorer({ x: -70, z: -70 })
    const ground = explorer.groundY
    explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false, jump: true }, 1 / 60)
    expect(explorer).toMatchObject({ grounded: true, jumpPhase: 'preparing', verticalVelocity: 0, y: ground })
    expect(explorer.jumpPreparationRemaining).toBeCloseTo(JUMP_PREPARATION_SECONDS - 1 / 60)

    const repeated = moveExplorer(explorer, { x: 0, z: 0, sprint: false, jump: true }, 1 / 60)
    expect(repeated.jumpPhase).toBe('preparing')
    expect(repeated.jumpPreparationRemaining).toBeCloseTo(JUMP_PREPARATION_SECONDS - 2 / 60)
    expect(repeated.y).toBe(ground)
  })

  it.each([1 / 120, 1 / 60, 1 / 30])('takes off after exactly 0.18 seconds with %.4f second frames', (delta) => {
    let explorer = createExplorer({ x: -70, z: -70 })
    const ground = explorer.groundY
    let elapsed = 0
    let jump = true
    while (elapsed + delta < JUMP_PREPARATION_SECONDS) {
      explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false, jump }, delta)
      elapsed += delta
      jump = false
      expect(explorer.jumpPhase).toBe('preparing')
      expect(explorer.grounded).toBe(true)
      expect(explorer.y).toBe(ground)
    }
    explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false }, JUMP_PREPARATION_SECONDS - elapsed)
    expect(explorer).toMatchObject({ grounded: false, jumpPhase: 'ascending', jumpPreparationRemaining: 0 })
    expect(explorer.y).toBeCloseTo(ground)
    expect(explorer.verticalVelocity).toBeCloseTo(JUMP_SPEED)
  })

  it('keeps horizontal control during preparation, then lands and accepts a new jump', () => {
    let explorer = createExplorer({ x: -70, z: -70 })
    const ground = explorer.groundY
    explorer = moveExplorer(explorer, { x: 1, z: 0, sprint: false, jump: true }, 0.1)
    expect(explorer.jumpPhase).toBe('preparing')
    expect(explorer.x).toBeCloseTo(-70 + RUN_SPEED * 0.1)
    explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false }, 0.1)
    expect(explorer.grounded).toBe(false)
    expect(explorer.jumpPhase).toBe('ascending')
    expect(explorer.y).toBeGreaterThan(ground)

    for (let frame = 0; frame < 120 && !explorer.grounded; frame += 1) {
      explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false }, 1 / 60)
    }
    expect(explorer.grounded).toBe(true)
    expect(explorer.jumpPhase).toBe('landing')
    expect(explorer.verticalVelocity).toBe(0)
    expect(explorer.y).toBeCloseTo(heightAt(explorer.x, explorer.z), 10)
    const preparedAgain = moveExplorer(explorer, { x: 0, z: 0, sprint: false, jump: true }, 1 / 60)
    expect(preparedAgain.jumpPhase).toBe('preparing')
    expect(preparedAgain.grounded).toBe(true)
  })

  it('crosses the apex once and rejects airborne jump edges', () => {
    let explorer = moveExplorer(createExplorer({ x: -70, z: -70 }),
      { x: 0, z: 0, sprint: false, jump: true }, MAX_FRAME_DELTA)
    explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false }, JUMP_PREPARATION_SECONDS - MAX_FRAME_DELTA)
    let peak = explorer.y
    while (explorer.jumpPhase === 'ascending') {
      const beforeVelocity = explorer.verticalVelocity
      explorer = moveExplorer(explorer, { x: 0, z: 0, sprint: false, jump: true }, 1 / 60)
      expect(explorer.verticalVelocity).toBeLessThan(beforeVelocity)
      peak = Math.max(peak, explorer.y)
    }
    expect(explorer.jumpPhase).toBe('descending')
    expect(peak - explorer.groundY).toBeCloseTo(JUMP_SPEED ** 2 / (2 * GRAVITY), 2)
  })

  it('clamps stalled frames while preparing and follows gravity after takeoff', () => {
    const explorer = createExplorer({ x: -70, z: -70 })
    const preparing = moveExplorer(explorer, { x: 0, z: 0, sprint: false, jump: true }, 2)
    expect(preparing).toMatchObject({ grounded: true, jumpPhase: 'preparing' })
    expect(preparing.jumpPreparationRemaining).toBeCloseTo(JUMP_PREPARATION_SECONDS - MAX_FRAME_DELTA)
    const jumped = moveExplorer(preparing, { x: 0, z: 0, sprint: false }, 2)
    const airborneSeconds = MAX_FRAME_DELTA - preparing.jumpPreparationRemaining
    expect(jumped.y - explorer.y).toBeCloseTo(JUMP_SPEED * airborneSeconds - 0.5 * GRAVITY * airborneSeconds ** 2, 5)
    expect(jumped.verticalVelocity).toBeCloseTo(JUMP_SPEED - GRAVITY * airborneSeconds, 5)
  })

  it('keeps collision, river and bounds restrictions while airborne', () => {
    const z = 4
    const edge = riverCenterAt(z) - riverHalfWidthAt(z)
    let explorer = moveExplorer(createExplorer({ x: edge - 3, z: z - 3 }),
      { x: 0, z: 0, sprint: false, jump: true }, 1 / 60)
    for (let frame = 0; frame < 40; frame += 1) {
      explorer = moveExplorer(explorer, { x: 1, z: 1, sprint: true }, 1 / 60)
    }
    const localEdge = riverCenterAt(explorer.z) - riverHalfWidthAt(explorer.z)
    expect(explorer.x + explorer.radius).toBeLessThanOrEqual(localEdge + 0.001)

    const corner = moveExplorer(
      { ...createExplorer({ x: WORLD_BOUNDS.minX + 2, z: WORLD_BOUNDS.minZ + 2 }), grounded: false,
        jumpPhase: 'descending' as const, verticalVelocity: -1, y: 10 },
      { x: -1, z: -1, sprint: true },
      MAX_FRAME_DELTA,
    )
    expect(corner.x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + corner.radius)
    expect(corner.z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + corner.radius)

    const open = createExplorer({ x: -70, z: -70 })
    const airborne = { ...open, y: open.y + 50, grounded: false, jumpPhase: 'descending' as const, verticalVelocity: -1 }
    expect(canOccupy(airborne, open.x + 0.1, open.z, [
      { id: 'airborne-blocker', x: open.x + 0.5, z: open.z, radius: 1 },
    ])).toBe(false)
  })

  it('blocks diagonal entry into the river', () => {
    const z = 4
    const edge = riverCenterAt(z) - riverHalfWidthAt(z)
    let explorer = createExplorer({ x: edge - 3, z: z - 3 })
    for (let i = 0; i < 40; i += 1) {
      explorer = moveExplorer(explorer, { x: 1, z: 1, sprint: true }, 1 / 30)
    }
    const localEdge = riverCenterAt(explorer.z) - riverHalfWidthAt(explorer.z)
    expect(explorer.x + explorer.radius).toBeLessThanOrEqual(localEdge + 0.001)
  })

  it('blocks an angled attempt across the broken span', () => {
    let explorer = createExplorer({ x: -2, z: -86 })
    for (let i = 0; i < 180; i += 1) {
      explorer = moveExplorer(explorer, { x: 1, z: 0.35, sprint: true }, 1 / 60)
    }
    expect(explorer.x + explorer.radius).toBeLessThanOrEqual(
      riverCenterAt(explorer.z) - riverHalfWidthAt(explorer.z) + 0.001,
    )
    expect(Math.hypot(explorer.x - 5, explorer.z + 80)).toBeGreaterThanOrEqual(4 + explorer.radius)
    expect(canOccupy(createExplorer({ x: -20, z: -76 }), -19.5, -76.2)).toBe(true)
  })

  it('blocks diagonal escape through the world corner', () => {
    let explorer = createExplorer({ x: WORLD_BOUNDS.minX + 2, z: WORLD_BOUNDS.minZ + 2 })
    for (let i = 0; i < 40; i += 1) {
      explorer = moveExplorer(explorer, { x: -1, z: -1, sprint: true }, 1 / 30)
    }
    expect(explorer.x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + explorer.radius)
    expect(explorer.z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + explorer.radius)
  })

  it('keeps dense route centerlines clear for the controller', () => {
    for (const path of PATHS) {
      for (let segment = 1; segment < path.points.length; segment += 1) {
        const from = path.points[segment - 1]!
        const to = path.points[segment]!
        const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z))
        let explorer = createExplorer(from)
        for (let step = 1; step <= steps; step += 1) {
          const point = { x: from.x + (to.x - from.x) * step / steps, z: from.z + (to.z - from.z) * step / steps }
          expect(canOccupy(explorer, point.x, point.z), `${path.id} blocked at ${point.x},${point.z}`).toBe(true)
          explorer = createExplorer(point)
        }
      }
    }
  })
})
