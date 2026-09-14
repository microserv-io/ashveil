import { openingQuestResolver } from './opening-content'
import { questIsAvailable, questIsReady } from './projections'
import type {
  AcceptedQuestState, CharacterQuestState, DialogueScene, QuestDefinition, QuestDefinitionResolver,
  QuestIntent, QuestMutationError, QuestMutationResult, QuestObjectiveDefinition, QuestTargetId, SharedQuestEvent,
} from './types'

export function createQuestState(characterId: string): CharacterQuestState {
  if (!characterId.trim()) throw new Error('characterId must not be blank')
  return {
    schemaVersion: 1, characterId, revision: 0, accepted: {}, completedIds: [], discoveries: [], trackedIds: [],
    featureUnlocks: ['arrived_alderbank'], pendingXp: 0, classXp: {}, currency: 0, rewardInventory: {}, receipts: {},
  }
}

export function reduceQuestIntent(
  state: CharacterQuestState,
  intent: QuestIntent,
  resolver: QuestDefinitionResolver = openingQuestResolver,
): QuestMutationResult {
  switch (intent.kind) {
    case 'accept': return acceptQuest(state, intent.questId, intent.giverId, resolver)
    case 'interact': return interact(state, intent.targetId, resolver, intent.questId, intent.objectiveId)
    case 'choose': return choose(state, intent.questId, intent.objectiveId, intent.choiceId, intent.targetId, resolver)
    case 'turn_in': return turnIn(state, intent.questId, intent.turnInId, resolver)
    case 'track': return track(state, intent.questId, intent.tracked, resolver)
  }
}

export function applySharedQuestEvent(
  states: readonly CharacterQuestState[],
  event: SharedQuestEvent,
  resolver: QuestDefinitionResolver = openingQuestResolver,
): readonly CharacterQuestState[] {
  const participants = new Set(event.participantCharacterIds)
  return states.map((state) => {
    if (!participants.has(state.characterId)) return state
    const matches = activeMatches(state, event.targetId, resolver)
      .filter(({ definition, objective }) => objective.credit === 'shared' && questIsAvailable(definition, state))
    if (matches.length === 0) return state
    let next = state
    let changedState = false
    for (const match of matches) {
      const result = advanceObjective(next, match.definition, match.objective, event.targetId)
      if (result.changed) { next = result.state; changedState = true }
    }
    return changedState ? deriveGates(next) : state
  })
}

export function assignPendingXpToFirstClass(state: CharacterQuestState, classId: string): CharacterQuestState {
  if (state.firstClassId !== undefined) return state
  if (!classId.trim()) throw new Error('classId must not be blank')
  const next = safeAdd(state.classXp[classId] ?? 0, state.pendingXp)
  if (next === undefined) throw new Error('class XP overflow')
  return { ...state, pendingXp: 0, firstClassId: classId, activeClassId: classId, classXp: { ...state.classXp, [classId]: next } }
}

export function setActiveClass(state: CharacterQuestState, classId: string): CharacterQuestState {
  if (!Object.hasOwn(state.classXp, classId)) throw new Error(`class ${classId} is not unlocked`)
  return state.activeClassId === classId ? state : { ...state, activeClassId: classId }
}

function acceptQuest(state: CharacterQuestState, questId: QuestDefinition['id'], giverId: string, resolver: QuestDefinitionResolver): QuestMutationResult {
  const definition = resolver.get(questId)
  if (!definition) return unchanged(state, 'unknown_quest')
  if (definition.status !== 'playable') return unchanged(state, 'planned_quest')
  if (state.completedIds.includes(questId)) return unchanged(state, 'already_completed')
  if (state.accepted[questId]) return unchanged(state, 'already_accepted')
  if (giverId !== definition.giverId) return unchanged(state, 'wrong_giver')
  if (!questIsAvailable(definition, state)) return unchanged(state, 'unavailable')
  const accepted: AcceptedQuestState = { definitionVersion: definition.version, objectiveTargets: {}, choices: {} }
  let next: CharacterQuestState = { ...state, accepted: { ...state.accepted, [questId]: accepted } }
  for (const objective of definition.objectives) {
    for (const targetId of objective.targetIds) {
      if (state.discoveries.includes(discoveryKey(definition, objective, targetId))) {
        next = advanceObjective(next, definition, objective, targetId).state
      }
    }
  }
  return changed(next, scenes(definition, 'offer', 'reply', 'followup'))
}

function interact(
  state: CharacterQuestState,
  targetId: QuestTargetId,
  resolver: QuestDefinitionResolver,
  questId?: QuestDefinition['id'],
  objectiveId?: string,
): QuestMutationResult {
  const introduction = targetId === 'npc_iven' && !state.featureUnlocks.includes('iven_introduction_heard')
  let next: CharacterQuestState = introduction
    ? { ...state, featureUnlocks: [...state.featureUnlocks, 'iven_introduction_heard'] }
    : state
  const shown: DialogueScene[] = []
  const selected = (definition: QuestDefinition, objective: QuestObjectiveDefinition): boolean =>
    (questId === undefined || definition.id === questId) && (objectiveId === undefined || objective.id === objectiveId)
  const active = activeMatches(state, targetId, resolver).filter(({ definition, objective }) => selected(definition, objective))
  const early: { definition: QuestDefinition; objective: QuestObjectiveDefinition }[] = []
  for (const definition of resolver.all()) {
    if (definition.status !== 'playable' || state.accepted[definition.id] || state.completedIds.includes(definition.id)
      || !questIsAvailable(definition, state)) continue
    const objective = currentEarlyObjective(definition, state)
    if (objective && !objective.choiceIds && objective.targetIds.includes(targetId) && selected(definition, objective)
      && !state.discoveries.includes(discoveryKey(definition, objective, targetId))) early.push({ definition, objective })
  }
  const matches = [...active, ...early]
  const hasSelector = questId !== undefined || objectiveId !== undefined
  if (!hasSelector && introduction) return changed(next, [])
  if (matches.length > 1) return unchanged(state, 'ambiguous_target')
  const match = matches[0]
  if (match) {
    if (active.includes(match)) {
      const result = advanceObjective(next, match.definition, match.objective, targetId)
      if (!result.changed) return unchanged(state, result.error ?? 'wrong_target')
      shown.push(...contextScenes(match.definition, match.objective, targetId, result.state))
      return changed(deriveGates(result.state), shown)
    }
    const key = discoveryKey(match.definition, match.objective, targetId)
    next = deriveGates({ ...next, discoveries: [...next.discoveries, key] })
    shown.push(...earlyContextScenes(match.definition, match.objective, targetId, next))
    return changed(next, shown)
  }
  if (introduction) return changed(next, [])
  return unchanged(state, 'wrong_target')
}

function choose(state: CharacterQuestState, questId: QuestDefinition['id'], objectiveId: string, choiceId: string, targetId: string, resolver: QuestDefinitionResolver): QuestMutationResult {
  const definition = pinnedDefinition(state, questId, resolver)
  if (!definition) return unchanged(state, state.accepted[questId] ? 'invalid_state' : 'not_accepted')
  const objective = currentObjective(definition, state.accepted[questId]!)
  if (!objective || objective.id !== objectiveId || !objective.targetIds.includes(targetId)) return unchanged(state, 'wrong_target')
  if (!objective.choiceIds?.includes(choiceId)) return unchanged(state, 'wrong_choice')
  const accepted = state.accepted[questId]!
  const advanced = advanceObjective({
    ...state,
    accepted: { ...state.accepted, [questId]: { ...accepted, choices: { ...accepted.choices, [objectiveId]: choiceId } } },
  }, definition, objective, targetId)
  return { ...advanced, scenes: scenes(definition, 'choice').filter((scene) => scene.lines.some((line) => line.choiceId === choiceId)) }
}

function turnIn(state: CharacterQuestState, questId: QuestDefinition['id'], turnInId: string, resolver: QuestDefinitionResolver): QuestMutationResult {
  if (state.completedIds.includes(questId) || state.receipts[questId]) return unchanged(state, 'already_completed')
  const definition = pinnedDefinition(state, questId, resolver)
  if (!definition) return unchanged(state, state.accepted[questId] ? 'invalid_state' : 'not_accepted')
  if (turnInId !== definition.turnInId) return unchanged(state, 'wrong_turn_in')
  if (!questIsReady(definition, state)) return unchanged(state, 'not_ready')
  if (!validReward(definition)) return unchanged(state, 'numeric_overflow')
  const creditedClassId = state.activeClassId ?? null
  const pendingXp = creditedClassId === null ? safeAdd(state.pendingXp, definition.reward.pendingXp) : state.pendingXp
  const classXp = { ...state.classXp }
  if (creditedClassId !== null) {
    const creditedXp = Object.hasOwn(classXp, creditedClassId)
      ? safeAdd(classXp[creditedClassId]!, definition.reward.pendingXp)
      : undefined
    if (creditedXp === undefined) return unchanged(state, 'invalid_state')
    classXp[creditedClassId] = creditedXp
  }
  const currency = safeAdd(state.currency, definition.reward.currency)
  if (pendingXp === undefined || currency === undefined) return unchanged(state, 'numeric_overflow')
  const inventory = { ...state.rewardInventory }
  for (const item of definition.reward.items) {
    const quantity = safeAdd(inventory[item.id] ?? 0, item.quantity)
    if (quantity === undefined) return unchanged(state, 'numeric_overflow')
    inventory[item.id] = quantity
  }
  const { [questId]: _removed, ...accepted } = state.accepted
  const receipt = {
    characterId: state.characterId, questId, definitionVersion: definition.version,
    pendingXp: definition.reward.pendingXp, currency: definition.reward.currency,
    items: definition.reward.items.map((item) => ({ ...item })), choices: { ...state.accepted[questId]!.choices }, creditedClassId,
  }
  return changed({
    ...state, accepted, completedIds: [...state.completedIds, questId], trackedIds: state.trackedIds.filter((id) => id !== questId),
    featureUnlocks: unique([...state.featureUnlocks, ...(definition.reward.unlocks ?? [])]), pendingXp, classXp, currency,
    rewardInventory: inventory, receipts: { ...state.receipts, [questId]: receipt },
  }, scenes(definition, 'completion'))
}

function track(state: CharacterQuestState, questId: QuestDefinition['id'], shouldTrack: boolean, resolver: QuestDefinitionResolver): QuestMutationResult {
  const definition = resolver.get(questId)
  if (!definition) return unchanged(state, 'unknown_quest')
  if (definition.status !== 'playable') return unchanged(state, 'planned_quest')
  if (!state.accepted[questId]) return unchanged(state, 'not_accepted')
  const ids = shouldTrack ? unique([...state.trackedIds, questId]) : state.trackedIds.filter((id) => id !== questId)
  if (ids.length === state.trackedIds.length && ids.every((id, index) => id === state.trackedIds[index])) return unchanged(state, 'not_accepted')
  return changed({ ...state, trackedIds: ids }, [])
}

function activeMatches(state: CharacterQuestState, targetId: string, resolver: QuestDefinitionResolver): { definition: QuestDefinition; objective: QuestObjectiveDefinition }[] {
  const matches: { definition: QuestDefinition; objective: QuestObjectiveDefinition }[] = []
  for (const [questId, accepted] of Object.entries(state.accepted)) {
    const definition = resolver.get(questId as QuestDefinition['id'], accepted.definitionVersion)
    if (!definition) continue
    const objective = currentObjective(definition, accepted)
    if (objective?.targetIds.includes(targetId) && !objective.choiceIds) matches.push({ definition, objective })
  }
  return matches
}

function currentObjective(definition: QuestDefinition, accepted: AcceptedQuestState): QuestObjectiveDefinition | undefined {
  return definition.objectives.find((objective) => (accepted.objectiveTargets[objective.id]?.length ?? 0) < objective.count)
}

function currentEarlyObjective(definition: QuestDefinition, state: CharacterQuestState): QuestObjectiveDefinition | undefined {
  for (const objective of definition.objectives) {
    const count = objective.targetIds.filter((targetId) => state.discoveries.includes(discoveryKey(definition, objective, targetId))).length
    if (count < objective.count) return objective.earlyPrefix ? objective : undefined
  }
  return undefined
}

function advanceObjective(state: CharacterQuestState, definition: QuestDefinition, objective: QuestObjectiveDefinition, targetId: string): QuestMutationResult {
  const accepted = state.accepted[definition.id]
  if (!accepted) return unchanged(state, 'not_accepted')
  if (currentObjective(definition, accepted)?.id !== objective.id) return unchanged(state, 'wrong_target')
  const prior = accepted.objectiveTargets[objective.id] ?? []
  if (prior.includes(targetId) || !objective.targetIds.includes(targetId)) return unchanged(state, 'wrong_target')
  const updated: AcceptedQuestState = { ...accepted, objectiveTargets: { ...accepted.objectiveTargets, [objective.id]: [...prior, targetId] } }
  return changed({ ...state, accepted: { ...state.accepted, [definition.id]: updated } }, [])
}

function pinnedDefinition(state: CharacterQuestState, questId: QuestDefinition['id'], resolver: QuestDefinitionResolver): QuestDefinition | undefined {
  const accepted = state.accepted[questId]
  return accepted ? resolver.get(questId, accepted.definitionVersion) : undefined
}

function deriveGates(state: CharacterQuestState): CharacterQuestState {
  const accepted = state.accepted.M01
  const rescued = accepted?.objectiveTargets.rescue_driftwood?.includes('survivor_driftwood')
    || state.discoveries.includes('M01@1:rescue_driftwood:survivor_driftwood')
  if (!rescued || state.featureUnlocks.includes('initial_survivor_count_known')) return state
  return { ...state, featureUnlocks: [...state.featureUnlocks, 'initial_survivor_count_known'] }
}

function discoveryKey(definition: QuestDefinition, objective: QuestObjectiveDefinition, targetId: string): string {
  return `${definition.id}@${definition.version}:${objective.id}:${targetId}`
}
function scenes(definition: QuestDefinition, ...kinds: DialogueScene['kind'][]): DialogueScene[] {
  return definition.scenes.filter((scene) => kinds.includes(scene.kind))
}
function contextScenes(definition: QuestDefinition, objective: QuestObjectiveDefinition, targetId: string, state: CharacterQuestState): DialogueScene[] {
  const completed = (state.accepted[definition.id]?.objectiveTargets[objective.id]?.length ?? 0) === objective.count
  return definition.scenes.filter((scene) => scene.kind === 'context'
    && (scene.id === `context:${objective.id}` || scene.id === `context:${objective.id}:${targetId}`
      || (completed && scene.id === `context:${objective.id}:complete`)))
}
function earlyContextScenes(definition: QuestDefinition, objective: QuestObjectiveDefinition, targetId: string, state: CharacterQuestState): DialogueScene[] {
  const completed = objective.targetIds.filter((id) => state.discoveries.includes(discoveryKey(definition, objective, id))).length === objective.count
  return definition.scenes.filter((scene) => scene.kind === 'context'
    && (scene.id === `context:${objective.id}` || scene.id === `context:${objective.id}:${targetId}`
      || (completed && scene.id === `context:${objective.id}:complete`)))
}
function validReward(definition: QuestDefinition): boolean {
  return validAmount(definition.reward.pendingXp) && validAmount(definition.reward.currency)
    && definition.reward.items.every((item) => item.id.length > 0 && validAmount(item.quantity))
}
function validAmount(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 }
function safeAdd(left: number, right: number): number | undefined {
  if (!validAmount(left) || !validAmount(right)) return undefined
  const result = left + right
  return Number.isSafeInteger(result) ? result : undefined
}
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)] }
function unchanged(state: CharacterQuestState, error: QuestMutationError): QuestMutationResult { return { state, changed: false, error, scenes: [] } }
function changed(state: CharacterQuestState, shown: readonly DialogueScene[]): QuestMutationResult { return { state, changed: true, scenes: shown } }
