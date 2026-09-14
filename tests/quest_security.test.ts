import { describe, expect, it } from 'vitest'
import { applySharedQuestEvent, createQuestState, openingQuestResolver, reduceQuestIntent, validateQuestState, type CharacterQuestState, type QuestDefinition } from '../src/quests'

describe('quest command boundary', () => {
  it('rejects wrong giver, target, turn-in, choice, duplicate target and premature reward without mutation', () => {
    const initial = createQuestState('hero')
    expect(reduceQuestIntent(initial, { kind: 'accept', questId: 'M01', giverId: 'npc_iven' })).toMatchObject({ state: initial, changed: false, error: 'wrong_giver' })
    let state = reduceQuestIntent(initial, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }).state
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'survivor_willow' })).toMatchObject({ state, changed: false, error: 'wrong_target' })
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'rescue_ties' }).state
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'rescue_ties' })).toMatchObject({ state, changed: false, error: 'wrong_target' })
    expect(reduceQuestIntent(state, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_iven' })).toMatchObject({ state, changed: false, error: 'wrong_turn_in' })
    expect(reduceQuestIntent(state, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' })).toMatchObject({ state, changed: false, error: 'not_ready' })

    let quiet: CharacterQuestState = { ...createQuestState('quiet'), featureUnlocks: ['arrived_alderbank', 'iven_introduction_heard'] }
    quiet = reduceQuestIntent(quiet, { kind: 'accept', questId: 'S04', giverId: 'npc_iven' }).state
    quiet = reduceQuestIntent(quiet, { kind: 'interact', targetId: 'warm_cup' }).state
    quiet = reduceQuestIntent(quiet, { kind: 'interact', targetId: 'npc_seli' }).state
    expect(reduceQuestIntent(quiet, { kind: 'choose', questId: 'S04', objectiveId: 'choose_company', choiceId: 'coerce', targetId: 'npc_seli' })).toMatchObject({ state: quiet, changed: false, error: 'wrong_choice' })
  })

  it('shares only current shareable credit with named eligible participants', () => {
    const ready = (id: string): CharacterQuestState => {
      let state = createQuestState(id)
      state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }).state
      return reduceQuestIntent(state, { kind: 'interact', targetId: 'rescue_ties' }).state
    }
    const a = ready('a')
    const b = ready('b')
    const absent = ready('absent')
    const unaccepted = createQuestState('unaccepted')
    const results = applySharedQuestEvent([a, b, absent, unaccepted], { targetId: 'willow_branch_1', participantCharacterIds: ['a', 'b', 'unaccepted'] })
    expect(results[0]!.accepted.M01?.objectiveTargets.clear_willow_branches).toEqual(['willow_branch_1'])
    expect(results[1]!.accepted.M01?.objectiveTargets.clear_willow_branches).toEqual(['willow_branch_1'])
    expect(results[2]).toBe(absent)
    expect(results[3]).toBe(unaccepted)

    let personal: CharacterQuestState = { ...createQuestState('personal'), featureUnlocks: ['arrived_alderbank', 'iven_introduction_heard'] }
    personal = reduceQuestIntent(personal, { kind: 'accept', questId: 'S04', giverId: 'npc_iven' }).state
    expect(applySharedQuestEvent([personal], { targetId: 'warm_cup', participantCharacterIds: ['personal'] })[0]).toBe(personal)
  })

  it('pins accepted definitions and fails closed when their published version is unavailable', () => {
    let state = createQuestState('pinned')
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }).state
    const latestOnly = { all: openingQuestResolver.all, get: (id: `M${string}` | `S${string}`, version?: number) => version === undefined ? openingQuestResolver.get(id) : undefined }
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'rescue_ties' }, latestOnly)).toMatchObject({ state, changed: false, error: 'wrong_target' })
  })

  it('requires a quest/objective selector when one NPC matches multiple active steps', () => {
    let state = reduceQuestIntent(createQuestState('ambiguous'), { kind: 'interact', targetId: 'npc_iven' }).state
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M02', giverId: 'npc_iven' }).state
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'S03', giverId: 'npc_edda' }).state
    for (const targetId of ['satchel_reeds_1', 'satchel_reeds_2', 'satchel_reeds_3']) {
      state = reduceQuestIntent(state, { kind: 'interact', targetId, questId: 'M02', objectiveId: 'search_reeds' }).state
    }
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'covered_water_barrel', questId: 'S03', objectiveId: 'fill_jug' }).state
    for (const targetId of ['root_cutter_1', 'root_cutter_2', 'root_cutter_3', 'root_cutter_4']) {
      state = reduceQuestIntent(state, { kind: 'interact', targetId, questId: 'S03', objectiveId: 'portion_roots' }).state
    }
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'npc_iven' })).toMatchObject({ state, changed: false, error: 'ambiguous_target' })
    const selected = reduceQuestIntent(state, { kind: 'interact', targetId: 'npc_iven', questId: 'M02', objectiveId: 'return_satchel' })
    expect(selected.state.accepted.M02?.objectiveTargets.return_satchel).toEqual(['npc_iven'])
    expect(selected.state.accepted.S03?.objectiveTargets.ask_iven_meals).toBeUndefined()
  })

  it('rejects semantic save corruption and reward overflow without changing state', () => {
    const base = createQuestState('corrupt')
    const duplicated = {
      ...base,
      accepted: { M01: { definitionVersion: 1, objectiveTargets: { take_rescue_ties: ['rescue_ties', 'rescue_ties'] }, choices: {} } },
    }
    expect(validateQuestState(duplicated)).toMatchObject({ valid: false, reason: expect.stringContaining('invalid targets') })
    expect(validateQuestState({ ...base, accepted: { M01: { definitionVersion: 99, objectiveTargets: {}, choices: {} } } })).toMatchObject({ valid: false, reason: expect.stringContaining('unknown definition version') })

    const missingGate = {
      ...base, featureUnlocks: ['arrived_alderbank'],
      accepted: { S04: { definitionVersion: 1, objectiveTargets: {}, choices: {} } },
    }
    expect(validateQuestState(missingGate)).toMatchObject({ valid: false, reason: expect.stringContaining('prerequisites') })
    const prematureChoice = {
      ...missingGate, featureUnlocks: ['arrived_alderbank', 'iven_introduction_heard'],
      accepted: { S04: { definitionVersion: 1, objectiveTargets: {}, choices: { choose_company: 'sit_nearby' } } },
    }
    expect(validateQuestState(prematureChoice)).toMatchObject({ valid: false, reason: expect.stringContaining('invalid choice') })
    const missingChoice = {
      ...prematureChoice,
      accepted: { S04: { definitionVersion: 1, objectiveTargets: { take_warm_cup: ['warm_cup'], offer_cup: ['npc_seli'], choose_company: ['npc_seli'] }, choices: {} } },
    }
    expect(validateQuestState(missingChoice)).toMatchObject({ valid: false, reason: expect.stringContaining('invalid choice') })
    expect(validateQuestState({ ...base, firstClassId: 'warden', classXp: { warden: 0 } })).toMatchObject({ valid: false, reason: 'class selection is not unlocked' })

    let completedChoice = { ...base, featureUnlocks: ['arrived_alderbank', 'iven_introduction_heard'] } as CharacterQuestState
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'accept', questId: 'S04', giverId: 'npc_iven' }).state
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'interact', targetId: 'warm_cup', questId: 'S04', objectiveId: 'take_warm_cup' }).state
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'interact', targetId: 'npc_seli', questId: 'S04', objectiveId: 'offer_cup' }).state
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'choose', questId: 'S04', objectiveId: 'choose_company', choiceId: 'sit_nearby', targetId: 'npc_seli' }).state
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'interact', targetId: 'seli_continue', questId: 'S04', objectiveId: 'wait_for_seli' }).state
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'interact', targetId: 'npc_iven', questId: 'S04', objectiveId: 'report_seli' }).state
    completedChoice = reduceQuestIntent(completedChoice, { kind: 'turn_in', questId: 'S04', turnInId: 'npc_iven' }).state
    const missingReceiptChoice = { ...completedChoice, receipts: { ...completedChoice.receipts, S04: { ...completedChoice.receipts.S04!, choices: {} } } }
    expect(validateQuestState(missingReceiptChoice)).toMatchObject({ valid: false, reason: expect.stringContaining('does not match') })
    expect(validateQuestState({ ...completedChoice, featureUnlocks: ['arrived_alderbank'] })).toMatchObject({ valid: false, reason: expect.stringContaining('does not match') })
    const missingReceiptClass = {
      ...completedChoice, firstClassId: 'warden', activeClassId: 'warden', classXp: { warden: 0 },
      receipts: { ...completedChoice.receipts, S04: { ...completedChoice.receipts.S04!, creditedClassId: 'mage' } },
    }
    expect(validateQuestState(missingReceiptClass)).toMatchObject({ valid: false, reason: expect.stringContaining('does not match') })
    const rewardedPlanned = {
      ...base, completedIds: ['M03'],
      receipts: { M03: { characterId: 'corrupt', questId: 'M03', definitionVersion: 1, pendingXp: 0, currency: 0, items: [], choices: {}, creditedClassId: null } },
    }
    expect(validateQuestState(rewardedPlanned)).toMatchObject({ valid: false, reason: expect.stringContaining('does not match') })

    let completedMain = reduceQuestIntent(base, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }).state
    for (const objective of openingQuestResolver.get('M01')!.objectives) {
      for (const targetId of objective.targetIds.slice(0, objective.count)) {
        completedMain = reduceQuestIntent(completedMain, { kind: 'interact', targetId, questId: 'M01', objectiveId: objective.id }).state
      }
    }
    completedMain = reduceQuestIntent(completedMain, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }).state
    expect(validateQuestState({ ...completedMain, featureUnlocks: ['arrived_alderbank', 'initial_survivor_count_known'] })).toMatchObject({ valid: false, reason: expect.stringContaining('does not match') })
    expect(validateQuestState({ ...completedMain, featureUnlocks: ['arrived_alderbank', 'basic_social_access'] })).toMatchObject({ valid: false, reason: 'initial survivor count gate is missing' })

    const source = openingQuestResolver.get('M01')!
    const overflowing: QuestDefinition = { ...source, reward: { ...source.reward, pendingXp: Number.MAX_SAFE_INTEGER } }
    const resolver = { all: () => [overflowing], get: (id: `M${string}` | `S${string}`, version?: number) => id === 'M01' && (version === undefined || version === 1) ? overflowing : undefined }
    let state = { ...createQuestState('overflow'), pendingXp: 1 }
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }, resolver).state
    for (const targetId of overflowing.objectives.flatMap((objective) => objective.targetIds)) state = reduceQuestIntent(state, { kind: 'interact', targetId }, resolver).state
    expect(reduceQuestIntent(state, { kind: 'turn_in', questId: 'M01', turnInId: 'npc_mara' }, resolver)).toMatchObject({ state, changed: false, error: 'numeric_overflow' })
  })
})
