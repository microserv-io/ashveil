import { describe, expect, it } from 'vitest'
import {
  assignPendingXpToFirstClass,
  createQuestState,
  reduceQuestIntent,
  setActiveClass,
} from '../src/quests/state'
import type { QuestDefinition, QuestDefinitionResolver } from '../src/quests/types'

const QUEST: QuestDefinition = {
  id: 'M01', version: 1, category: 'main', status: 'playable', chapter: 'one', outing: 'bank',
  title: 'Test rescue', giverId: 'npc_mara', turnInId: 'npc_mara', location: 'bank', summary: 'rescue',
  source: 'test', prerequisites: [], gates: ['arrived_alderbank'],
  objectives: [
    { id: 'ties', label: 'Take ties', targetIds: ['rescue_ties'], count: 1, credit: 'personal', earlyPrefix: true },
    { id: 'survivors', label: 'Rescue people', targetIds: ['survivor_a', 'survivor_b'], count: 2, credit: 'shared', earlyPrefix: true },
  ],
  scenes: [{ id: 'offer', kind: 'offer', lines: [{ speaker: 'Mara', text: 'Help.' }] }],
  reward: { pendingXp: 100, currency: 2, items: [{ id: 'cloth', label: 'Cloth', quantity: 1 }] },
}
const resolver: QuestDefinitionResolver = {
  get: (id, version) => id === QUEST.id && (version === undefined || version === 1) ? QUEST : undefined,
  all: () => [QUEST],
}

describe('quest state transitions', () => {
  it('accepts only at the authored giver and advances unique targets in causal order', () => {
    let state = createQuestState('hero')
    state = { ...state, featureUnlocks: ['arrived_alderbank'] }
    expect(reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'wrong' }, resolver)).toMatchObject({ changed: false, error: 'wrong_giver' })
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, resolver).state
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'survivor_a' }, resolver)).toMatchObject({ changed: false, error: 'wrong_target' })
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'rescue_ties' }, resolver).state
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'survivor_a' }, resolver).state
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'survivor_a' }, resolver)).toMatchObject({ changed: false, error: 'wrong_target' })
  })

  it('grants completion once and transfers reserved XP to the first class once', () => {
    let state = createQuestState('hero')
    state = { ...state, featureUnlocks: ['arrived_alderbank'] }
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, resolver).state
    for (const targetId of ['rescue_ties', 'survivor_a', 'survivor_b']) {
      state = reduceQuestIntent(state, { kind: 'interact', targetId }, resolver).state
    }
    const completed = reduceQuestIntent(state, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }, resolver)
    expect(completed.state).toMatchObject({ pendingXp: 100, currency: 2, rewardInventory: { cloth: 1 } })
    expect(completed.state.receipts.M01).toMatchObject({ characterId: 'hero', questId: 'M01' })
    expect(reduceQuestIntent(completed.state, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }, resolver)).toMatchObject({ changed: false, error: 'already_completed' })
    const assigned = assignPendingXpToFirstClass(completed.state, 'future_class')
    expect(assigned).toMatchObject({ pendingXp: 0, firstClassId: 'future_class', classXp: { future_class: 100 } })
    expect(assignPendingXpToFirstClass(assigned, 'other')).toBe(assigned)
  })

  it('credits later quest XP to the active unlocked class without reopening rewards', () => {
    const side: QuestDefinition = {
      ...QUEST, id: 'S01', category: 'side', title: 'Later story', prerequisites: ['M01'],
      objectives: [{ id: 'help', label: 'Help', targetIds: ['help_target'], count: 1, credit: 'personal' }],
      reward: { pendingXp: 25, currency: 0, items: [] },
    }
    const versions = new Map([[`M01@1`, QUEST], [`S01@1`, side]])
    const both: QuestDefinitionResolver = {
      get: (id, version) => versions.get(`${id}@${version ?? 1}`),
      all: () => [QUEST, side],
    }
    let state = createQuestState('later')
    state = { ...state, featureUnlocks: ['arrived_alderbank'] }
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, both).state
    for (const targetId of ['rescue_ties', 'survivor_a', 'survivor_b']) state = reduceQuestIntent(state, { kind: 'interact', targetId }, both).state
    state = reduceQuestIntent(state, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }, both).state
    state = assignPendingXpToFirstClass(state, 'first')
    state = { ...state, classXp: { ...state.classXp, alternate: 0 } }
    state = setActiveClass(state, 'alternate')
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'S01', giverId: 'npc_mara' }, both).state
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'help_target' }, both).state
    state = reduceQuestIntent(state, { kind: 'turn_in', questId: 'S01', turnInId: 'npc_mara' }, both).state
    expect(state).toMatchObject({ pendingXp: 0, activeClassId: 'alternate', classXp: { first: 100, alternate: 25 } })
    expect(state.receipts.S01).toMatchObject({ creditedClassId: 'alternate', pendingXp: 25 })
    const firstClassAgain = setActiveClass(state, 'first')
    expect(reduceQuestIntent(firstClassAgain, { kind: 'turn_in', questId: 'S01', turnInId: 'npc_mara' }, both)).toMatchObject({ state: firstClassAgain, changed: false, error: 'already_completed' })
    expect(() => setActiveClass(state, 'locked')).toThrow(/not unlocked/)
  })
})
