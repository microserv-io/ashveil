import type { CharacterQuestState, DialogueScene, QuestDefinition, QuestId, QuestJournalEntry } from '../quests'
import type { HudQuestProjection } from './quest-presentation'
import { resolveHudShortcut, type HudPanel } from './hud-shortcuts'
import { createHudLayoutPreference, type HudLayout } from './hud-layout'
import { blurActiveElement } from './hud-focus'

export interface QuestHudAction {
  readonly label: string
  readonly style?: 'primary' | 'secondary'
  readonly run: () => void
}

export interface MusicLevelPreference {
  get(): number
  set(level: number): void
}

export interface QuestHud {
  readonly interactButton: HTMLButtonElement
  readonly journalButton: HTMLButtonElement
  readonly modalOpen: boolean
  setModalListener(listener: (open: boolean) => void): void
  setTrackListener(listener: (questId: QuestId, tracked: boolean) => void): void
  setInteractPrompt(label: string | null): void
  setJournal(projection: HudQuestProjection, state: CharacterQuestState, continuationLabel?: string): void
  setSaveStatus(message: string | null): void
  showQuest(definition: QuestDefinition, scenes: readonly DialogueScene[], actions: readonly QuestHudAction[], state?: CharacterQuestState): void
  showMessage(title: string, body: string, actions?: readonly QuestHudAction[]): void
  openJournal(): void
  closeModal(): void
}

type Panel = HudPanel

const defaultMusicPreference: MusicLevelPreference = { get: () => 0.6, set: () => {} }

export function createQuestHud(root: HTMLElement, onInteract: () => void, music: MusicLevelPreference = defaultMusicPreference): QuestHud {
  const shell = required<HTMLElement>(root, '#world-shell')
  root.insertAdjacentHTML('beforeend', `
    <div id="game-modal-wrap" class="hud-modal-wrap" hidden>
      <section id="game-modal" class="hud-modal" role="dialog" aria-modal="true" aria-labelledby="game-modal-title" tabindex="-1">
        <header><div><p id="game-modal-kicker">Ashveil</p><h2 id="game-modal-title"></h2></div><button id="game-modal-close" type="button" aria-label="Close panel">Esc · Close</button></header>
        <div id="game-modal-body" class="hud-modal-body"></div><footer id="game-modal-actions"></footer>
      </section>
    </div>`)
  const interactButton = required<HTMLButtonElement>(root, '#quest-interact')
  const interactLabel = required<HTMLElement>(root, '#quest-interact-label')
  const tracker = required<HTMLElement>(root, '#quest-tracker')
  const saveStatus = required<HTMLElement>(root, '#quest-save-status')
  const modalWrap = required<HTMLElement>(root, '#game-modal-wrap')
  const modal = required<HTMLElement>(root, '#game-modal')
  const modalTitle = required<HTMLElement>(root, '#game-modal-title')
  const modalKicker = required<HTMLElement>(root, '#game-modal-kicker')
  const modalBody = required<HTMLElement>(root, '#game-modal-body')
  const modalActions = required<HTMLElement>(root, '#game-modal-actions')
  const closeButton = required<HTMLButtonElement>(root, '#game-modal-close')
  const menuButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-game-menu]')]
  const journalButton = required<HTMLButtonElement>(root, '[data-game-menu="journal"]')
  let projection: HudQuestProjection | null = null
  let questState: CharacterQuestState | null = null
  let continuationLabel: string | undefined
  let activePanel: Panel | null = null
  let modalListener: (open: boolean) => void = () => {}
  let trackListener: (questId: QuestId, tracked: boolean) => void = () => {}
  const layoutPreference = createHudLayoutPreference(browserStorage())
  applyLayout(layoutPreference.get())

  const closeModal = (): void => {
    if (modalWrap.hidden) return
    modalWrap.hidden = true
    shell.inert = false
    activePanel = null
    modalListener(false)
    blurActiveElement()
  }

  const openModal = (): void => {
    if (modalWrap.hidden) {
      modalWrap.hidden = false
      shell.inert = true
      modalListener(true)
    }
    requestAnimationFrame(() => (firstFocusable(modal) ?? modal).focus({ preventScroll: true }))
  }

  const renderActions = (actions: readonly QuestHudAction[]): void => {
    modalActions.replaceChildren(...actions.map((action) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      button.className = action.style === 'primary' ? 'primary' : ''
      button.addEventListener('click', action.run)
      return button
    }))
  }

  const openPanel = (panel: Panel): void => {
    if (!questState || !projection) return
    activePanel = panel
    modalKicker.textContent = panelKicker(panel)
    modalTitle.textContent = panelTitle(panel)
    modalBody.innerHTML = panelMarkup(panel, projection, questState, continuationLabel, layoutPreference.get(), music.get())
    if (panel === 'journal') bindTracking(modalBody, trackListener)
    if (panel === 'settings') bindSettings(modalBody, layoutPreference, music)
    renderActions([{ label: 'Close', run: closeModal }])
    openModal()
  }

  interactButton.addEventListener('click', () => {
    interactButton.blur()
    onInteract()
  })
  for (const button of menuButtons) {
    button.addEventListener('click', () => {
      button.blur()
      openPanel(button.dataset.gameMenu as Panel)
    })
  }
  closeButton.addEventListener('click', closeModal)
  modalWrap.addEventListener('pointerdown', (event) => { if (event.target === modalWrap) closeModal() })
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Tab' && !modalWrap.hidden) trapFocus(event, modal)
    else if (event.code === 'Escape' && !modalWrap.hidden) { event.preventDefault(); closeModal() }
    else {
      const shortcut = resolveHudShortcut(event.code, {
        repeat: event.repeat, editable: isEditable(event.target as Element | null) || isEditable(document.activeElement), modalOpen: !modalWrap.hidden, activePanel,
      })
      if (shortcut.kind === 'none') return
      event.preventDefault()
      if (shortcut.kind === 'interact') onInteract()
      else if (shortcut.kind === 'close') closeModal()
      else openPanel(shortcut.panel)
    }
  })

  return {
    interactButton, journalButton,
    get modalOpen() { return !modalWrap.hidden },
    setModalListener: (listener) => { modalListener = listener },
    setTrackListener: (listener) => { trackListener = listener },
    setInteractPrompt: (label) => {
      interactButton.hidden = label === null
      if (label) interactLabel.textContent = label
    },
    setJournal: (nextProjection, state, nextContinuationLabel) => {
      projection = nextProjection
      questState = state
      continuationLabel = nextContinuationLabel
      tracker.innerHTML = trackerMarkup(nextProjection, state, nextContinuationLabel)
      if (activePanel === 'journal') openPanel('journal')
    },
    setSaveStatus: (message) => { saveStatus.hidden = message === null; saveStatus.textContent = message ?? '' },
    showQuest: (definition, scenes, actions, state) => {
      activePanel = null
      modalKicker.textContent = definition.category === 'main' ? 'Main Story' : 'Side Story'
      modalTitle.textContent = definition.title
      modalBody.innerHTML = `<p class="hud-summary">${escapeHtml(definition.summary)}</p>${rewardPreview(definition, state)}${sceneMarkup(scenes)}`
      renderActions(actions)
      openModal()
    },
    showMessage: (title, body, actions = [{ label: 'Close', run: closeModal }]) => {
      activePanel = null
      modalKicker.textContent = 'Alderbank'
      modalTitle.textContent = title
      modalBody.innerHTML = `<p>${escapeHtml(body)}</p>`
      renderActions(actions)
      openModal()
    },
    openJournal: () => openPanel('journal'),
    closeModal,
  }
}

function trackerMarkup(projection: HudQuestProjection, state: CharacterQuestState, continuationLabel?: string): string {
  const groups = (['main', 'side'] as const).flatMap((category) => {
    const entries = projection[category].filter((entry) => state.trackedIds.includes(entry.id))
    if (entries.length === 0) return []
    const label = category === 'main' ? 'Main Story quests' : 'Side Story quests'
    return [`<section class="${category}" aria-label="${label}">${entries.map((entry) => trackerEntry(entry)).join('')}</section>`]
  })
  if (!projection.main.some((entry) => state.trackedIds.includes(entry.id))) {
    if (projection.story.kind === 'continue' && continuationLabel) groups.unshift(storyCue(`Talk to ${escapeHtml(continuationLabel)} to continue your story`))
    else if (projection.story.kind === 'complete') groups.unshift(storyCue('Your Alderbank story is complete for now.'))
    else if (projection.story.kind === 'in-progress') groups.unshift(storyCue('A main story quest is in progress.'))
  }
  return groups.join('')
}

function trackerEntry(entry: QuestJournalEntry): string {
  const objective = entry.status === 'ready' ? 'Ready to turn in' : entry.nextObjective?.label ?? 'In progress'
  return `<article><h2><span class="hud-quest-title-icon" aria-hidden="true">✧</span><span>${escapeHtml(entry.title)}</span></h2><p class="hud-quest-objective"><span aria-hidden="true">◇</span><span>${escapeHtml(objective)}</span></p></article>`
}

function storyCue(cue: string): string {
  return `<section class="main" aria-label="Main Story quests"><article><h2><span class="hud-quest-title-icon" aria-hidden="true">✧</span><span>Main Story</span></h2><p class="hud-story-cue">${cue}</p></article></section>`
}

function panelMarkup(panel: Panel, projection: HudQuestProjection, state: CharacterQuestState, continuationLabel: string | undefined, layout: HudLayout, musicLevel: number): string {
  if (panel === 'journal') return journalMarkup(projection, state, continuationLabel)
  if (panel === 'character') {
    const className = state.activeClassId ? escapeHtml(state.activeClassId) : 'Class not yet chosen'
    const xp = state.activeClassId ? state.classXp[state.activeClassId] ?? 0 : state.pendingXp
    return `<section class="hud-character"><div class="hud-character-silhouette" aria-hidden="true"></div><article><h3>Adventurer</h3><p>${className}</p><dl><dt>${state.activeClassId ? 'Class experience' : 'Reserved experience'}</dt><dd>${xp}</dd><dt>Main story quests completed</dt><dd>${state.completedIds.filter((id) => id.startsWith('M')).length}</dd></dl></article></section>`
  }
  if (panel === 'pack') return packMarkup(state)
  if (panel === 'map') return '<section class="hud-empty"><div class="hud-empty-map"></div><h3>No map available</h3><p>Explore Alderbank through its paths, landmarks, and people.</p></section>'
  if (panel === 'finder') return '<section class="hud-empty"><h3>Duty Finder unavailable</h3><p>Group duties are not available in this opening chapter.</p></section>'
  if (panel === 'social') return '<section class="hud-empty"><h3>No social connections yet</h3><p>Communities and player groups will appear here when online play is available.</p></section>'
  return settingsMarkup(layout, musicLevel)
}

function journalMarkup(projection: HudQuestProjection, state: CharacterQuestState, continuationLabel?: string): string {
  const mainEmpty = projection.story.kind === 'continue' && continuationLabel
    ? `Talk to ${escapeHtml(continuationLabel)} to continue your story.`
    : projection.story.kind === 'complete' ? 'Your Alderbank story is complete for now.' : 'No tracked main story quest.'
  return `<section class="hud-journal-section"><h3>Main Story</h3>${questCards(projection.main, state, mainEmpty)}</section>
    <section class="hud-journal-section side"><h3>Side Stories</h3>${questCards(projection.side, state, 'No accepted side stories.')}</section>
    ${projection.history.length ? `<details class="hud-history"><summary>Completed quests (${projection.history.length})</summary>${projection.history.map((entry) => `<p><b>${escapeHtml(entry.title)}</b><span>${entry.category === 'main' ? 'Main Story' : 'Side Story'}</span></p>`).join('')}</details>` : ''}
    ${rewardLedger(state)}`
}

function questCards(entries: readonly QuestJournalEntry[], state: CharacterQuestState, empty: string): string {
  if (entries.length === 0) return `<p class="hud-empty-copy">${empty}</p>`
  return `<div class="hud-quest-cards">${entries.map((entry) => `<article><div><h4><span class="hud-quest-title-icon" aria-hidden="true">✧</span><span>${escapeHtml(entry.title)}</span></h4><span>${entry.status === 'ready' ? 'Ready to turn in' : 'Active'}</span></div><p>${escapeHtml(entry.summary)}</p>${entry.nextObjective ? `<p class="objective hud-quest-objective"><span aria-hidden="true">◇</span><span>${escapeHtml(entry.nextObjective.label)}</span></p>` : ''}<button type="button" data-track-quest="${entry.id}" data-tracked="${state.trackedIds.includes(entry.id)}">${state.trackedIds.includes(entry.id) ? 'Untrack' : 'Track quest'}</button></article>`).join('')}</div>`
}

function packMarkup(state: CharacterQuestState): string {
  const labels = new Map(Object.values(state.receipts).flatMap((receipt) => receipt.items.map((item) => [item.id, item.label] as const)))
  const items = Object.entries(state.rewardInventory).filter(([, quantity]) => quantity > 0)
  return `<section class="hud-pack-summary"><p><span>Currency</span><strong>${state.currency}</strong></p><p><span>${state.activeClassId ? 'Class XP' : 'Reserved XP'}</span><strong>${state.activeClassId ? state.classXp[state.activeClassId] ?? 0 : state.pendingXp}</strong></p></section><section class="hud-pack-grid">${items.length ? items.map(([id, quantity]) => `<article><div aria-hidden="true">✦</div><h3>${escapeHtml(labels.get(id) ?? id)}</h3><p>Quantity ${quantity}</p></article>`).join('') : '<p class="hud-empty-copy">Quest reward supplies will appear here.</p>'}</section>`
}

function settingsMarkup(layout: HudLayout, musicLevel: number): string {
  const percent = String(Math.round(clamp01(musicLevel) * 100))
  return `<section class="hud-settings"><label for="hud-layout">Action layout<select id="hud-layout"><option value="keyboard"${layout === 'keyboard' ? ' selected' : ''}>Keyboard</option><option value="controller"${layout === 'controller' ? ' selected' : ''}>Controller cross hotbar</option></select></label><label for="hud-music">Music<span class="hud-music-row"><input id="hud-music" type="range" min="0" max="100" step="5" value="${percent}"><output id="hud-music-value" for="hud-music">${percent}%</output></span></label><article><h3>Exploration controls</h3><p>W/S move · A/D turn · Q/E strafe · right mouse steers · left-drag looks · Alt walks · Shift sprints · Space jumps · wheel zooms.</p><h3>Interface controls</h3><p>F interacts. Left-click an NPC to target; click empty ground or press Escape to clear the target. J opens the Journal. Menu buttons show their names when focused or hovered. Escape closes the active panel.</p><p>The controller cross hotbar is a layout preview. Gamepad movement and actions are not available yet.</p></article></section>`
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function bindSettings(root: HTMLElement, preference: { get(): HudLayout; set(layout: HudLayout): void }, music: MusicLevelPreference): void {
  applyLayout(preference.get())
  required<HTMLSelectElement>(root, '#hud-layout').addEventListener('change', (event) => {
    const layout = (event.currentTarget as HTMLSelectElement).value === 'controller' ? 'controller' : 'keyboard'
    preference.set(layout)
    applyLayout(layout)
  })
  const slider = required<HTMLInputElement>(root, '#hud-music')
  const readout = required<HTMLOutputElement>(root, '#hud-music-value')
  slider.addEventListener('input', () => {
    const percent = Number(slider.value)
    readout.textContent = `${percent}%`
    music.set(clamp01(percent / 100))
  })
}

function browserStorage(): Storage | undefined { try { return localStorage } catch { return undefined } }

function applyLayout(layout: 'keyboard' | 'controller'): void {
  const keyboard = document.querySelector<HTMLElement>('#keyboard-actions')
  const controller = document.querySelector<HTMLElement>('#controller-actions')
  if (keyboard) keyboard.hidden = layout === 'controller'
  if (controller) controller.hidden = layout === 'keyboard'
}

function bindTracking(root: HTMLElement, listener: (questId: QuestId, tracked: boolean) => void): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-track-quest]')) button.addEventListener('click', () => listener(button.dataset.trackQuest as QuestId, button.dataset.tracked !== 'true'))
}

function rewardLedger(state: CharacterQuestState): string {
  return `<section class="hud-reward-ledger"><h3>Journey rewards</h3><p>${state.pendingXp} reserved experience · ${state.currency} Currency</p></section>`
}

function rewardPreview(definition: QuestDefinition, state?: CharacterQuestState): string {
  const items = definition.reward.items.map((item) => `${escapeHtml(item.label)} ×${item.quantity}`)
  const xp = state?.activeClassId ? `${definition.reward.pendingXp} XP for ${escapeHtml(state.activeClassId)}` : `${definition.reward.pendingXp} XP reserved for your first class`
  return `<section class="hud-reward-preview"><b>Reward</b><p>${[xp, `${definition.reward.currency} Currency`, ...items].join(' · ')}</p></section>`
}

function sceneMarkup(scenes: readonly DialogueScene[]): string {
  return scenes.map((scene) => `<section class="hud-dialogue" data-scene="${escapeHtml(scene.id)}">${scene.lines.map((line) => `<p><strong>${escapeHtml(line.speaker)}:</strong> ${escapeHtml(formatDialogueText(line.text))}</p>`).join('')}</section>`).join('')
}

export function formatDialogueText(text: string, playerName = 'Ashbearer'): string {
  return text.replaceAll('`{player}`', playerName).replaceAll('{player}', playerName)
}

function panelKicker(panel: Panel): string { return panel === 'journal' ? 'Alderbank journal' : 'Ashveil' }
function panelTitle(panel: Panel): string { return ({ character: 'Character', pack: "Wayfarer's Pack", map: 'Map', journal: 'Journey Journal', finder: 'Duty Finder', social: 'Social', settings: 'Interface & Controls' })[panel] }
function isEditable(target: Element | null): boolean { return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) }
function firstFocusable(root: HTMLElement): HTMLElement | undefined { return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')][0] }

function trapFocus(event: KeyboardEvent, root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  const first = items[0]
  const last = items.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  else if (!root.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing HUD control: ${selector}`)
  return element
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}
