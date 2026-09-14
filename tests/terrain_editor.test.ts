import { describe, expect, it } from 'vitest'
import { createEditorHistory, importEditorDefinition, moveEditorControl } from '../src/terrain-editor/editor-state'
import { DEFAULT_ZONE } from '../src/world/zone-default'
import { loadZoneDraft, saveZoneDraft, ZONE_DRAFT_STORAGE_KEY } from '../src/world/zone-draft'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('terrain editor state', () => {
  it('moves a landmark with its connected path endpoints and supports undo and redo', () => {
    const history = createEditorHistory(DEFAULT_ZONE)
    const refuge = DEFAULT_ZONE.landmarks.find((landmark) => landmark.id === 'refuge')!
    const changed = moveEditorControl(history.current, { kind: 'landmark', id: 'refuge' }, refuge.x + 24, refuge.z - 12)

    history.apply(changed)
    expect(history.current.landmarks.find((landmark) => landmark.id === 'refuge')).toMatchObject({ x: refuge.x + 24, z: refuge.z - 12 })
    for (const path of history.current.paths.filter((path) => path.from === 'refuge')) {
      expect(path.points[0]).toEqual({ x: refuge.x + 24, z: refuge.z - 12 })
    }

    history.undo()
    expect(history.current).toEqual(DEFAULT_ZONE)
    history.redo()
    expect(history.current).toEqual(changed)
  })

  it('moves hill and barrier controls without changing their authored profile', () => {
    const hill = DEFAULT_ZONE.terrain.landforms!.find((landform) => landform.kind === 'hill')!
    const moved = moveEditorControl(DEFAULT_ZONE, { kind: 'landform', id: hill.id, index: 1 }, 12, 34)
    expect(moved.terrain.landforms!.find((landform) => landform.id === hill.id)).toEqual({
      ...hill,
      points: [hill.points[0], { x: 12, z: 34 }, ...hill.points.slice(2)],
    })
  })

  it('clears redo after a new edit and reset restores the authored default', () => {
    const history = createEditorHistory(DEFAULT_ZONE)
    const changed = moveEditorControl(history.current, { kind: 'path', id: 'lower-road', index: 1 }, -200, 100)
    history.apply(changed)
    history.undo()
    history.apply(moveEditorControl(history.current, { kind: 'river', index: 2 }, 300, -120))
    expect(history.canRedo).toBe(false)
    history.reset()
    expect(history.current).toEqual(DEFAULT_ZONE)
    expect(history.isDirty).toBe(false)
  })

  it('loads a saved draft as clean while reset still restores the committed default', () => {
    const history = createEditorHistory(DEFAULT_ZONE)
    const draft = moveEditorControl(history.current, { kind: 'path', id: 'lower-road', index: 1 }, -200, 100)
    history.loadSaved(draft)
    expect(history.isDirty).toBe(false)
    history.reset()
    expect(history.current).toEqual(DEFAULT_ZONE)
    expect(history.isDirty).toBe(true)
  })

  it('bounds undo history while preserving recent edits', () => {
    const history = createEditorHistory(DEFAULT_ZONE)
    const start = DEFAULT_ZONE.landmarks.find((landmark) => landmark.id === 'refuge')!
    for (let step = 1; step <= 120; step += 1) {
      history.apply(moveEditorControl(history.current, { kind: 'landmark', id: 'refuge' }, start.x + step, start.z))
    }
    for (let step = 0; step < 100; step += 1) history.undo()
    expect(history.canUndo).toBe(false)
    expect(history.current.landmarks.find((landmark) => landmark.id === 'refuge')!.x).toBe(start.x + 20)
  })

  it('applies only fully valid imported definitions', () => {
    const history = createEditorHistory(DEFAULT_ZONE)
    expect(() => importEditorDefinition(history, '{bad')).toThrow(/valid JSON/)
    expect(history.current).toEqual(DEFAULT_ZONE)

    const point = DEFAULT_ZONE.paths.find((path) => path.id === 'lower-road')!.points[2]!
    const imported = moveEditorControl(DEFAULT_ZONE, { kind: 'path', id: 'lower-road', index: 2 }, point.x + 1, point.z + 1)
    importEditorDefinition(history, JSON.stringify(imported))
    expect(history.current).toEqual(imported)
  })
})

describe('zone browser drafts', () => {
  it('round-trips a valid draft and compiles it before saving', () => {
    const storage = new MemoryStorage()
    const saved = saveZoneDraft(storage, DEFAULT_ZONE)
    expect(saved.mainRoute.runSeconds).toBeCloseTo(300, 6)
    expect(loadZoneDraft(storage)).toMatchObject({ kind: 'valid', definition: DEFAULT_ZONE })
  })

  it('loads and edits a serialized old draft without silently writing landforms', () => {
    const storage = new MemoryStorage()
    const legacy = structuredClone(DEFAULT_ZONE) as typeof DEFAULT_ZONE & { terrain: { landforms?: unknown } }
    delete legacy.terrain.landforms
    const original = JSON.stringify(legacy)
    storage.setItem(ZONE_DRAFT_STORAGE_KEY, original)
    const loaded = loadZoneDraft(storage)
    expect(loaded.kind).toBe('valid')
    if (loaded.kind !== 'valid') return
    expect(loaded.definition.terrain.landforms).toBeUndefined()

    const history = createEditorHistory(DEFAULT_ZONE)
    history.loadSaved(loaded.definition)
    const ridge = history.current.ridges[0]!
    history.apply(moveEditorControl(history.current, { kind: 'ridge', id: ridge.id, index: 1 },
      ridge.points[1]!.x + 1, ridge.points[1]!.z))
    history.undo()
    history.redo()
    expect(JSON.parse(JSON.stringify(history.current)).terrain.landforms).toBeUndefined()
    expect(storage.getItem(ZONE_DRAFT_STORAGE_KEY)).toBe(original)

    saveZoneDraft(storage, history.current)
    expect(JSON.parse(storage.getItem(ZONE_DRAFT_STORAGE_KEY)!).terrain.landforms).toBeUndefined()
  })

  it('rejects invalid drafts without overwriting the preceding valid value', () => {
    const storage = new MemoryStorage()
    saveZoneDraft(storage, DEFAULT_ZONE)
    const preceding = storage.getItem(ZONE_DRAFT_STORAGE_KEY)
    expect(() => saveZoneDraft(storage, { ...DEFAULT_ZONE, spawn: { landmarkId: 'missing', offset: { x: 0, z: 0 } } }))
      .toThrow(/spawn|landmark/i)
    expect(storage.getItem(ZONE_DRAFT_STORAGE_KEY)).toBe(preceding)
  })

  it('reports malformed and oversized stored drafts without deleting them', () => {
    const storage = new MemoryStorage()
    storage.setItem(ZONE_DRAFT_STORAGE_KEY, '{bad')
    expect(loadZoneDraft(storage)).toMatchObject({ kind: 'invalid' })
    expect(storage.getItem(ZONE_DRAFT_STORAGE_KEY)).toBe('{bad')

    storage.setItem(ZONE_DRAFT_STORAGE_KEY, 'x'.repeat(512 * 1024 + 1))
    expect(loadZoneDraft(storage)).toMatchObject({ kind: 'invalid', reason: expect.stringMatching(/512 KiB/) })
  })
})
