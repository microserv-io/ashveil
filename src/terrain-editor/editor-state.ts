import type { WorldPoint, ZoneDefinition } from '../world/zone-types'
import { compileZone, parseZoneDefinitionJson } from '../world/zone-compiler'

export type EditorControl =
  | { readonly kind: 'landmark'; readonly id: string }
  | { readonly kind: 'path'; readonly id: string; readonly index: number }
  | { readonly kind: 'ridge'; readonly id: string; readonly index: number }
  | { readonly kind: 'river'; readonly index: number }

function copyDefinition(definition: ZoneDefinition): ZoneDefinition {
  return structuredClone(definition)
}

function movedPoint(point: WorldPoint, x: number, z: number): WorldPoint {
  return { ...point, x, z }
}

export function moveEditorControl(
  definition: ZoneDefinition,
  control: EditorControl,
  x: number,
  z: number,
): ZoneDefinition {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return definition
  if (control.kind === 'landmark') {
    const landmark = definition.landmarks.find((candidate) => candidate.id === control.id)
    if (!landmark) return definition
    const dx = x - landmark.x
    const dz = z - landmark.z
    return {
      ...definition,
      landmarks: definition.landmarks.map((candidate) => candidate.id === control.id ? { ...candidate, x, z } : candidate),
      paths: definition.paths.map((path) => {
        let points = [...path.points]
        if (path.from === control.id) points[0] = movedPoint(points[0]!, points[0]!.x + dx, points[0]!.z + dz)
        if (path.to === control.id) {
          const index = points.length - 1
          points[index] = movedPoint(points[index]!, points[index]!.x + dx, points[index]!.z + dz)
        }
        return { ...path, points }
      }),
    }
  }
  if (control.kind === 'path') return {
    ...definition,
    paths: definition.paths.map((path) => path.id === control.id
      ? { ...path, points: path.points.map((point, index) => index === control.index ? movedPoint(point, x, z) : point) }
      : path),
  }
  if (control.kind === 'ridge') return {
    ...definition,
    ridges: definition.ridges.map((ridge) => ridge.id === control.id
      ? { ...ridge, points: ridge.points.map((point, index) => index === control.index ? movedPoint(point, x, z) : point) }
      : ridge),
  }
  return {
    ...definition,
    river: {
      ...definition.river,
      points: definition.river.points.map((point, index) => index === control.index ? { ...point, x, z } : point),
    },
  }
}

export class EditorHistory {
  private readonly authored: ZoneDefinition
  private saved: ZoneDefinition
  private past: ZoneDefinition[] = []
  private present: ZoneDefinition
  private future: ZoneDefinition[] = []

  constructor(definition: ZoneDefinition) {
    this.authored = copyDefinition(definition)
    this.saved = copyDefinition(definition)
    this.present = copyDefinition(definition)
  }

  get current(): ZoneDefinition { return this.present }
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  get isDirty(): boolean { return JSON.stringify(this.present) !== JSON.stringify(this.saved) }

  apply(definition: ZoneDefinition): void {
    if (JSON.stringify(definition) === JSON.stringify(this.present)) return
    this.past.push(this.present)
    if (this.past.length > 100) this.past.shift()
    this.present = copyDefinition(definition)
    this.future = []
  }

  replace(definition: ZoneDefinition): void {
    this.apply(definition)
  }

  loadSaved(definition: ZoneDefinition): void {
    this.present = copyDefinition(definition)
    this.saved = copyDefinition(definition)
    this.past = []
    this.future = []
  }

  undo(): void {
    const previous = this.past.pop()
    if (!previous) return
    this.future.push(this.present)
    this.present = previous
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.present)
    this.present = next
  }

  reset(): void {
    if (JSON.stringify(this.present) === JSON.stringify(this.authored)) return
    this.past.push(this.present)
    this.present = copyDefinition(this.authored)
    this.future = []
  }

  markSaved(): void { this.saved = copyDefinition(this.present) }
}

export function createEditorHistory(definition: ZoneDefinition): EditorHistory {
  return new EditorHistory(definition)
}

export function importEditorDefinition(history: EditorHistory, text: string): ZoneDefinition {
  const definition = parseZoneDefinitionJson(text)
  compileZone(definition)
  history.replace(definition)
  return definition
}
