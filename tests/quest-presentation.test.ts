import { describe, expect, it } from 'vitest'
import { createQuestState, openingQuestResolver, projectJournal, type CharacterQuestState, type QuestId } from '../src/quests'
import { projectQuestMarkers } from '../src/world/quest-controller'
import { projectHudQuests } from '../src/world/quest-presentation'
import { resolveHudShortcut } from '../src/world/hud-shortcuts'
import { createHudLayoutPreference } from '../src/world/hud-layout'

function acceptedState(ids: readonly QuestId[], trackedIds: readonly QuestId[] = ids): CharacterQuestState {
  const base = createQuestState('hud-test')
  return {
    ...base,
    accepted: Object.fromEntries(ids.map((id) => [id, {
      definitionVersion: openingQuestResolver.get(id)!.version,
      objectiveTargets: {},
      choices: {},
    }])),
    trackedIds,
  }
}

function readyState(id: QuestId): CharacterQuestState {
  const state = acceptedState([id])
  const definition = openingQuestResolver.get(id)!
  return {
    ...state,
    accepted: {
      [id]: {
        definitionVersion: definition.version,
        objectiveTargets: Object.fromEntries(definition.objectives.map((objective) => [objective.id, objective.targetIds.slice(0, objective.count)])),
        choices: {},
      },
    },
  }
}

describe('first-zone HUD quest projection', () => {
  it('guides a fresh save to Mara without leaking offered quests into the journal', () => {
    const projection = projectHudQuests(createQuestState('fresh'))

    expect(projection.main).toEqual([])
    expect(projection.side).toEqual([])
    expect(projection.story).toEqual({ kind: 'continue', giverId: 'npc_mara' })
  })

  it('shows active and ready main story quests', () => {
    expect(projectHudQuests(acceptedState(['M01'])).main).toMatchObject([{ id: 'M01', status: 'active' }])
    expect(projectHudQuests(readyState('M02')).main).toMatchObject([{ id: 'M02', status: 'ready' }])
  })

  it('does not show an acquisition cue when an accepted MSQ is untracked', () => {
    const projection = projectHudQuests(acceptedState(['M01'], []))

    expect(projection.main).toHaveLength(1)
    expect(projection.story).toEqual({ kind: 'in-progress' })
  })

  it('chooses the earliest remaining parallel playable main quest', () => {
    expect(projectHudQuests({ ...createQuestState('m02-first'), completedIds: ['M02'] }).story)
      .toEqual({ kind: 'continue', giverId: 'npc_mara' })
    expect(projectHudQuests({ ...createQuestState('m01-first'), completedIds: ['M01'] }).story)
      .toEqual({ kind: 'continue', giverId: 'npc_iven' })
  })

  it('reports the playable story complete without directing players to M03', () => {
    const projection = projectHudQuests({ ...createQuestState('complete'), completedIds: ['M01', 'M02'] })

    expect(projection.story).toEqual({ kind: 'complete' })
    expect(projection.main).toEqual([])
  })

  it('does not invent a continuation when the next playable quest is gated', () => {
    const projection = projectHudQuests({ ...createQuestState('gated'), featureUnlocks: [] })

    expect(projection.story).toEqual({ kind: 'unavailable' })
  })

  it('includes accepted side stories and excludes available side-story offers', () => {
    const fresh = projectHudQuests(createQuestState('fresh-side'))
    const accepted = projectHudQuests(acceptedState(['S01', 'S02']))

    expect(fresh.side).toEqual([])
    expect(accepted.side.map((entry) => entry.id)).toEqual(['S01', 'S02'])
  })

  it('keeps completed quests only in history', () => {
    const projection = projectHudQuests({ ...createQuestState('history'), completedIds: ['M01', 'S01'] })

    expect(projection.main).toEqual([])
    expect(projection.side).toEqual([])
    expect(projection.history.map((entry) => entry.id)).toEqual(['M01', 'S01'])
  })

  it('keeps available NPC markers even though offers are absent from the HUD', () => {
    const state = createQuestState('marker')
    const markers = projectQuestMarkers(projectJournal(state), state)

    expect(markers).toContainEqual({ id: 'npc_mara', category: 'main', status: 'available' })
    expect(markers).toContainEqual({ id: 'npc_iven', category: 'main', status: 'available' })
    expect(markers).toContainEqual({ id: 'npc_edda', category: 'side', status: 'available' })
  })
})

describe('HUD shortcuts', () => {
  const idle = { repeat: false, editable: false, modalOpen: false, activePanel: null }

  it('suppresses interaction beneath a modal and all shortcuts from editable controls or repeats', () => {
    expect(resolveHudShortcut('KeyF', { ...idle, modalOpen: true })).toEqual({ kind: 'none' })
    expect(resolveHudShortcut('KeyJ', { ...idle, editable: true })).toEqual({ kind: 'none' })
    expect(resolveHudShortcut('KeyJ', { ...idle, repeat: true })).toEqual({ kind: 'none' })
  })

  it('opens and toggles the requested menu without closing during panel switches', () => {
    expect(resolveHudShortcut('KeyJ', idle)).toEqual({ kind: 'open', panel: 'journal' })
    expect(resolveHudShortcut('KeyM', { ...idle, modalOpen: true, activePanel: 'journal' })).toEqual({ kind: 'open', panel: 'map' })
    expect(resolveHudShortcut('KeyJ', { ...idle, modalOpen: true, activePanel: 'journal' })).toEqual({ kind: 'close' })
  })
})

describe('HUD layout preference', () => {
  it('keeps the selected layout for the session when browser persistence is blocked', () => {
    const preference = createHudLayoutPreference({ getItem: () => 'keyboard', setItem: () => { throw new Error('blocked') } })

    preference.set('controller')

    expect(preference.get()).toBe('controller')
  })
})
