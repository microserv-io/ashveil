import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createQuestState, reduceQuestIntent } from '../src/quests'
import { IndexedDbQuestStateRepository, MemoryQuestStateRepository } from '../src/persistence'

describe.each([
  ['memory', () => new MemoryQuestStateRepository()],
  ['IndexedDB', () => new IndexedDbQuestStateRepository(new IDBFactory(), `quest-test-${crypto.randomUUID()}`)],
] as const)('%s quest repository', (_name, repositoryFactory) => {
  it('atomically saves and reloads the whole snapshot with a repository-owned revision', async () => {
    const repository = repositoryFactory()
    let state = createQuestState('hero')
    state = reduceQuestIntent(state, { kind: 'accept', questId: 'M01', giverId: 'npc_mara' }).state
    const committed = await repository.commit('hero', 0, state)
    expect(committed).toMatchObject({ kind: 'committed', snapshot: { revision: 1, accepted: { M01: { definitionVersion: 1 } } } })
    expect(await repository.load('hero')).toEqual({ kind: 'loaded', snapshot: committed.kind === 'committed' ? committed.snapshot : undefined })
  })

  it('rejects stale and wrong-character commits without replacing the committed state', async () => {
    const repository = repositoryFactory()
    const first = await repository.commit('hero', 0, createQuestState('hero'))
    expect(first.kind).toBe('committed')
    const stale = { ...createQuestState('hero'), pendingXp: 999 }
    expect(await repository.commit('hero', 0, stale)).toMatchObject({ kind: 'conflict', current: { pendingXp: 0, revision: 1 } })
    expect(await repository.commit('hero', 1, createQuestState('other'))).toMatchObject({ kind: 'invalid' })
    expect(await repository.load('hero')).toMatchObject({ kind: 'loaded', snapshot: { pendingXp: 0, revision: 1 } })
  })

  it('requires the proposed revision to match CAS and refuses revision overflow', async () => {
    const repository = repositoryFactory()
    expect(await repository.commit('hero', 0, { ...createQuestState('hero'), revision: 1 })).toMatchObject({ kind: 'invalid' })
    expect(await repository.commit('hero', Number.MAX_SAFE_INTEGER, { ...createQuestState('hero'), revision: Number.MAX_SAFE_INTEGER })).toMatchObject({ kind: 'invalid' })
    expect(await repository.load('hero')).toEqual({ kind: 'missing' })
  })
})

describe('memory failure and malformed preservation', () => {
  it('preserves the last committed state after a recoverable write failure', async () => {
    const repository = new MemoryQuestStateRepository()
    const committed = await repository.commit('hero', 0, createQuestState('hero'))
    const state = committed.kind === 'committed' ? { ...committed.snapshot, currency: 50 } : createQuestState('hero')
    repository.failNextCommit('disk full')
    expect(await repository.commit('hero', 1, state)).toEqual({ kind: 'error', reason: 'disk full' })
    expect(await repository.load('hero')).toMatchObject({ kind: 'loaded', snapshot: { currency: 0, revision: 1 } })
  })

  it('reports corrupt and future saves without overwriting their raw records', async () => {
    const future = { ...createQuestState('future'), schemaVersion: 2 }
    const corrupt = { schemaVersion: 1, characterId: 'corrupt', revision: 'broken' }
    const repository = new MemoryQuestStateRepository({ future, corrupt })
    expect(await repository.load('future')).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('unsupported save schema') })
    expect(await repository.load('corrupt')).toMatchObject({ kind: 'invalid' })
    expect(await repository.commit('future', 0, createQuestState('future'))).toMatchObject({ kind: 'invalid' })
    expect(repository.raw('future')).toEqual(future)
    expect(repository.raw('corrupt')).toEqual(corrupt)
  })

  it('does not expose a valid character stored under another character key', async () => {
    const other = createQuestState('other')
    const repository = new MemoryQuestStateRepository({ hero: other })
    expect(await repository.load('hero')).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('identity') })
    expect(repository.raw('hero')).toEqual(other)
  })
})

describe('IndexedDB compare-and-swap', () => {
  it('serializes concurrent stale tabs so only one state is committed', async () => {
    const factory = new IDBFactory()
    const database = `quest-cas-${crypto.randomUUID()}`
    const firstTab = new IndexedDbQuestStateRepository(factory, database)
    const secondTab = new IndexedDbQuestStateRepository(factory, database)
    await firstTab.commit('hero', 0, createQuestState('hero'))
    const loadedA = await firstTab.load('hero')
    const loadedB = await secondTab.load('hero')
    if (loadedA.kind !== 'loaded' || loadedB.kind !== 'loaded') throw new Error('fixture did not load')
    const [a, b] = await Promise.all([
      firstTab.commit('hero', 1, { ...loadedA.snapshot, currency: 2 }),
      secondTab.commit('hero', 1, { ...loadedB.snapshot, currency: 3 }),
    ])
    expect([a.kind, b.kind].sort()).toEqual(['committed', 'conflict'])
    const current = await firstTab.load('hero')
    expect(current).toMatchObject({ kind: 'loaded', snapshot: { revision: 2 } })
    if (current.kind === 'loaded') expect([2, 3]).toContain(current.snapshot.currency)
  })

  it('preserves a corrupt raw record instead of resetting it', async () => {
    const factory = new IDBFactory()
    const database = `quest-corrupt-${crypto.randomUUID()}`
    const corrupt = { schemaVersion: 99, characterId: 'hero', revision: 0, payload: 'keep me' }
    await putRaw(factory, database, 'hero', corrupt)
    const repository = new IndexedDbQuestStateRepository(factory, database)
    expect(await repository.load('hero')).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('unsupported save schema') })
    expect(await repository.commit('hero', 0, createQuestState('hero'))).toMatchObject({ kind: 'invalid' })
    expect(await getRaw(factory, database, 'hero')).toEqual(corrupt)
  })
})

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('quest-character-snapshots')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putRaw(factory: IDBFactory, database: string, key: string, value: unknown): Promise<void> {
  const db = await openDatabase(factory, database)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('quest-character-snapshots', 'readwrite')
    transaction.objectStore('quest-character-snapshots').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

async function getRaw(factory: IDBFactory, database: string, key: string): Promise<unknown> {
  const db = await openDatabase(factory, database)
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('quest-character-snapshots', 'readonly').objectStore('quest-character-snapshots').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value
}
