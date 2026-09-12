import { validateQuestState } from '../quests'
import type { CharacterQuestState } from '../quests'
import type { QuestCommitResult, QuestLoadResult, QuestStateRepository } from './types'

const DATABASE_VERSION = 1
const DEFAULT_DATABASE = 'ashveil-offline-v1'
const DEFAULT_STORE = 'quest-character-snapshots'

export class IndexedDbQuestStateRepository implements QuestStateRepository {
  private database: Promise<IDBDatabase> | undefined

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = DEFAULT_DATABASE,
    private readonly storeName = DEFAULT_STORE,
  ) {}

  async load(characterId: string): Promise<QuestLoadResult> {
    try {
      const database = await this.open()
      const transaction = database.transaction(this.storeName, 'readonly')
      const raw = await requestValue(transaction.objectStore(this.storeName).get(characterId))
      await transactionDone(transaction)
      if (raw === undefined) return { kind: 'missing' }
      const validation = validateQuestState(raw)
      if (validation.valid && validation.state.characterId !== characterId) return { kind: 'invalid', reason: 'stored character identity does not match its key' }
      return validation.valid ? { kind: 'loaded', snapshot: structuredClone(validation.state) }
        : { kind: 'invalid', reason: validation.reason }
    } catch (error) {
      return { kind: 'invalid', reason: errorMessage(error) }
    }
  }

  async commit(characterId: string, expectedRevision: number, nextSnapshot: CharacterQuestState): Promise<QuestCommitResult> {
    if (characterId !== nextSnapshot.characterId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || expectedRevision === Number.MAX_SAFE_INTEGER || nextSnapshot.revision !== expectedRevision) {
      return { kind: 'invalid', reason: 'commit identity or revision is invalid' }
    }
    const proposed = validateQuestState(nextSnapshot)
    if (!proposed.valid) return { kind: 'invalid', reason: proposed.reason }
    try {
      const database = await this.open()
      const transaction = database.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const raw = await requestValue(store.get(characterId))
      if (raw !== undefined) {
        const current = validateQuestState(raw)
        if (!current.valid) {
          transaction.abort()
          await ignoreAbort(transaction)
          return { kind: 'invalid', reason: current.reason }
        }
        if (current.state.characterId !== characterId) {
          transaction.abort()
          await ignoreAbort(transaction)
          return { kind: 'invalid', reason: 'stored character identity does not match its key' }
        }
        if (current.state.revision !== expectedRevision) {
          transaction.abort()
          await ignoreAbort(transaction)
          return { kind: 'conflict', current: structuredClone(current.state) }
        }
      } else if (expectedRevision !== 0) {
        transaction.abort()
        await ignoreAbort(transaction)
        return { kind: 'invalid', reason: 'missing record cannot match a nonzero revision' }
      }
      const committed = structuredClone({ ...nextSnapshot, revision: expectedRevision + 1 })
      store.put(committed, characterId)
      await transactionDone(transaction)
      return { kind: 'committed', snapshot: committed }
    } catch (error) {
      return { kind: 'error', reason: errorMessage(error) }
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) request.result.createObjectStore(this.storeName)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked'))
    }).catch((error: unknown) => { this.database = undefined; throw error })
    this.database = opening
    return opening
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}
async function ignoreAbort(transaction: IDBTransaction): Promise<void> {
  try { await transactionDone(transaction) } catch { /* Expected abort keeps the stored record untouched. */ }
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
