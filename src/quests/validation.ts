import { openingQuestResolver } from './opening-content'
import { QUEST_GATES, type AcceptedQuestState, type CharacterQuestState, type QuestDefinition, type QuestDefinitionResolver, type QuestId } from './types'

export interface CatalogueValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

export type QuestStateValidation =
  | { readonly valid: true; readonly state: CharacterQuestState }
  | { readonly valid: false; readonly reason: string }

export function validateQuestCatalogue(definitions: readonly QuestDefinition[]): CatalogueValidation {
  const errors: string[] = []
  const keys = new Set<string>()
  const latest = new Map<QuestId, QuestDefinition>()
  for (const definition of definitions) {
    const key = `${definition.id}@${definition.version}`
    if (keys.has(key)) errors.push(`duplicate definition ${key}`)
    keys.add(key)
    if (!Number.isSafeInteger(definition.version) || definition.version < 1) errors.push(`${key} has invalid version`)
    if (!definition.title || !definition.giverId || !definition.turnInId || !definition.source) errors.push(`${key} is missing identity metadata`)
    if (definition.status === 'playable' && definition.objectives.length === 0) errors.push(`${key} is playable without objectives`)
    if (definition.gates.some((gate) => !QUEST_GATES.includes(gate))) errors.push(`${key} has an unknown gate`)
    if (!validReward(definition.reward)) errors.push(`${key} has invalid rewards`)
    const objectiveIds = new Set<string>()
    for (const objective of definition.objectives) {
      if (objectiveIds.has(objective.id)) errors.push(`${key} has duplicate objective ${objective.id}`)
      objectiveIds.add(objective.id)
      if (!objective.id || objective.targetIds.length === 0 || !Number.isSafeInteger(objective.count)
        || objective.count < 1 || objective.count > new Set(objective.targetIds).size) {
        errors.push(`${key} has invalid objective ${objective.id || '<blank>'}`)
      }
      if (objective.choiceIds && (objective.choiceIds.length < 2 || new Set(objective.choiceIds).size !== objective.choiceIds.length)) {
        errors.push(`${key} has invalid choices for ${objective.id}`)
      }
    }
    const current = latest.get(definition.id)
    if (!current || current.version < definition.version) latest.set(definition.id, definition)
  }
  for (const definition of latest.values()) {
    for (const prerequisite of definition.prerequisites) {
      const dependency = latest.get(prerequisite)
      if (!dependency) errors.push(`${definition.id} references missing prerequisite ${prerequisite}`)
      if (definition.category === 'main' && dependency?.category === 'side') errors.push(`${definition.id} main story depends on optional ${prerequisite}`)
    }
  }
  const visiting = new Set<QuestId>()
  const visited = new Set<QuestId>()
  const visit = (id: QuestId): void => {
    if (visiting.has(id)) { errors.push(`prerequisite cycle contains ${id}`); return }
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of latest.get(id)?.prerequisites ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of latest.keys()) visit(id)
  return { valid: errors.length === 0, errors }
}

export function validateQuestState(value: unknown, resolver: QuestDefinitionResolver = openingQuestResolver): QuestStateValidation {
  if (!isRecord(value)) return invalid('save is not an object')
  if (value.schemaVersion !== 1) return invalid(`unsupported save schema ${String(value.schemaVersion)}`)
  if (typeof value.characterId !== 'string' || !value.characterId.trim()) return invalid('characterId is invalid')
  if (!safeCount(value.revision)) return invalid('revision is invalid')
  if (!isRecord(value.accepted) || !stringArray(value.completedIds) || !stringArray(value.discoveries)
    || !stringArray(value.trackedIds) || !stringArray(value.featureUnlocks)) return invalid('quest collections are invalid')
  const acceptedRecords = value.accepted as Record<string, AcceptedQuestState>
  const completedIds = value.completedIds
  const discoveries = value.discoveries
  const trackedIds = value.trackedIds
  const featureUnlocks = value.featureUnlocks
  for (const [questId, accepted] of Object.entries(acceptedRecords)) {
    if (!/^[MS]\d{2}$/.test(questId) || !validAccepted(accepted)) return invalid(`accepted quest ${questId} is invalid`)
    const definition = resolver.get(questId as QuestId, accepted.definitionVersion)
    if (!definition || definition.status !== 'playable') return invalid(`accepted quest ${questId} has an unknown definition version`)
    if (!definition.prerequisites.every((id) => completedIds.includes(id))
      || !definition.gates.every((gate) => featureUnlocks.includes(gate))) return invalid(`accepted quest ${questId} does not satisfy its prerequisites`)
    const semanticError = validateAcceptedProgress(definition, accepted)
    if (semanticError) return invalid(semanticError)
  }
  if (!safeCount(value.pendingXp) || !safeCount(value.currency) || !countRecord(value.classXp)
    || !countRecord(value.rewardInventory) || !isRecord(value.receipts)) return invalid('reward balances are invalid')
  const classXp = value.classXp as Record<string, number>
  const receipts = value.receipts
  if (value.firstClassId !== undefined && (typeof value.firstClassId !== 'string' || !value.firstClassId.trim())) return invalid('firstClassId is invalid')
  if (value.activeClassId !== undefined && (typeof value.activeClassId !== 'string' || !value.activeClassId.trim())) return invalid('activeClassId is invalid')
  if ((value.firstClassId === undefined) !== (value.activeClassId === undefined)
    || (value.firstClassId !== undefined && !Object.hasOwn(classXp, value.firstClassId))
    || (value.activeClassId !== undefined && !Object.hasOwn(classXp, value.activeClassId))) return invalid('class selection is not unlocked')
  if (featureUnlocks.some((gate) => !QUEST_GATES.includes(gate as (typeof QUEST_GATES)[number]))) return invalid('feature unlock is unknown')
  if (new Set(completedIds).size !== completedIds.length || new Set(trackedIds).size !== trackedIds.length
    || new Set(discoveries).size !== discoveries.length) return invalid('quest collections contain duplicates')
  for (const id of completedIds) {
    if (!/^[MS]\d{2}$/.test(id) || acceptedRecords[id] || !receipts[id]) return invalid(`completed quest ${id} is inconsistent`)
  }
  for (const id of trackedIds) if (!acceptedRecords[id]) return invalid(`tracked quest ${id} is not accepted`)
  for (const discovery of discoveries) {
    const match = /^([MS]\d{2})@(\d+):([^:]+):([^:]+)$/.exec(discovery)
    const definition = match ? resolver.get(match[1] as QuestId, Number(match[2])) : undefined
    const objective = definition?.objectives.find((entry) => entry.id === match?.[3])
    if (!definition || !objective?.earlyPrefix || !objective.targetIds.includes(match![4]!)) return invalid(`discovery ${discovery} is invalid`)
  }
  const driftwoodRescued = acceptedRecords.M01?.objectiveTargets.rescue_driftwood?.includes('survivor_driftwood')
    || discoveries.some((entry) => /^M01@\d+:rescue_driftwood:survivor_driftwood$/.test(entry)) || completedIds.includes('M01')
  if (driftwoodRescued && !featureUnlocks.includes('initial_survivor_count_known')) return invalid('initial survivor count gate is missing')
  for (const [questId, receipt] of Object.entries(receipts)) {
    if (!isRecord(receipt) || receipt.questId !== questId || receipt.characterId !== value.characterId
      || !safeCount(receipt.definitionVersion) || !safeCount(receipt.pendingXp) || !safeCount(receipt.currency)
      || !Array.isArray(receipt.items) || !receipt.items.every(validRewardItem) || !isRecord(receipt.choices)
      || Object.values(receipt.choices).some((choice) => typeof choice !== 'string')
      || (receipt.creditedClassId !== null && typeof receipt.creditedClassId !== 'string')) return invalid(`receipt ${questId} is invalid`)
    const definition = resolver.get(questId as QuestId, receipt.definitionVersion as number)
    if (!definition || definition.status !== 'playable' || !completedIds.includes(questId) || receipt.pendingXp !== definition.reward.pendingXp
      || receipt.currency !== definition.reward.currency || JSON.stringify(receipt.items) !== JSON.stringify(definition.reward.items)
      || !definition.prerequisites.every((id) => completedIds.includes(id))
      || !definition.gates.every((gate) => featureUnlocks.includes(gate))
      || !(definition.reward.unlocks ?? []).every((gate) => featureUnlocks.includes(gate))
      || !validChoices(definition, receipt.choices as Record<string, string>)
      || !choiceOutcomesComplete(definition, receipt.choices as Record<string, string>)
      || (receipt.creditedClassId !== null && !Object.hasOwn(classXp, receipt.creditedClassId as string))) return invalid(`receipt ${questId} does not match its definition`)
  }
  return { valid: true, state: value as unknown as CharacterQuestState }
}

function validAccepted(value: unknown): value is AcceptedQuestState {
  if (!isRecord(value) || !safeCount(value.definitionVersion) || !isRecord(value.objectiveTargets) || !isRecord(value.choices)) return false
  return Object.values(value.objectiveTargets).every(stringArray) && Object.values(value.choices).every((choice) => typeof choice === 'string')
}
function validateAcceptedProgress(definition: QuestDefinition, accepted: AcceptedQuestState): string | undefined {
  const objectives = new Map(definition.objectives.map((objective) => [objective.id, objective]))
  let incompleteSeen = false
  for (const objective of definition.objectives) {
    const targets = accepted.objectiveTargets[objective.id] ?? []
    if (new Set(targets).size !== targets.length || targets.length > objective.count
      || targets.some((target) => !objective.targetIds.includes(target))) return `${definition.id} objective ${objective.id} has invalid targets`
    if (incompleteSeen && targets.length > 0) return `${definition.id} objective progress is not a causal prefix`
    if (targets.length < objective.count) incompleteSeen = true
    const choice = accepted.choices[objective.id]
    if ((choice !== undefined && (!objective.choiceIds?.includes(choice) || targets.length === 0))
      || (targets.length > 0 && objective.choiceIds && choice === undefined)) return `${definition.id} objective ${objective.id} has an invalid choice`
  }
  for (const id of Object.keys(accepted.objectiveTargets)) if (!objectives.has(id)) return `${definition.id} has unknown objective progress ${id}`
  if (!validChoices(definition, accepted.choices)) return `${definition.id} has unknown choices`
  return undefined
}
function validChoices(definition: QuestDefinition, choices: Readonly<Record<string, string>>): boolean {
  return Object.entries(choices).every(([objectiveId, choice]) => definition.objectives
    .some((objective) => objective.id === objectiveId && objective.choiceIds?.includes(choice)))
}
function choiceOutcomesComplete(definition: QuestDefinition, choices: Readonly<Record<string, string>>): boolean {
  return definition.objectives.filter((objective) => objective.choiceIds).every((objective) => choices[objective.id] !== undefined)
}
function validReward(value: QuestDefinition['reward']): boolean {
  return safeCount(value.pendingXp) && safeCount(value.currency) && value.items.every(validRewardItem)
    && (value.unlocks ?? []).every((gate) => QUEST_GATES.includes(gate))
}
function validRewardItem(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.label === 'string' && safeCount(value.quantity)
}
function countRecord(value: unknown): boolean { return isRecord(value) && Object.values(value).every(safeCount) }
function safeCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string') }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function invalid(reason: string): QuestStateValidation { return { valid: false, reason } }
