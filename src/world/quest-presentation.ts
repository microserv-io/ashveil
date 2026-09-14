import {
  openingQuestResolver,
  projectJournal,
  questIsAvailable,
  type CharacterQuestState,
  type QuestJournalEntry,
  type QuestTargetId,
} from '../quests'

export type HudStoryState =
  | { readonly kind: 'continue'; readonly giverId: QuestTargetId }
  | { readonly kind: 'in-progress' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'complete' }

export interface HudQuestProjection {
  readonly main: readonly QuestJournalEntry[]
  readonly side: readonly QuestJournalEntry[]
  readonly history: readonly QuestJournalEntry[]
  readonly story: HudStoryState
}

export function projectHudQuests(state: CharacterQuestState): HudQuestProjection {
  const catalogue = projectJournal(state, openingQuestResolver, true)
  const accepted = catalogue.filter((entry) => Object.hasOwn(state.accepted, entry.id)
    && (entry.status === 'active' || entry.status === 'ready'))
  const playableMain = openingQuestResolver.all().filter((definition) => definition.category === 'main' && definition.status === 'playable')
  const hasAcceptedMain = accepted.some((entry) => entry.category === 'main')
  const incompleteMain = playableMain.filter((definition) => !state.completedIds.includes(definition.id))
  const nextMain = incompleteMain.find((definition) => questIsAvailable(definition, state))
  const story: HudStoryState = hasAcceptedMain
    ? { kind: 'in-progress' }
    : nextMain
      ? { kind: 'continue', giverId: nextMain.giverId }
      : incompleteMain.length > 0 ? { kind: 'unavailable' } : { kind: 'complete' }

  return {
    main: accepted.filter((entry) => entry.category === 'main'),
    side: accepted.filter((entry) => entry.category === 'side'),
    history: catalogue.filter((entry) => state.completedIds.includes(entry.id)),
    story,
  }
}
