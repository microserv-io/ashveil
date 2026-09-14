import type { CharacterQuestState } from '../quests'

export type QuestLoadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'loaded'; readonly snapshot: CharacterQuestState }
  | { readonly kind: 'invalid'; readonly reason: string }

export type QuestCommitResult =
  | { readonly kind: 'committed'; readonly snapshot: CharacterQuestState }
  | { readonly kind: 'conflict'; readonly current: CharacterQuestState }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string }

export interface QuestStateRepository {
  load(characterId: string): Promise<QuestLoadResult>
  commit(characterId: string, expectedRevision: number, nextSnapshot: CharacterQuestState): Promise<QuestCommitResult>
}
