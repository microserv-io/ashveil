import { openingQuestResolver } from './opening-content'
import type { CharacterQuestState, QuestDefinition, QuestDefinitionResolver, QuestJournalEntry, QuestObjectiveDefinition } from './types'

export function questIsAvailable(definition: QuestDefinition, state: CharacterQuestState): boolean {
  return definition.prerequisites.every((id) => state.completedIds.includes(id))
    && definition.gates.every((gate) => state.featureUnlocks.includes(gate))
}

export function questIsReady(definition: QuestDefinition, state: CharacterQuestState): boolean {
  const accepted = state.accepted[definition.id]
  if (!accepted || accepted.definitionVersion !== definition.version) return false
  return definition.objectives.every((objective) => (accepted.objectiveTargets[objective.id]?.length ?? 0) === objective.count)
}

export function projectNpcOffers(
  npcId: string,
  state: CharacterQuestState,
  resolver: QuestDefinitionResolver = openingQuestResolver,
): readonly QuestDefinition[] {
  return resolver.all().filter((definition) => definition.giverId === npcId && definition.status === 'playable'
    && !state.accepted[definition.id] && !state.completedIds.includes(definition.id) && questIsAvailable(definition, state))
}

export function projectJournal(
  state: CharacterQuestState,
  resolver: QuestDefinitionResolver = openingQuestResolver,
  includeCatalogue = false,
): readonly QuestJournalEntry[] {
  return resolver.all().flatMap((latest): QuestJournalEntry[] => {
    const accepted = state.accepted[latest.id]
    const definition = accepted ? resolver.get(latest.id, accepted.definitionVersion) : latest
    if (!definition) return []
    const completed = state.completedIds.includes(definition.id)
    const available = questIsAvailable(definition, state)
    if (!includeCatalogue && definition.status === 'planned') {
      if (definition.id !== 'M03' || !available) return []
    } else if (!includeCatalogue && !accepted && !completed && !available) return []
    const status: QuestJournalEntry['status'] = completed ? 'completed'
      : definition.status === 'planned' ? available ? 'planned' : 'locked'
        : accepted ? questIsReady(definition, state) ? 'ready' : 'active'
          : available ? 'available' : 'locked'
    return [{
      id: definition.id,
      category: definition.category,
      title: definition.title,
      status,
      label: definition.category === 'main' ? 'Main Story' : 'Optional Side Quest',
      summary: definition.summary,
      location: definition.location,
      nextObjective: accepted ? currentObjective(definition, accepted.objectiveTargets) : undefined,
      reward: definition.reward,
      unavailableReason: definition.unavailableReason,
    }]
  })
}

function currentObjective(
  definition: QuestDefinition,
  targets: Readonly<Record<string, readonly string[]>>,
): QuestObjectiveDefinition | undefined {
  return definition.objectives.find((objective) => (targets[objective.id]?.length ?? 0) < objective.count)
}
