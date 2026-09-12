import { validateQuestState } from '../quests'
import type { CharacterQuestState } from '../quests'
import type { QuestCommitResult, QuestLoadResult, QuestStateRepository } from './types'

export class MemoryQuestStateRepository implements QuestStateRepository {
  private readonly records = new Map<string, unknown>()
  private failNextCommitReason: string | undefined

  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [id, value] of Object.entries(initial)) this.records.set(id, structuredClone(value))
  }

  async load(characterId: string): Promise<QuestLoadResult> {
    const raw = this.records.get(characterId)
    if (raw === undefined) return { kind: 'missing' }
    const validation = validateQuestState(structuredClone(raw))
    if (validation.valid && validation.state.characterId !== characterId) return { kind: 'invalid', reason: 'stored character identity does not match its key' }
    return validation.valid ? { kind: 'loaded', snapshot: structuredClone(validation.state) }
      : { kind: 'invalid', reason: validation.reason }
  }

  async commit(characterId: string, expectedRevision: number, nextSnapshot: CharacterQuestState): Promise<QuestCommitResult> {
    if (this.failNextCommitReason) {
      const reason = this.failNextCommitReason
      this.failNextCommitReason = undefined
      return { kind: 'error', reason }
    }
    if (characterId !== nextSnapshot.characterId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || expectedRevision === Number.MAX_SAFE_INTEGER || nextSnapshot.revision !== expectedRevision) {
      return { kind: 'invalid', reason: 'commit identity or revision is invalid' }
    }
    const proposed = validateQuestState(nextSnapshot)
    if (!proposed.valid) return { kind: 'invalid', reason: proposed.reason }
    const raw = this.records.get(characterId)
    if (raw !== undefined) {
      const current = validateQuestState(raw)
      if (!current.valid) return { kind: 'invalid', reason: current.reason }
      if (current.state.characterId !== characterId) return { kind: 'invalid', reason: 'stored character identity does not match its key' }
      if (current.state.revision !== expectedRevision) return { kind: 'conflict', current: structuredClone(current.state) }
    } else if (expectedRevision !== 0) return { kind: 'invalid', reason: 'missing record cannot match a nonzero revision' }
    const committed = structuredClone({ ...nextSnapshot, revision: expectedRevision + 1 })
    this.records.set(characterId, committed)
    return { kind: 'committed', snapshot: structuredClone(committed) }
  }

  failNextCommit(reason = 'save failed'): void { this.failNextCommitReason = reason }
  raw(characterId: string): unknown { return structuredClone(this.records.get(characterId)) }
}
