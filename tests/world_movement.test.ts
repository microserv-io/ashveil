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
import { LANDMARKS, PATHS, SPAWN } from '../src/world/world-data'
import { heightAt, riverCenterAt, riverHalfWidthAt, WORLD_BOUNDS } from '../src/world/terrain'
import { compileZone } from '../src/world/zone-compiler'
import { DEFAULT_ZONE, mapToWorld } from '../src/world/zone-default'
import type { CompiledZone } from '../src/world/zone-types'

function openingRegionReachesRefuge(zone: CompiledZone): boolean {
  const landing = zone.landmarks.find((landmark) => landmark.id === 'safe-landing')!
  const refuge = zone.landmarks.find((landmark) => landmark.id === 'refuge')!
  const corners = [mapToWorld(500, 40), mapToWorld(850, 235)]
  const bounds = {
    minX: Math.min(corners[0]!.x, corners[1]!.x), maxX: Math.max(corners[0]!.x, corners[1]!.x),
    minZ: Math.min(corners[0]!.z, corners[1]!.z), maxZ: Math.max(corners[0]!.z, corners[1]!.z),
  }
  const step = 5
  const columns = Math.floor((bounds.maxX - bounds.minX) / step) + 1
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / step) + 1
  const cell = (x: number, z: number) => [
    Math.max(0, Math.min(columns - 1, Math.round((x - bounds.minX) / step))),
    Math.max(0, Math.min(rows - 1, Math.round((z - bounds.minZ) / step))),
  ] as const
  const point = (column: number, row: number) => ({ x: bounds.minX + column * step, z: bounds.minZ + row * step })
  const [startColumn, startRow] = cell(landing.x, landing.z)
  const [targetColumn, targetRow] = cell(refuge.x, refuge.z)
  const pending: (readonly [number, number])[] = [[startColumn, startRow]]
  const visited = new Set([startRow * columns + startColumn])
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const [column, row] = pending[cursor]!
    const from = point(column, row)
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nextColumn = column + dx
      const nextRow = row + dz
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue
      const key = nextRow * columns + nextColumn
      if (visited.has(key)) continue
      const to = point(nextColumn, nextRow)
      if (!zone.canOccupyPoint(to.x, to.z, 0.72)
        || !zone.canOccupyPoint((from.x + to.x) * 0.5, (from.z + to.z) * 0.5, 0.72)) continue
      visited.add(key)
      pending.push([nextColumn, nextRow])
    }
  }
  return visited.has(targetRow * columns + targetColumn)
}

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
    const abutment = LANDMARKS.find((landmark) => landmark.id === 'bridge-abutment')!
    const edge = riverCenterAt(abutment.z) - riverHalfWidthAt(abutment.z)
    let explorer = createExplorer({ x: edge - 8, z: abutment.z - 8 })
    for (let i = 0; i < 180; i += 1) {
      explorer = moveExplorer(explorer, { x: 1, z: 0.35, sprint: true }, 1 / 60)
    }
    expect(explorer.x + explorer.radius).toBeLessThanOrEqual(
      riverCenterAt(explorer.z) - riverHalfWidthAt(explorer.z) + 0.001,
    )
    expect(Math.hypot(explorer.x - abutment.x, explorer.z - abutment.z)).toBeGreaterThanOrEqual(4 + explorer.radius)
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

  it('traverses every authored path continuously under real movement collision', () => {
    for (const path of PATHS) {
      let explorer = createExplorer(path.points[0]!)
      for (const target of path.points.slice(1)) for (let frame = 0; frame < 30_000; frame += 1) {
        const dx = target.x - explorer.x
        const dz = target.z - explorer.z
        const distance = Math.hypot(dx, dz)
        if (distance < 1e-6) break
        const delta = Math.min(1 / 60, distance / RUN_SPEED)
        const next = moveExplorer(explorer, { x: dx / distance, z: dz / distance, sprint: false }, delta)
        expect(Math.hypot(next.x - explorer.x, next.z - explorer.z), `${path.id} stalled`).toBeGreaterThan(0)
        explorer = next
      }
      expect(Math.hypot(explorer.x - path.points.at(-1)!.x, explorer.z - path.points.at(-1)!.z), path.id).toBeLessThan(0.001)
    }
  })

  it('runs the full main road continuously in five minutes without resetting explorer state', () => {
    const routeIds = ['refuge-road', 'lower-road', 'waystation-descent']
    let explorer = createExplorer(PATHS.find((path) => path.id === routeIds[0])!.points[0]!)
    let elapsed = 0
    for (const path of routeIds.map((id) => PATHS.find((path) => path.id === id)!)) {
      for (const target of path.points.slice(1)) {
        for (let frame = 0; frame < 30_000; frame += 1) {
          const dx = target.x - explorer.x
          const dz = target.z - explorer.z
          const distance = Math.hypot(dx, dz)
          if (distance < 1e-6) break
          const delta = Math.min(1 / 60, distance / RUN_SPEED)
          const next = moveExplorer(explorer, { x: dx / distance, z: dz / distance, sprint: false }, delta)
          expect(Math.hypot(next.x - explorer.x, next.z - explorer.z)).toBeGreaterThan(0)
          explorer = next
          elapsed += delta
        }
      }
    }
    const waystation = LANDMARKS.find((landmark) => landmark.id === 'waystation')!
    expect(Math.hypot(explorer.x - waystation.x, explorer.z - waystation.z)).toBeLessThan(0.001)
    expect(elapsed).toBeGreaterThanOrEqual(285)
    expect(elapsed).toBeLessThanOrEqual(315)
  })

  it('starts at Safe Landing and reaches the refuge only by following the authored approach', () => {
    const landing = LANDMARKS.find((landmark) => landmark.id === 'safe-landing')!
    const refuge = LANDMARKS.find((landmark) => landmark.id === 'refuge')!
    expect(SPAWN).toEqual({ x: landing.x + 86, z: landing.z })

    const path = PATHS.find((candidate) => candidate.id === 'landing-road')!
    let explorer = createExplorer(SPAWN)
    for (const target of [...path.points].reverse()) for (let frame = 0; frame < 30_000; frame += 1) {
      const dx = target.x - explorer.x
      const dz = target.z - explorer.z
      const distance = Math.hypot(dx, dz)
      if (distance < 1e-6) break
      const next = moveExplorer(explorer, { x: dx / distance, z: dz / distance, sprint: false }, Math.min(1 / 60, distance / RUN_SPEED))
      expect(Math.hypot(next.x - explorer.x, next.z - explorer.z), 'landing road stalled').toBeGreaterThan(0)
      explorer = next
    }
    expect(Math.hypot(explorer.x - refuge.x, explorer.z - refuge.z)).toBeLessThan(0.001)

    explorer = createExplorer(SPAWN)
    for (let frame = 0; frame < 12_000; frame += 1) {
      const dx = refuge.x - explorer.x
      const dz = refuge.z - explorer.z
      const distance = Math.hypot(dx, dz)
      const next = moveExplorer(explorer, { x: dx / distance, z: dz / distance, sprint: true, jump: frame % 90 === 0 }, 1 / 60)
      if (Math.hypot(next.x - explorer.x, next.z - explorer.z) < 1e-8 && frame > 300) break
      explorer = next
    }
    expect(Math.hypot(explorer.x - refuge.x, explorer.z - refuge.z)).toBeGreaterThan(100)
  })

  it('has no landing-to-refuge shortcut inside the opening region north of the road entry', () => {
    expect(openingRegionReachesRefuge(compileZone(DEFAULT_ZONE))).toBe(false)
    const withoutBluff = {
      ...DEFAULT_ZONE,
      terrain: { ...DEFAULT_ZONE.terrain,
        landforms: DEFAULT_ZONE.terrain.landforms!.filter((landform) => landform.id !== 'refuge-west-bluff') },
    }
    expect(openingRegionReachesRefuge(compileZone(withoutBluff))).toBe(true)
  })

  it('keeps the full authored road width grounded and traversable', () => {
    for (const path of PATHS) for (let segment = 1; segment < path.points.length; segment += 1) {
      const from = path.points[segment - 1]!
      const to = path.points[segment]!
      const length = Math.hypot(to.x - from.x, to.z - from.z)
      const normal = { x: -(to.z - from.z) / length, z: (to.x - from.x) / length }
      for (const side of [-1, 0, 1]) {
        const point = { x: (from.x + to.x) * 0.5 + normal.x * path.width * 0.45 * side,
          z: (from.z + to.z) * 0.5 + normal.z * path.width * 0.45 * side }
        const explorer = createExplorer({ x: (from.x + to.x) * 0.5, z: (from.z + to.z) * 0.5 })
        expect(canOccupy(explorer, point.x, point.z), `${path.id} side ${side}`).toBe(true)
      }
    }
  })

  it.each([
    ['north river join', [600, 100], [460, 0], 'north'],
    ['south river join', [550, 760], [410, 850], 'south'],
    ['north-east mountain join', [1400, 100], [1520, 0], 'east'],
    ['south-east mountain join', [1400, 760], [1520, 850], 'east'],
  ] as const)('seals the %s before the invisible outer guard', (_name, startPixel, targetPixel, edge) => {
    const start = mapToWorld(startPixel[0], startPixel[1])
    const target = mapToWorld(targetPixel[0], targetPixel[1])
    const dx = target.x - start.x
    const dz = target.z - start.z
    const length = Math.hypot(dx, dz)
    let explorer = createExplorer(start)
    for (let frame = 0; frame < 4_000; frame += 1) {
      explorer = moveExplorer(explorer, { x: dx / length, z: dz / length, sprint: true }, 1 / 60)
    }
    if (edge === 'north') expect(WORLD_BOUNDS.maxZ - explorer.z).toBeGreaterThan(20)
    if (edge === 'south') expect(explorer.z - WORLD_BOUNDS.minZ).toBeGreaterThan(20)
    if (edge === 'east') expect(explorer.x - WORLD_BOUNDS.minX).toBeGreaterThan(20)
  })
})
