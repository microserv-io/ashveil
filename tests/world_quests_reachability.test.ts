import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPENING_QUESTS } from '../src/quests'
import { createExplorer, moveExplorer } from '../src/world/movement'
import { QUEST_TARGETS } from '../src/world/quest-world-data'
import { SPAWN } from '../src/world/world-data'

describe('safe-bank quest target placement', () => {
  it('keeps quest rules and world target truth host-agnostic', () => {
    const root = join(import.meta.dirname, '..', 'src')
    for (const file of ['quests/types.ts', 'quests/opening-content.ts', 'quests/state.ts', 'quests/projections.ts', 'quests/validation.ts', 'world/quest-world-data.ts']) {
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

  it('walks from spawn to every target through current collision rules', () => {
    for (const target of QUEST_TARGETS) {
      let explorer = createExplorer(SPAWN)
      for (let frame = 0; frame < 1_800; frame += 1) {
        const dx = target.x - explorer.x
        const dz = target.z - explorer.z
        const distance = Math.hypot(dx, dz)
        if (distance <= Math.min(1, target.interactionRadius)) break
        explorer = moveExplorer(explorer, { x: dx / distance, z: dz / distance, sprint: false }, 1 / 60)
      }
      expect(Math.hypot(target.x - explorer.x, target.z - explorer.z), target.id).toBeLessThanOrEqual(Math.min(1, target.interactionRadius))
    }
  })
})
