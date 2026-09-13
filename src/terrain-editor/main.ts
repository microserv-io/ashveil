import './editor.css'
import { compileZone, validateZoneDefinition } from '../world/zone-compiler'
import { DEFAULT_ZONE } from '../world/zone-default'
import { loadZoneDraft, saveZoneDraft } from '../world/zone-draft'
import type { TerrainStrokeMode } from '../world/zone-types'
import { createEditorHistory, importEditorDefinition, moveEditorControl, type EditorControl } from './editor-state'
import { drawTerrainMap, eventWorldPoint, loadReferenceMap, renderControlOverlay } from './editor-map'

const root = document.querySelector<HTMLElement>('#terrain-editor')
if (!root) throw new Error('Terrain editor root is missing')

root.innerHTML = `
  <section class="editor-shell">
    <header class="flex flex-wrap items-center gap-2 border-b border-amber-100/15 bg-stone-950 px-3 py-3 sm:px-5">
      <div class="mr-auto min-w-48">
        <p class="text-[.62rem] font-semibold uppercase tracking-[.24em] text-amber-200/60">Private authoring tool</p>
        <h1 class="font-serif text-xl text-stone-50">Alderbank terrain</h1>
      </div>
      <button data-action="undo" class="rounded-md border border-stone-600 px-3 py-2 text-sm">Undo</button>
      <button data-action="redo" class="rounded-md border border-stone-600 px-3 py-2 text-sm">Redo</button>
      <button data-action="reset" class="rounded-md border border-stone-600 px-3 py-2 text-sm">Reset</button>
      <button data-action="save" class="rounded-md border border-amber-200/30 bg-amber-100/10 px-3 py-2 text-sm text-amber-50">Save draft</button>
      <button data-action="export" class="rounded-md border border-stone-600 px-3 py-2 text-sm">Export JSON</button>
      <button data-action="import" class="rounded-md border border-stone-600 px-3 py-2 text-sm">Import JSON</button>
      <input id="zone-import" class="sr-only" type="file" accept="application/json,.json" />
      <a id="play-draft" href="${import.meta.env.BASE_URL}?zoneDraft=1" class="rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white">Play saved draft</a>
    </header>
    <section class="editor-body">
      <section class="min-w-0 bg-stone-900 p-2 sm:p-4" aria-label="Top-down terrain map">
        <div class="mb-2 flex flex-wrap gap-2" role="toolbar" aria-label="Terrain brush">
          <button data-brush="select" class="tool-active rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-xs">Select and drag</button>
          <button data-brush="raise" class="rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-xs">Raise terrain</button>
          <button data-brush="lower" class="rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-xs">Lower terrain</button>
          <button data-brush="smooth" class="rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-xs">Smooth terrain</button>
          <label class="field ml-auto w-28">Brush radius<input id="brush-radius" type="number" min="3" max="150" step="1" value="36" /></label>
          <label class="field w-28">Brush amount<input id="brush-amount" type="number" min="0.1" max="100" step="0.5" value="4" /></label>
          <label class="field w-32">Reference opacity<input id="reference-opacity" type="range" min="0" max="0.65" step="0.05" value="0.3" /></label>
        </div>
        <div class="map-stage rounded-lg border border-amber-100/15 shadow-2xl">
          <canvas id="terrain-map" aria-hidden="true"></canvas>
          <svg id="terrain-controls" role="application" aria-label="Editable landmarks and terrain controls"></svg>
        </div>
        <p class="mt-2 text-xs leading-5 text-stone-400">The map artwork is a translucent planning overlay. Gold points are landmarks, cream points are road controls, grey points are ridges, and blue points shape the river. Drag commits on release.</p>
      </section>
      <aside class="editor-panel p-4 sm:p-5" aria-label="Terrain inspector">
        <section aria-labelledby="status-title">
          <h2 id="status-title" class="font-serif text-lg">Definition status</h2>
          <p id="compile-state" class="mt-2 rounded-lg border border-stone-700 bg-stone-950 p-3 text-sm leading-5" role="status">Compiling terrain…</p>
          <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-md bg-stone-800 p-2"><dt class="text-xs text-stone-400">Road distance</dt><dd id="route-distance">—</dd></div>
            <div class="rounded-md bg-stone-800 p-2"><dt class="text-xs text-stone-400">Run time</dt><dd id="route-time">—</dd></div>
          </dl>
          <p id="unsaved-state" class="mt-2 text-xs font-medium text-stone-400">Committed default · no saved draft</p>
        </section>
        <section class="mt-6 border-t border-stone-700 pt-5" aria-labelledby="selection-title">
          <h2 id="selection-title" class="font-serif text-lg">Selected control</h2>
          <div id="selection-fields" class="mt-3 grid gap-3"><p class="text-sm text-stone-400">Choose a point on the map.</p></div>
        </section>
        <section class="mt-6 border-t border-stone-700 pt-5">
          <h2 class="font-serif text-lg">Validation</h2>
          <ul id="validation-errors" class="mt-2 grid gap-2 text-sm text-red-200"></ul>
        </section>
      </aside>
    </section>
  </section>`

const history = createEditorHistory(DEFAULT_ZONE)
const canvas = required<HTMLCanvasElement>('#terrain-map')
const svg = required<SVGSVGElement>('#terrain-controls')
const status = required<HTMLElement>('#compile-state')
const errors = required<HTMLUListElement>('#validation-errors')
const distance = required<HTMLElement>('#route-distance')
const runTime = required<HTMLElement>('#route-time')
const unsaved = required<HTMLElement>('#unsaved-state')
const fields = required<HTMLElement>('#selection-fields')
const importInput = required<HTMLInputElement>('#zone-import')
let activeControl: EditorControl | null = null
let dragging: { control: EditorControl; startX: number; startY: number; moved: boolean } | null = null
let brush: 'select' | TerrainStrokeMode = 'select'
let reference: HTMLImageElement | undefined
let renderedZone: ReturnType<typeof compileZone> | undefined
let compileTimer: number | undefined
let storedDraftError: string | undefined
let hasSavedDraft = false

function required<T extends Element>(selector: string): T {
  const element = root!.querySelector<T>(selector)
  if (!element) throw new Error(`Terrain editor control is missing: ${selector}`)
  return element
}

function controlFrom(element: Element): EditorControl | null {
  const kind = element.getAttribute('data-kind') as EditorControl['kind'] | null
  const id = element.getAttribute('data-id') ?? undefined
  const indexValue = element.getAttribute('data-index')
  const index = indexValue === null ? undefined : Number(indexValue)
  if (kind === 'landmark' && id) return { kind, id }
  if ((kind === 'path' || kind === 'ridge') && id && Number.isInteger(index)) return { kind, id, index: index! }
  if (kind === 'river' && Number.isInteger(index)) return { kind, index: index! }
  return null
}

function currentPoint(control: EditorControl): { x: number; z: number } | undefined {
  if (control.kind === 'landmark') return history.current.landmarks.find((item) => item.id === control.id)
  if (control.kind === 'path') return history.current.paths.find((item) => item.id === control.id)?.points[control.index]
  if (control.kind === 'ridge') return history.current.ridges.find((item) => item.id === control.id)?.points[control.index]
  return history.current.river.points[control.index]
}

function renderInspector(): void {
  if (!activeControl) {
    fields.innerHTML = '<p class="text-sm text-stone-400">Choose a point on the map.</p>'
    return
  }
  const control = activeControl
  const point = currentPoint(control)
  if (!point) return
  const title = control.kind === 'river' ? `River point ${control.index + 1}`
    : `${control.kind} ${control.id}${'index' in control ? ` · point ${control.index + 1}` : ''}`
  let details = ''
  if (control.kind === 'landmark') {
    const item = history.current.landmarks.find((candidate) => candidate.id === control.id)!
    details = numberField('Landmark radius', 'selected-radius', item.radius, 1, 150)
  } else if (control.kind === 'path') {
    const item = history.current.paths.find((candidate) => candidate.id === control.id)!
    details = numberField('Road width', 'selected-width', item.width, 2, 100)
  } else if (control.kind === 'ridge') {
    const item = history.current.ridges.find((candidate) => candidate.id === control.id)!
    details = numberField('Ridge half-width', 'selected-width', item.halfWidth, 10, 400)
      + numberField('Ridge height', 'selected-height', item.height, 0, 500)
  } else {
    const item = history.current.river.points[control.index]!
    details = numberField('River half-width', 'selected-width', item.halfWidth, 4, 300)
      + numberField('River depth', 'selected-depth', item.depth, 0.1, 100)
  }
  fields.innerHTML = `<p class="text-sm font-medium text-amber-100">${title}</p>
    ${numberField('World X', 'selected-x', point.x, -5000, 5000)}
    ${numberField('World Z', 'selected-z', point.z, -5000, 5000)}${details}
    <button data-action="apply-selection" class="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white">Apply selected values</button>`
}

function numberField(label: string, id: string, value: number, min: number, max: number): string {
  return `<label class="field">${label}<input id="${id}" type="number" min="${min}" max="${max}" step="0.1" value="${Number(value.toFixed(4))}" /></label>`
}

function scheduleCompile(): void {
  window.clearTimeout(compileTimer)
  status.textContent = 'Waiting to compile the latest edit…'
  status.className = 'mt-2 rounded-lg border border-amber-300/30 bg-stone-950 p-3 text-sm leading-5 text-amber-100'
  compileTimer = window.setTimeout(compileAndRender, 180)
  updateButtons()
}

function compileAndRender(): void {
  errors.replaceChildren()
  const validation = validateZoneDefinition(history.current)
  try {
    const zone = compileZone(history.current)
    status.textContent = 'Valid and ready to save or play.'
    status.className = 'mt-2 rounded-lg border border-teal-300/30 bg-stone-950 p-3 text-sm leading-5 text-teal-100'
    distance.textContent = `${Math.round(zone.mainRoute.length).toLocaleString()} units`
    runTime.textContent = `${Math.floor(zone.mainRoute.runSeconds / 60)}m ${Math.round(zone.mainRoute.runSeconds % 60)}s`
    if (Math.abs(zone.mainRoute.runSeconds - 300) > 15) {
      status.textContent = `Valid draft. Its main-road run time is ${Math.round(zone.mainRoute.runSeconds)} seconds; the committed target is 300 ±15 seconds.`
    }
    if (storedDraftError) {
      const item = document.createElement('li')
      item.className = 'rounded-md border border-red-300/20 bg-red-950/30 p-2'
      item.textContent = `Saved draft was not loaded: ${storedDraftError}. The committed definition is shown.`
      errors.append(item)
      status.textContent = 'The committed definition is shown because the saved draft is invalid.'
    }
    renderedZone = zone
    drawTerrainMap(canvas, zone, reference, required<HTMLInputElement>('#reference-opacity').valueAsNumber)
  } catch (error) {
    const messages = validation.length ? validation : [error instanceof Error ? error.message : String(error)]
    for (const message of messages) {
      const item = document.createElement('li')
      item.className = 'rounded-md border border-red-300/20 bg-red-950/30 p-2'
      item.textContent = message
      errors.append(item)
    }
    status.textContent = 'This definition cannot be saved or played.'
    status.className = 'mt-2 rounded-lg border border-red-300/30 bg-stone-950 p-3 text-sm leading-5 text-red-100'
    distance.textContent = '—'
    runTime.textContent = '—'
  }
  renderControlOverlay(svg, history.current, activeControl)
  renderInspector()
  updateButtons()
}

function updateButtons(): void {
  required<HTMLButtonElement>('[data-action="undo"]').disabled = !history.canUndo
  required<HTMLButtonElement>('[data-action="redo"]').disabled = !history.canRedo
  unsaved.textContent = history.isDirty ? 'Unsaved changes' : hasSavedDraft ? 'Saved browser draft' : 'Committed default · no saved draft'
  unsaved.className = `mt-2 text-xs font-medium ${history.isDirty ? 'text-amber-300' : 'text-stone-400'}`
  const play = required<HTMLAnchorElement>('#play-draft')
  play.setAttribute('aria-disabled', String(!hasSavedDraft))
  play.tabIndex = hasSavedDraft ? 0 : -1
  play.classList.toggle('pointer-events-none', !hasSavedDraft)
  play.classList.toggle('opacity-40', !hasSavedDraft)
}

function applySelectedValues(): void {
  if (!activeControl) return
  const control = activeControl
  const x = required<HTMLInputElement>('#selected-x').valueAsNumber
  const z = required<HTMLInputElement>('#selected-z').valueAsNumber
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    showActionError(new Error('World X and Z must both be finite numbers.'))
    return
  }
  let definition = moveEditorControl(history.current, control, x, z)
  const width = root!.querySelector<HTMLInputElement>('#selected-width')?.valueAsNumber
  const height = root!.querySelector<HTMLInputElement>('#selected-height')?.valueAsNumber
  const depth = root!.querySelector<HTMLInputElement>('#selected-depth')?.valueAsNumber
  const radius = root!.querySelector<HTMLInputElement>('#selected-radius')?.valueAsNumber
  if (control.kind === 'landmark' && Number.isFinite(radius)) definition = {
    ...definition, landmarks: definition.landmarks.map((item) => item.id === control.id ? { ...item, radius: radius! } : item),
  }
  if (control.kind === 'path' && Number.isFinite(width)) definition = {
    ...definition, paths: definition.paths.map((item) => item.id === control.id ? { ...item, width: width! } : item),
  }
  if (control.kind === 'ridge') definition = {
    ...definition,
    ridges: definition.ridges.map((item) => item.id === control.id
      ? { ...item, halfWidth: Number.isFinite(width) ? width! : item.halfWidth, height: Number.isFinite(height) ? height! : item.height }
      : item),
  }
  if (control.kind === 'river') definition = {
    ...definition,
    river: { ...definition.river, points: definition.river.points.map((item, index) => index === control.index
      ? { ...item, halfWidth: Number.isFinite(width) ? width! : item.halfWidth, depth: Number.isFinite(depth) ? depth! : item.depth }
      : item) },
  }
  history.apply(definition)
  storedDraftError = undefined
  scheduleCompile()
}

function addStroke(point: { x: number; z: number }, mode: TerrainStrokeMode): void {
  const radius = required<HTMLInputElement>('#brush-radius').valueAsNumber
  const amount = required<HTMLInputElement>('#brush-amount').valueAsNumber
  if (!Number.isFinite(radius) || radius < 3 || radius > 150 || !Number.isFinite(amount) || amount <= 0 || amount > 100) {
    showActionError(new Error('Brush radius must be 3–150 and amount must be greater than 0 and no more than 100.'))
    return
  }
  let suffix = history.current.terrain.strokes.length + 1
  const ids = new Set(history.current.terrain.strokes.map((stroke) => stroke.id))
  while (ids.has(`stroke-${suffix}`)) suffix += 1
  history.apply({
    ...history.current,
    terrain: { ...history.current.terrain, strokes: [...history.current.terrain.strokes, { id: `stroke-${suffix}`, mode, x: point.x, z: point.z, radius, amount }] },
  })
  storedDraftError = undefined
  scheduleCompile()
}

root.addEventListener('click', (event) => {
  const target = event.target as Element
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'undo') { history.undo(); storedDraftError = undefined; scheduleCompile() }
  if (action === 'redo') { history.redo(); storedDraftError = undefined; scheduleCompile() }
  if (action === 'reset') { history.reset(); storedDraftError = undefined; activeControl = null; scheduleCompile() }
  if (action === 'apply-selection') applySelectedValues()
  if (action === 'save') {
    try {
      saveZoneDraft(localStorage, history.current)
      history.markSaved()
      hasSavedDraft = true
      storedDraftError = undefined
      status.textContent = 'Draft saved in this browser.'
      updateButtons()
    } catch (error) { showActionError(error) }
  }
  if (action === 'export') exportDefinition()
  if (action === 'import') importInput.click()
  const brushButton = target.closest<HTMLElement>('[data-brush]')
  if (brushButton) {
    brush = brushButton.dataset.brush as typeof brush
    root!.querySelectorAll('[data-brush]').forEach((button) => button.classList.toggle('tool-active', button === brushButton))
  }
})

svg.addEventListener('pointerdown', (event) => {
  const controlElement = (event.target as Element).closest('[data-kind]')
  const control = controlElement ? controlFrom(controlElement) : null
  dragging = control ? { control, startX: event.clientX, startY: event.clientY, moved: false } : null
  if (control) {
    activeControl = control
    renderControlOverlay(svg, history.current, activeControl)
    renderInspector()
    svg.setPointerCapture(event.pointerId)
  }
})

svg.addEventListener('pointermove', (event) => {
  if (dragging && Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) >= 4) dragging.moved = true
})

svg.addEventListener('pointerup', (event) => {
  const point = eventWorldPoint(svg, event)
  if (dragging?.moved && point) {
    history.apply(moveEditorControl(history.current, dragging.control, point.x, point.z))
    storedDraftError = undefined
    dragging = null
    scheduleCompile()
  } else if (dragging) {
    dragging = null
  } else if (brush !== 'select' && point && !(event.target as Element).closest('[data-kind]')) {
    addStroke(point, brush)
  }
})

svg.addEventListener('pointercancel', () => { dragging = null })
svg.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const control = controlFrom(event.target as Element)
  if (!control) return
  event.preventDefault()
  activeControl = control
  renderControlOverlay(svg, history.current, activeControl)
  renderInspector()
  root!.querySelector<HTMLInputElement>('#selected-x')?.focus()
})

importInput.addEventListener('change', () => {
  const file = importInput.files?.[0]
  importInput.value = ''
  if (!file) return
  if (file.size > 512 * 1024) { showActionError(new Error('Zone definition exceeds 512 KiB')); return }
  void file.text().then((text) => {
    importEditorDefinition(history, text)
    storedDraftError = undefined
    activeControl = null
    scheduleCompile()
  }).catch(showActionError)
})

required<HTMLAnchorElement>('#play-draft').addEventListener('click', (event) => {
  event.preventDefault()
  if (!hasSavedDraft) return
  try {
    saveZoneDraft(localStorage, history.current)
    history.markSaved()
    location.assign(required<HTMLAnchorElement>('#play-draft').href)
  } catch (error) { showActionError(error) }
})

function exportDefinition(): void {
  try {
    const compiled = compileZone(history.current)
    const url = URL.createObjectURL(new Blob([JSON.stringify(compiled.definition, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${compiled.definition.id}.json`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) { showActionError(error) }
}

function showActionError(error: unknown): void {
  status.textContent = error instanceof Error ? error.message : String(error)
  status.className = 'mt-2 rounded-lg border border-red-300/30 bg-stone-950 p-3 text-sm leading-5 text-red-100'
}

let savedDraft
try { savedDraft = loadZoneDraft(window.localStorage) } catch (error) {
  savedDraft = { kind: 'invalid' as const, reason: error instanceof Error ? error.message : String(error) }
}
if (savedDraft.kind === 'valid') { history.loadSaved(savedDraft.definition); hasSavedDraft = true }
else if (savedDraft.kind === 'invalid') storedDraftError = savedDraft.reason
compileAndRender()
required<HTMLInputElement>('#reference-opacity').addEventListener('input', (event) => {
  if (renderedZone) drawTerrainMap(canvas, renderedZone, reference, (event.target as HTMLInputElement).valueAsNumber)
})
void loadReferenceMap().then((image) => {
  reference = image
  if (renderedZone) drawTerrainMap(canvas, renderedZone, reference, required<HTMLInputElement>('#reference-opacity').valueAsNumber)
}).catch(showActionError)
