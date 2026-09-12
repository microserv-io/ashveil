export type QuestId = `M${string}` | `S${string}`
export type QuestTargetId = string
export type QuestDefinitionVersion = number

export type QuestCategory = 'main' | 'side'
export type QuestImplementationStatus = 'playable' | 'planned'
export type QuestSceneKind = 'arrival' | 'offer' | 'reply' | 'followup' | 'context' | 'reminder' | 'completion' | 'choice'
export type QuestCredit = 'shared' | 'personal'
export const QUEST_GATES = [
  'arrived_alderbank', 'iven_introduction_heard', 'initial_survivor_count_known',
  'basic_social_access', 'altered_ward_evidence',
] as const
export type QuestGate = (typeof QUEST_GATES)[number]

export interface DialogueLine {
  readonly speaker: string
  readonly text: string
  readonly choiceId?: string
}

export interface DialogueScene {
  readonly id: string
  readonly kind: QuestSceneKind
  readonly lines: readonly DialogueLine[]
}

export interface QuestObjectiveDefinition {
  readonly id: string
  readonly label: string
  readonly targetIds: readonly QuestTargetId[]
  readonly count: number
  readonly credit: QuestCredit
  readonly earlyPrefix?: boolean
  readonly choiceIds?: readonly string[]
}

export interface QuestRewardItem {
  readonly id: string
  readonly label: string
  readonly quantity: number
}

export interface QuestRewardSpec {
  readonly pendingXp: number
  readonly currency: number
  readonly items: readonly QuestRewardItem[]
  readonly unlocks?: readonly QuestGate[]
}

export interface QuestDefinition {
  readonly id: QuestId
  readonly version: QuestDefinitionVersion
  readonly category: QuestCategory
  readonly status: QuestImplementationStatus
  readonly chapter: string
  readonly outing: string
  readonly title: string
  readonly giverId: QuestTargetId
  readonly turnInId: QuestTargetId
  readonly location: string
  readonly summary: string
  readonly source: string
  readonly prerequisites: readonly QuestId[]
  readonly gates: readonly QuestGate[]
  readonly objectives: readonly QuestObjectiveDefinition[]
  readonly scenes: readonly DialogueScene[]
  readonly reward: QuestRewardSpec
  readonly unavailableReason?: string
}

export interface AcceptedQuestState {
  readonly definitionVersion: QuestDefinitionVersion
  readonly objectiveTargets: Readonly<Record<string, readonly QuestTargetId[]>>
  readonly choices: Readonly<Record<string, string>>
}

export interface RewardReceipt {
  readonly characterId: string
  readonly questId: QuestId
  readonly definitionVersion: QuestDefinitionVersion
  readonly pendingXp: number
  readonly currency: number
  readonly items: readonly QuestRewardItem[]
  readonly choices: Readonly<Record<string, string>>
  readonly creditedClassId: string | null
}

export interface CharacterQuestState {
  readonly schemaVersion: 1
  readonly characterId: string
  readonly revision: number
  readonly accepted: Readonly<Record<string, AcceptedQuestState>>
  readonly completedIds: readonly QuestId[]
  readonly discoveries: readonly string[]
  readonly trackedIds: readonly QuestId[]
  readonly featureUnlocks: readonly QuestGate[]
  readonly pendingXp: number
  readonly classXp: Readonly<Record<string, number>>
  readonly firstClassId?: string
  readonly activeClassId?: string
  readonly currency: number
  readonly rewardInventory: Readonly<Record<string, number>>
  readonly receipts: Readonly<Record<string, RewardReceipt>>
}

export type QuestIntent =
  | { readonly kind: 'accept'; readonly questId: QuestId; readonly giverId: QuestTargetId }
  | { readonly kind: 'interact'; readonly targetId: QuestTargetId; readonly questId?: QuestId; readonly objectiveId?: string }
  | { readonly kind: 'choose'; readonly questId: QuestId; readonly objectiveId: string; readonly choiceId: string; readonly targetId: QuestTargetId }
  | { readonly kind: 'turn_in'; readonly questId: QuestId; readonly turnInId: QuestTargetId }
  | { readonly kind: 'track'; readonly questId: QuestId; readonly tracked: boolean }

export type QuestMutationError =
  | 'unknown_quest' | 'planned_quest' | 'unavailable' | 'wrong_giver' | 'already_accepted'
  | 'not_accepted' | 'wrong_target' | 'wrong_choice' | 'not_ready' | 'wrong_turn_in'
  | 'already_completed' | 'invalid_state' | 'numeric_overflow' | 'ambiguous_target'

export interface QuestMutationResult {
  readonly state: CharacterQuestState
  readonly changed: boolean
  readonly error?: QuestMutationError
  readonly scenes: readonly DialogueScene[]
}

export interface SharedQuestEvent {
  readonly targetId: QuestTargetId
  readonly participantCharacterIds: readonly string[]
}

export interface QuestDefinitionResolver {
  get(id: QuestId, version?: QuestDefinitionVersion): QuestDefinition | undefined
  all(): readonly QuestDefinition[]
}

export interface QuestJournalEntry {
  readonly id: QuestId
  readonly category: QuestCategory
  readonly title: string
  readonly status: 'available' | 'active' | 'ready' | 'completed' | 'planned' | 'locked'
  readonly label: 'Main Story' | 'Optional Side Quest'
  readonly summary: string
  readonly location: string
  readonly nextObjective?: QuestObjectiveDefinition
  readonly reward: QuestRewardSpec
  readonly unavailableReason?: string
}
