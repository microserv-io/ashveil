import { describe, expect, it } from 'vitest'
import { createQuestState, openingQuestResolver, reduceQuestIntent, type CharacterQuestState } from '../src/quests'
import { MemoryQuestStateRepository } from '../src/persistence'
import { selectQuestInteraction } from '../src/world/quest-controller'
import { WorldQuestHost } from '../src/world/quest-host'
import { QUEST_TARGETS, questTarget } from '../src/world/quest-world-data'
import { createExplorer } from '../src/world/movement'

const at = (targetId: string): { x: number; z: number } => {
  const target = questTarget(targetId)
  if (!target) throw new Error(`missing test target ${targetId}`)
  return target
}

describe('world quest command host', () => {
  it('rejects duplicate and malformed target authority data', () => {
    const repository = new MemoryQuestStateRepository()
    const target = QUEST_TARGETS[0]!
    expect(() => new WorldQuestHost('offline', repository, [target, target])).toThrow(/duplicate quest target/)
    expect(() => new WorldQuestHost('offline', repository, [{ ...target, x: Number.NaN }])).toThrow(/invalid quest target placement/)
    expect(() => new WorldQuestHost('offline', repository, [{ ...target, interactionRadius: 0 }])).toThrow(/invalid quest target placement/)
  })

  it('accepts only at the authored giver and commits before publishing state', async () => {
    const repository = new MemoryQuestStateRepository()
    const host = new WorldQuestHost('offline', repository, QUEST_TARGETS)
    await host.initialize()

    const far = await host.dispatch({ kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, { x: 0, z: 0 })
    expect(far).toMatchObject({ kind: 'rejected', reason: 'out_of_range' })
    expect(host.state?.accepted.M01).toBeUndefined()

    const invalidPosition = await host.dispatch(
      { kind: 'accept', questId: 'M01', giverId: 'npc_mara' },
      { x: Number.NaN, z: Number.NaN },
    )
    expect(invalidPosition).toMatchObject({ kind: 'rejected', reason: 'out_of_range' })
    expect(host.state?.accepted.M01).toBeUndefined()

    repository.failNextCommit('disk unavailable')
    const failed = await host.dispatch({ kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, at('npc_mara'))
    expect(failed).toMatchObject({ kind: 'save_error', reason: 'disk unavailable' })
    expect('scenes' in failed).toBe(false)
    expect(host.state?.accepted.M01).toBeUndefined()

    const accepted = await host.dispatch({ kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, at('npc_mara'))
    expect(accepted.kind).toBe('committed')
    expect(host.state?.accepted.M01).toBeDefined()
    expect(host.state?.revision).toBe(1)
  })

  it('rejects a remote turn-in and commits one nearby reward receipt', async () => {
    const ready = readyM01()
    const repository = new MemoryQuestStateRepository({ offline: ready })
    const host = new WorldQuestHost('offline', repository, QUEST_TARGETS)
    await host.initialize()

    const far = await host.dispatch({ kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }, { x: 0, z: 0 })
    expect(far).toMatchObject({ kind: 'rejected', reason: 'out_of_range' })
    expect(host.state?.receipts.M01).toBeUndefined()

    const completed = await host.dispatch({ kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }, at('npc_mara'))
    expect(completed.kind).toBe('committed')
    expect(host.state?.completedIds).toContain('M01')
    expect(host.state?.receipts.M01?.characterId).toBe('offline')
  })

  it('reloads the winner when two stale hosts race', async () => {
    const repository = new MemoryQuestStateRepository()
    const first = new WorldQuestHost('offline', repository, QUEST_TARGETS)
    const second = new WorldQuestHost('offline', repository, QUEST_TARGETS)
    await Promise.all([first.initialize(), second.initialize()])
    expect((await first.dispatch({ kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, at('npc_mara'))).kind).toBe('committed')
    const stale = await second.dispatch({ kind: 'accept', questId: 'M02', giverId: 'npc_iven' }, at('npc_iven'))
    expect(stale.kind).toBe('conflict')
    expect(second.state?.accepted.M01).toBeDefined()
    expect(second.state?.accepted.M02).toBeUndefined()
  })

  it('prefers an accepted objective over an overlapping early discovery', () => {
    let state = createQuestState('offline')
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'S01', giverId: 'npc_mara' }).state
    state = reduceQuestIntent(state, {
      kind: 'interact', targetId: 'scuffed_plank', questId: 'S01', objectiveId: 'inspect_plank',
    }).state
    state = reduceQuestIntent(state, {
      kind: 'interact', targetId: 'reed_flash_1', questId: 'S01', objectiveId: 'follow_flashes',
    }).state
    const selected = selectQuestInteraction(state, { ...createExplorer({ x: -38, z: 13 }), x: -38, z: 13 })
    expect(selected).toMatchObject({ mode: 'active', target: { id: 'reed_flash_2' }, definition: { id: 'S01' } })
  })
})

function readyM01(): CharacterQuestState {
  let state = createQuestState('offline')
  const accepted = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, openingQuestResolver)
  if (!accepted.changed) throw new Error('M01 did not accept')
  state = accepted.state
  const definition = openingQuestResolver.get('M01')!
  for (const objective of definition.objectives) {
    for (const targetId of objective.targetIds.slice(0, objective.count)) {
      const advanced = reduceQuestIntent(state, {
        kind: 'interact', targetId, questId: definition.id, objectiveId: objective.id,
      }, openingQuestResolver)
      if (!advanced.changed) throw new Error(`M01 did not advance at ${targetId}`)
      state = advanced.state
    }
  }
  return state
}
