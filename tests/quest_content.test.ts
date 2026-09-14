import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPENING_QUESTS, createQuestState, openingQuestResolver, projectJournal, projectNpcOffers,
  reduceQuestIntent, validateQuestCatalogue, type CharacterQuestState, type QuestDefinition,
} from '../src/quests'

const EXPECTED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  M01: ['rescue_ties', 'willow_branch_1', 'willow_branch_2', 'survivor_willow', 'rescue_line_footing', 'survivor_ferry_post', 'survivor_driftwood'],
  M02: ['satchel_reeds_1', 'satchel_reeds_2', 'satchel_reeds_3', 'npc_iven', 'patient_wrap_1', 'patient_wrap_2', 'patient_wrap_3', 'water_pump', 'npc_iven'],
  S01: ['scuffed_plank', 'reed_flash_1', 'reed_flash_2', 'reed_flash_3', 'tin_thrush'],
  S02: ['damp_bedding_1', 'damp_bedding_2', 'damp_bedding_3', 'drying_line_1', 'drying_line_2', 'drying_line_3', 'blue_cloth_roll_1', 'blue_cloth_roll_2', 'npc_iven'],
  S03: ['covered_water_barrel', 'root_cutter_1', 'root_cutter_2', 'root_cutter_3', 'root_cutter_4', 'npc_iven', 'meal_recipient_1', 'meal_recipient_2', 'npc_edda'],
  S04: ['warm_cup', 'npc_seli', 'npc_seli', 'seli_continue', 'npc_iven'],
  S05: ['family_name_1', 'family_name_2', 'npc_ferryman', 'npc_seli', 'notice_board_title', 'notice_board_hooks'],
}

describe('opening quest content', () => {
  it('publishes the validated thirty-entry graph with seven source-complete playable quests', () => {
    expect(OPENING_QUESTS).toHaveLength(30)
    expect(validateQuestCatalogue(OPENING_QUESTS)).toEqual({ valid: true, errors: [] })
    const playable = OPENING_QUESTS.filter((quest) => quest.status === 'playable')
    expect(playable.map((quest) => quest.id)).toEqual(['M01', 'M02', 'S01', 'S02', 'S03', 'S04', 'S05'])
    for (const quest of playable) {
      expect(quest.objectives.flatMap((objective) => objective.targetIds)).toEqual(EXPECTED_TARGETS[quest.id])
      const sceneKinds = quest.scenes.map((scene) => scene.kind)
      expect(sceneKinds).toEqual(expect.arrayContaining(['offer', 'reply', 'reminder', 'completion']))
      expect(quest.scenes.flatMap((scene) => scene.lines).every((entry) => entry.text.length > 0)).toBe(true)
      expect(Object.isFrozen(quest)).toBe(true)
    }
  })

  it('uses real authored heading anchors and preserves M10 evidence gating', () => {
    for (const quest of OPENING_QUESTS) {
      const [path, anchor] = quest.source.split('#') as [string, string]
      const headings = [...readFileSync(join(import.meta.dirname, '..', path), 'utf8').matchAll(/^## (.+)$/gm)]
        .map((match) => headingSlug(match[1]!))
      expect(headings, quest.source).toContain(anchor)
    }
    expect(openingQuestResolver.get('M10')?.gates).toContain('altered_ward_evidence')
    expect(openingQuestResolver.get('M07')?.reward.unlocks).toContain('altered_ward_evidence')
  })

  it('rejects broken references, cycles, invalid counts, duplicate versions and optional MSQ gates', () => {
    const base = OPENING_QUESTS.find((quest) => quest.id === 'M01')!
    const invalid: QuestDefinition[] = [
      base,
      { ...base },
      { ...base, id: 'M02', prerequisites: ['missing' as 'M99'] },
      { ...base, id: 'M03', prerequisites: ['S01'] },
      { ...base, id: 'S01', prerequisites: ['S02'] },
      { ...base, id: 'S02', prerequisites: ['S01'], objectives: [{ ...base.objectives[0]!, count: 2 }] },
    ]
    const result = validateQuestCatalogue(invalid)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toMatch(/duplicate definition|missing prerequisite|main story depends on optional|cycle|invalid objective/)
  })

  it('keeps side quests out of M03 eligibility and rejects planned acceptance', () => {
    let state = createQuestState('hero')
    state = complete(state, 'M02')
    state = complete(state, 'M01')
    expect(projectJournal(state).find((quest) => quest.id === 'M03')).toMatchObject({ category: 'main', status: 'planned' })
    expect(reduceQuestIntent(state, { kind: 'accept', questId: 'M03', giverId: 'npc_mara' })).toMatchObject({ changed: false, error: 'planned_quest' })
    expect(projectNpcOffers('npc_mara', state).every((quest) => quest.category === 'side')).toBe(true)
  })

  it('completes M01 and M02 in either order and preserves their authored objective sequence', () => {
    for (const order of [['M01', 'M02'], ['M02', 'M01']] as const) {
      let state = createQuestState(`hero-${order.join('-')}`)
      for (const id of order) state = complete(state, id)
      expect(state.completedIds).toEqual([...order])
      expect(state.pendingXp).toBe(240)
      expect(state.featureUnlocks).toContain('basic_social_access')
    }
  })

  it('plays every safe-bank side quest and records personal choices with equal rewards', () => {
    let state = createQuestState('side-hero')
    state = { ...state, featureUnlocks: [...state.featureUnlocks, 'iven_introduction_heard', 'initial_survivor_count_known'] }
    for (const id of ['S01', 'S02', 'S03', 'S04', 'S05'] as const) state = complete(state, id)
    expect(state.completedIds).toEqual(['S01', 'S02', 'S03', 'S04', 'S05'])
    expect(state.pendingXp).toBe(275)
    expect(Object.keys(state.receipts)).toEqual(state.completedIds)
    expect(state.receipts.S04?.choices).toEqual({ choose_company: 'sit_nearby' })
    expect(state.receipts.S05?.choices).toEqual({ ask_seli_consent: 'include_parn' })
  })

  it('records Iven introduction without delivering the satchel before acceptance', () => {
    let state = createQuestState('introduced')
    for (const targetId of ['satchel_reeds_1', 'satchel_reeds_2', 'satchel_reeds_3']) state = reduceQuestIntent(state, { kind: 'interact', targetId }).state
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'npc_iven' }).state
    expect(state.discoveries.some((entry) => entry.includes('return_satchel'))).toBe(false)
    expect(state.featureUnlocks).toContain('iven_introduction_heard')
    state = accept(state, 'M02')
    expect(state.accepted.M02?.objectiveTargets.return_satchel).toBeUndefined()
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'npc_iven', questId: 'M02', objectiveId: 'return_satchel' }).state
    expect(state.accepted.M02?.objectiveTargets.return_satchel).toEqual(['npc_iven'])
  })

  it('only shows completion context on the unique target that actually completes a counted objective', () => {
    let state = createQuestState('searcher')
    state = accept(state, 'M02')
    let result = reduceQuestIntent(state, { kind: 'interact', targetId: 'satchel_reeds_3' })
    expect(result.scenes).toEqual([])
    state = result.state
    state = reduceQuestIntent(state, { kind: 'interact', targetId: 'satchel_reeds_1' }).state
    result = reduceQuestIntent(state, { kind: 'interact', targetId: 'satchel_reeds_2' })
    expect(result.scenes.flatMap((entry) => entry.lines.map((line) => line.text)).join(' ')).toContain('Hold it above the mud')
  })

  it('hydrates causally ordered early credit without allowing later steps first', () => {
    let state = createQuestState('early')
    expect(reduceQuestIntent(state, { kind: 'interact', targetId: 'survivor_willow' })).toMatchObject({ changed: false, error: 'wrong_target' })
    for (const targetId of ['rescue_ties', 'willow_branch_2', 'willow_branch_1', 'survivor_willow']) {
      state = reduceQuestIntent(state, { kind: 'interact', targetId }).state
    }
    state = accept(state, 'M01')
    expect(state.accepted.M01?.objectiveTargets).toMatchObject({
      take_rescue_ties: ['rescue_ties'], clear_willow_branches: expect.arrayContaining(['willow_branch_1', 'willow_branch_2']), rescue_willow: ['survivor_willow'],
    })
    let bedding = createQuestState('bedding')
    expect(reduceQuestIntent(bedding, { kind: 'interact', targetId: 'drying_line_1' })).toMatchObject({ changed: false })
    for (const targetId of ['damp_bedding_1', 'damp_bedding_2', 'damp_bedding_3', 'drying_line_1']) bedding = reduceQuestIntent(bedding, { kind: 'interact', targetId }).state
    bedding = accept(bedding, 'S02')
    expect(bedding.accepted.S02?.objectiveTargets.hang_bedding).toEqual(['drying_line_1'])
  })
})

function accept(state: CharacterQuestState, id: keyof typeof EXPECTED_TARGETS): CharacterQuestState {
  const definition = openingQuestResolver.get(id as `M${string}` | `S${string}`)!
  return reduceQuestIntent(state, { kind: 'accept', questId: definition.id, giverId: definition.giverId }).state
}

function complete(state: CharacterQuestState, id: keyof typeof EXPECTED_TARGETS): CharacterQuestState {
  const definition = openingQuestResolver.get(id as `M${string}` | `S${string}`)!
  let next = accept(state, id)
  for (const objective of definition.objectives) {
    if (objective.choiceIds) {
      next = reduceQuestIntent(next, { kind: 'choose', questId: definition.id, objectiveId: objective.id, choiceId: objective.choiceIds[0]!, targetId: objective.targetIds[0]! }).state
    } else {
      for (const targetId of objective.targetIds.slice(0, objective.count)) {
        next = reduceQuestIntent(next, { kind: 'interact', targetId, questId: definition.id, objectiveId: objective.id }).state
      }
    }
  }
  const result = reduceQuestIntent(next, { kind: 'turn_in', questId: definition.id, turnInId: definition.turnInId })
  expect(result.error).toBeUndefined()
  return result.state
}

function headingSlug(title: string): string {
  return title.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s/g, '-')
}
