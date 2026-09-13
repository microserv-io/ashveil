import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPENING_QUESTS } from '../src/quests'
import { canOccupy, createExplorer, moveExplorer, type Explorer } from '../src/world/movement'
import { QUEST_STAGING, QUEST_TARGETS } from '../src/world/quest-world-data'
import { LANDMARKS, PATHS, SPAWN } from '../src/world/world-data'
import { getActiveZone } from '../src/world/zone-active'

function walkTo(explorer: Explorer, destination: { readonly x: number; readonly z: number }): Explorer {
  const startingDistance = Math.hypot(destination.x - explorer.x, destination.z - explorer.z)
  for (let frame = 0; frame < Math.ceil(startingDistance * 60 + 300); frame += 1) {
    const dx = destination.x - explorer.x
    const dz = destination.z - explorer.z
    const distance = Math.hypot(dx, dz)
    if (distance <= 1) return explorer
    explorer = moveExplorer(explorer, { x: dx / distance, z: dz / distance, sprint: false }, 1 / 60)
  }
  return explorer
}

describe('safe-bank quest target placement', () => {
  it('keeps quest rules and world target truth host-agnostic', () => {
    const root = join(import.meta.dirname, '..', 'src')
    for (const file of ['quests/types.ts', 'quests/opening-content.ts', 'quests/state.ts', 'quests/projections.ts', 'quests/validation.ts', 'world/quest-staging.ts', 'world/quest-world-data.ts']) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).not.toMatch(/from ['"]three|\b(document|window|performance|indexedDB)\b|\.\.\/(sim|render|ui|session|net)\//)
    }
  })

  it('places every playable objective and NPC target exactly once', () => {
    const required = new Set(OPENING_QUESTS.filter((quest) => quest.status === 'playable')
      .flatMap((quest) => [quest.giverId, quest.turnInId, ...quest.objectives.flatMap((objective) => objective.targetIds)]))
    const placed = QUEST_TARGETS.filter((target) => required.has(target.id))
    expect(new Set(placed.map((target) => target.id))).toEqual(required)
    expect(placed).toHaveLength(required.size)
  })

  it('keeps landing rescues on the bank and refuge care work at the haven', () => {
    const landingIds = [
      'npc_mara', 'npc_tavi', 'rescue_ties', 'scuffed_plank', 'willow_branch_1', 'willow_branch_2',
      'survivor_willow', 'rescue_line_footing', 'survivor_ferry_post', 'npc_seli', 'seli_continue',
      'npc_ferryman', 'survivor_driftwood', 'satchel_reeds_1', 'satchel_reeds_2', 'satchel_reeds_3',
      'reed_flash_1', 'reed_flash_2', 'reed_flash_3', 'tin_thrush',
    ].sort()
    const refugeIds = [
      'npc_iven', 'warm_cup', 'patient_wrap_1', 'patient_wrap_2', 'patient_wrap_3',
      'meal_recipient_1', 'meal_recipient_2', 'npc_family', 'family_name_1', 'family_name_2',
      'blue_cloth_roll_1', 'blue_cloth_roll_2', 'damp_bedding_1', 'damp_bedding_2',
      'damp_bedding_3', 'drying_line_1', 'drying_line_2', 'drying_line_3', 'npc_edda',
      'covered_water_barrel', 'root_cutter_1', 'root_cutter_2', 'root_cutter_3', 'root_cutter_4',
      'water_pump', 'notice_board_title', 'notice_board_hooks',
    ].sort()
    expect(QUEST_STAGING.filter((placement) => placement.landmarkId === 'safe-landing').map(({ id }) => id).sort()).toEqual(landingIds)
    expect(QUEST_STAGING.filter((placement) => placement.landmarkId === 'refuge').map(({ id }) => id).sort()).toEqual(refugeIds)
  })

  it('places the player at Safe Landing near Mara without starting in interaction range', () => {
    const landing = LANDMARKS.find((landmark) => landmark.id === 'safe-landing')!
    const mara = QUEST_TARGETS.find((target) => target.id === 'npc_mara')!
    expect(SPAWN).toEqual({ x: landing.x + 86, z: landing.z })
    expect(Math.hypot(mara.x - SPAWN.x, mara.z - SPAWN.z)).toBeCloseTo(5)
    expect(Math.hypot(mara.x - SPAWN.x, mara.z - SPAWN.z)).toBeGreaterThan(mara.interactionRadius)
  })

  it('stages every target at its named landmark and a reachable dry approach', () => {
    const zone = getActiveZone()
    expect(new Set(QUEST_STAGING.map((placement) => placement.id)).size).toBe(QUEST_TARGETS.length)
    for (const target of QUEST_TARGETS) {
      const staging = QUEST_STAGING.find((placement) => placement.id === target.id)!
      const home = LANDMARKS.find((landmark) => landmark.id === staging.landmarkId)!
      expect(staging, target.id).toBeDefined()
      expect(home, target.id).toBeDefined()
      expect(target, target.id).toMatchObject({ x: home.x + staging.offset.x, z: home.z + staging.offset.z })
      expect(zone.isWaterAt(target.x, target.z, 0.72), target.id).toBe(false)
      if (target.kind !== 'prop') expect(canOccupy(createExplorer(target), target.x, target.z), target.id).toBe(true)
      const approaches = Array.from({ length: 16 }, (_, index) => {
        const angle = index * Math.PI / 8
        const radius = Math.min(1, target.interactionRadius * 0.5)
        return { x: target.x + Math.cos(angle) * radius, z: target.z + Math.sin(angle) * radius }
      })
      expect(approaches.some((point) => zone.canOccupyPoint(point.x, point.z, 0.72)), target.id).toBe(true)
    }
  })

  it('walks the authored landing road from spawn to every refuge target', () => {
    const landingRoad = PATHS.find((path) => path.id === 'landing-road')!
    let atRefuge = createExplorer(SPAWN)
    for (const waypoint of [...landingRoad.points].reverse()) {
      atRefuge = walkTo(atRefuge, waypoint)
      expect(Math.hypot(waypoint.x - atRefuge.x, waypoint.z - atRefuge.z), 'landing-road').toBeLessThanOrEqual(1)
    }
    for (const target of QUEST_TARGETS) {
      const staging = QUEST_STAGING.find((placement) => placement.id === target.id)!
      if (staging.landmarkId !== 'refuge') continue
      let explorer = atRefuge
      if (target.id.startsWith('notice_board_')) {
        const refuge = LANDMARKS.find((landmark) => landmark.id === 'refuge')!
        explorer = walkTo(explorer, { x: refuge.x, z: refuge.z - 16 })
        explorer = walkTo(explorer, { x: refuge.x - 22, z: refuge.z - 16 })
      }
      explorer = walkTo(explorer, target)
      expect(Math.hypot(target.x - explorer.x, target.z - explorer.z), target.id).toBeLessThanOrEqual(Math.min(1, target.interactionRadius))
    }
  })

  it('walks from spawn to every landing target through current collision rules', () => {
    for (const target of QUEST_TARGETS) {
      const staging = QUEST_STAGING.find((placement) => placement.id === target.id)!
      if (staging.landmarkId !== 'safe-landing') continue
      const explorer = walkTo(createExplorer(SPAWN), target)
      expect(Math.hypot(target.x - explorer.x, target.z - explorer.z), target.id).toBeLessThanOrEqual(Math.min(1, target.interactionRadius))
    }
  })

  it('keeps the playable landing activity readable along the living bank', () => {
    const zone = getActiveZone()
    const landing = LANDMARKS.find((landmark) => landmark.id === 'safe-landing')!
    const refuge = LANDMARKS.find((landmark) => landmark.id === 'refuge')!
    const mara = QUEST_TARGETS.find((target) => target.id === 'npc_mara')!
    const bankTargets = QUEST_TARGETS.filter((target) => QUEST_STAGING.find((placement) => placement.id === target.id)?.context === 'living-bank')
    expect(mara).toMatchObject({ x: landing.x + 81, z: landing.z })
    expect(Math.hypot(refuge.x - mara.x, refuge.z - mara.z)).toBeGreaterThan(400)
    const shoreClearances = bankTargets.map((target) => zone.riverCenterAt(target.z) - zone.riverHalfWidthAt(target.z) - target.x)
    expect(Math.min(...shoreClearances)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...shoreClearances)).toBeLessThanOrEqual(25.1)
    expect(Math.max(...bankTargets.map((target) => target.z)) - Math.min(...bankTargets.map((target) => target.z))).toBeGreaterThanOrEqual(30)
  })
})
