import type {
  CharacterQuestState,
  DialogueScene,
  QuestCategory,
  QuestDefinition,
  QuestId,
  QuestJournalEntry,
} from '../quests'

export interface QuestHudAction {
  readonly label: string
  readonly style?: 'primary' | 'secondary'
  readonly run: () => void
}

export interface QuestHud {
  readonly interactButton: HTMLButtonElement
  readonly journalButton: HTMLButtonElement
  readonly modalOpen: boolean
  setModalListener(listener: (open: boolean) => void): void
  setTrackListener(listener: (questId: QuestId, tracked: boolean) => void): void
  setInteractPrompt(label: string | null): void
  setDestination(label: string | null): void
  setJournal(entries: readonly QuestJournalEntry[], state: CharacterQuestState): void
  showQuest(definition: QuestDefinition, scenes: readonly DialogueScene[], actions: readonly QuestHudAction[], state?: CharacterQuestState): void
  showMessage(title: string, body: string, actions?: readonly QuestHudAction[]): void
  openJournal(): void
  closeModal(): void
}

export function createQuestHud(root: HTMLElement, onInteract: () => void): QuestHud {
  const shell = root.querySelector<HTMLElement>('#world-shell')
  if (!shell) throw new Error('World shell must exist before quest UI is created.')
  shell.insertAdjacentHTML('beforeend', `
    <section aria-label="Quest controls" class="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex flex-col items-center gap-2 px-4 md:bottom-16">
      <button id="quest-interact" class="pointer-events-auto hidden min-w-48 rounded-xl border border-amber-200/30 bg-stone-950/90 px-5 py-3 text-sm font-semibold text-amber-50 shadow-2xl backdrop-blur-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
        <span class="mr-2 rounded border border-amber-100/20 px-1.5 py-0.5 text-[0.65rem] uppercase">F</span><span id="quest-interact-label">Talk</span>
      </button>
    </section>
    <aside aria-label="Quest tracker" class="pointer-events-none fixed right-4 top-28 z-20 hidden w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-100/10 bg-stone-950/75 p-4 shadow-2xl backdrop-blur-md sm:block">
      <div class="flex items-center justify-between gap-3">
        <p class="text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-stone-400">Quest tracker</p>
        <button id="quest-journal" class="pointer-events-auto rounded-md border border-stone-100/15 px-2.5 py-1.5 text-xs text-stone-200 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-amber-300">Journal <span class="text-stone-500">J</span></button>
      </div>
      <div id="quest-tracker" class="mt-3 space-y-3"></div>
      <p id="quest-destination" class="mt-3 hidden border-t border-stone-100/10 pt-3 text-xs text-stone-400"></p>
    </aside>
    <button id="quest-journal-mobile" aria-label="Open quest journal" class="pointer-events-auto fixed right-4 top-28 z-20 rounded-full border border-stone-100/15 bg-stone-950/80 px-4 py-3 text-xs text-stone-100 shadow-xl sm:hidden">Journal · J</button>
    <p id="quest-destination-mobile" class="pointer-events-none fixed right-4 top-44 z-20 hidden max-w-64 rounded-lg border border-stone-100/10 bg-stone-950/75 px-3 py-2 text-right text-xs text-stone-300 shadow-xl backdrop-blur-md sm:hidden"></p>
    <div id="quest-modal-wrap" class="pointer-events-auto fixed inset-0 z-50 hidden items-center justify-center bg-stone-950/70 p-3 backdrop-blur-sm sm:p-6">
      <section id="quest-modal" role="dialog" aria-modal="true" aria-labelledby="quest-modal-title" tabindex="-1" class="flex max-h-[min(88vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-100/15 bg-[#191a17] text-stone-100 shadow-2xl">
        <header class="flex items-start justify-between gap-4 border-b border-stone-100/10 px-5 py-4 sm:px-7">
          <div><p id="quest-modal-kicker" class="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-amber-200/60">Quest</p><h2 id="quest-modal-title" class="mt-1 font-serif text-2xl text-stone-50"></h2></div>
          <button id="quest-modal-close" aria-label="Close" class="rounded-lg border border-stone-100/10 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-amber-300">Escape</button>
        </header>
        <div id="quest-modal-body" class="min-h-0 flex-1 overflow-y-auto px-5 py-5 leading-7 sm:px-7"></div>
        <footer id="quest-modal-actions" class="flex flex-wrap justify-end gap-2 border-t border-stone-100/10 px-5 py-4 sm:px-7"></footer>
      </section>
    </div>`)

  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id)
    if (!element) throw new Error(`Missing quest UI: ${id}`)
    return element as T
  }
  const interactButton = byId<HTMLButtonElement>('quest-interact')
  const interactLabel = byId<HTMLElement>('quest-interact-label')
  const journalButton = byId<HTMLButtonElement>('quest-journal')
  const journalMobile = byId<HTMLButtonElement>('quest-journal-mobile')
  const tracker = byId<HTMLElement>('quest-tracker')
  const destination = byId<HTMLElement>('quest-destination')
  const destinationMobile = byId<HTMLElement>('quest-destination-mobile')
  const modalWrap = byId<HTMLElement>('quest-modal-wrap')
  const modal = byId<HTMLElement>('quest-modal')
  const modalTitle = byId<HTMLElement>('quest-modal-title')
  const modalKicker = byId<HTMLElement>('quest-modal-kicker')
  const modalBody = byId<HTMLElement>('quest-modal-body')
  const modalActions = byId<HTMLElement>('quest-modal-actions')
  const closeButton = byId<HTMLButtonElement>('quest-modal-close')
  let journalEntries: readonly QuestJournalEntry[] = []
  let questState: CharacterQuestState | null = null
  let modalListener: (open: boolean) => void = () => {}
  let trackListener: (questId: QuestId, tracked: boolean) => void = () => {}
  let returnFocus: HTMLElement | null = null

  const closeModal = (): void => {
    if (modalWrap.classList.contains('hidden')) return
    modalWrap.classList.add('hidden')
    modalWrap.classList.remove('flex')
    modalListener(false)
    returnFocus?.focus()
    returnFocus = null
  }

  const openModal = (): void => {
    if (modalWrap.classList.contains('hidden')) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    modalWrap.classList.remove('hidden')
    modalWrap.classList.add('flex')
    modalListener(true)
    modal.focus()
  }

  const renderActions = (actions: readonly QuestHudAction[]): void => {
    modalActions.replaceChildren(...actions.map((action) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      button.className = action.style === 'primary'
        ? 'rounded-lg bg-amber-200 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300'
        : 'rounded-lg border border-stone-100/15 px-4 py-2 text-sm text-stone-200 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-amber-300'
      button.addEventListener('click', action.run)
      return button
    }))
  }

  const openJournal = (): void => {
    if (!questState) return
    modalKicker.textContent = 'Alderbank journal'
    modalTitle.textContent = 'Quests'
    modalBody.innerHTML = `${journalSection('Main Story', 'main', journalEntries, questState)}${journalSection('Optional Side Quests', 'side', journalEntries, questState)}${rewardLedger(questState)}`
    for (const button of modalBody.querySelectorAll<HTMLButtonElement>('[data-track-quest]')) {
      button.addEventListener('click', () => trackListener(button.dataset.trackQuest as QuestId, button.dataset.tracked !== 'true'))
    }
    renderActions([{ label: 'Close', run: closeModal }])
    openModal()
  }

  interactButton.addEventListener('click', onInteract)
  journalButton.addEventListener('click', openJournal)
  journalMobile.addEventListener('click', openJournal)
  closeButton.addEventListener('click', closeModal)
  modalWrap.addEventListener('pointerdown', (event) => { if (event.target === modalWrap) closeModal() })
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Tab' && !modalWrap.classList.contains('hidden')) {
      const focusable = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (first && last && (active === modal || !modal.contains(active))) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (first && last && event.shiftKey && active === first) { event.preventDefault(); last.focus() }
      else if (first && last && !event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    } else if (event.code === 'Escape' && !modalWrap.classList.contains('hidden')) {
      event.preventDefault()
      closeModal()
    } else if (event.code === 'KeyJ' && !event.repeat) {
      event.preventDefault()
      if (modalWrap.classList.contains('hidden')) openJournal(); else closeModal()
    } else if (event.code === 'KeyF' && !event.repeat && modalWrap.classList.contains('hidden')) {
      event.preventDefault()
      onInteract()
    }
  })

  return {
    interactButton,
    journalButton,
    get modalOpen() { return !modalWrap.classList.contains('hidden') },
    setModalListener: (listener) => { modalListener = listener },
    setTrackListener: (listener) => { trackListener = listener },
    setInteractPrompt: (label) => {
      interactButton.classList.toggle('hidden', label === null)
      if (label) interactLabel.textContent = label
    },
    setDestination: (label) => {
      destination.classList.toggle('hidden', label === null)
      destinationMobile.classList.toggle('hidden', label === null)
      if (label) destination.textContent = label
      if (label) destinationMobile.textContent = label
    },
    setJournal: (entries, state) => {
      journalEntries = entries
      questState = state
      tracker.innerHTML = trackerMarkup(entries, state)
    },
    showQuest: (definition, scenes, actions, state) => {
      modalKicker.textContent = definition.category === 'main' ? '◆ Main Story' : '● Optional Side Quest'
      modalTitle.textContent = `${definition.id} · ${definition.title}`
      modalBody.innerHTML = `<p class="mb-4 text-sm leading-6 text-stone-400">${escapeHtml(definition.summary)}</p>${rewardPreview(definition, state)}${sceneMarkup(scenes)}`
      renderActions(actions)
      openModal()
    },
    showMessage: (title, body, actions = [{ label: 'Close', run: closeModal }]) => {
      modalKicker.textContent = 'Alderbank'
      modalTitle.textContent = title
      modalBody.innerHTML = `<p class="text-stone-300">${escapeHtml(body)}</p>`
      renderActions(actions)
      openModal()
    },
    openJournal,
    closeModal,
  }
}

function trackerMarkup(entries: readonly QuestJournalEntry[], state: CharacterQuestState): string {
  return (['main', 'side'] as const).map((category) => {
    const tracked = entries.filter((entry) => entry.category === category && ['active', 'ready'].includes(entry.status))
      .filter((entry) => state.trackedIds.includes(entry.id))
    const candidates = (tracked.length > 0 ? tracked : entries.filter((entry) => entry.category === category && entry.status === 'available')).slice(0, 2)
    if (candidates.length === 0) return ''
    const heading = category === 'main' ? '◆ Main Story' : '● Side Stories'
    const color = category === 'main' ? 'text-amber-200' : 'text-teal-300'
    return `<section><h2 class="text-[0.65rem] font-semibold uppercase tracking-[0.18em] ${color}">${heading}</h2>${candidates.map((entry) => `
      <div class="mt-1.5 border-l border-stone-100/10 pl-3"><p class="text-sm font-medium text-stone-100">${escapeHtml(entry.title)}</p><p class="mt-0.5 text-xs leading-5 text-stone-400">${escapeHtml(entry.status === 'ready' ? 'Ready to turn in' : entry.nextObjective?.label ?? statusLabel(entry.status))}</p></div>`).join('')}</section>`
  }).join('') || '<p class="text-xs text-stone-500">No active quests.</p>'
}

function journalSection(title: string, category: QuestCategory, entries: readonly QuestJournalEntry[], state: CharacterQuestState): string {
  const visible = entries.filter((entry) => entry.category === category && entry.status !== 'locked')
  return `<section class="mb-7"><h3 class="font-serif text-xl ${category === 'main' ? 'text-amber-200' : 'text-teal-300'}">${category === 'main' ? '◆' : '●'} ${title}</h3><div class="mt-3 space-y-3">${visible.map((entry) => `
    <article class="rounded-xl border border-stone-100/10 bg-stone-950/35 p-4"><div class="flex flex-wrap items-baseline justify-between gap-2"><h4 class="font-medium text-stone-100">${entry.id} · ${escapeHtml(entry.title)}</h4><span class="text-[0.65rem] font-semibold uppercase tracking-wider text-stone-400">${statusLabel(entry.status)}</span></div><p class="mt-2 text-sm leading-6 text-stone-400">${escapeHtml(entry.summary)}</p>${entry.nextObjective ? `<p class="mt-2 text-sm text-stone-200">Next: ${escapeHtml(entry.nextObjective.label)} · ${escapeHtml(entry.location)}</p>` : ''}${entry.unavailableReason ? `<p class="mt-2 text-sm text-amber-200/80">${escapeHtml(entry.unavailableReason)}</p>` : ''}${entry.status === 'active' || entry.status === 'ready' ? `<button data-track-quest="${entry.id}" data-tracked="${state.trackedIds.includes(entry.id)}" class="mt-3 rounded-md border border-stone-100/15 px-3 py-1.5 text-xs text-stone-200 hover:bg-stone-800">${state.trackedIds.includes(entry.id) ? 'Untrack' : 'Track this quest'}</button>` : ''}</article>`).join('') || '<p class="text-sm text-stone-500">Nothing recorded yet.</p>'}</div></section>`
}

function rewardLedger(state: CharacterQuestState): string {
  const items = Object.entries(state.rewardInventory).filter(([, quantity]) => quantity > 0)
  const receipts = Object.values(state.receipts)
  const labels = new Map(receipts.flatMap((receipt) => receipt.items.map((item) => [item.id, item.label] as const)))
  const history = receipts.map((receipt) => `<li><span class="font-medium text-stone-300">${receipt.questId}</span> · ${receipt.pendingXp} ${receipt.creditedClassId ? `XP for ${escapeHtml(receipt.creditedClassId)}` : 'reserved XP'} · ${receipt.currency} Currency${receipt.items.length ? ` · ${receipt.items.map((item) => `${escapeHtml(item.label)} ×${item.quantity}`).join(', ')}` : ''}</li>`).join('')
  return `<section class="rounded-xl border border-stone-100/10 bg-stone-950/35 p-4"><h3 class="font-serif text-lg text-stone-100">Rewards</h3><div class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-300"><span>Reserved class XP: ${state.pendingXp}</span><span>Currency: ${state.currency}</span></div>${items.length ? `<p class="mt-2 text-sm text-stone-400">Supplies: ${items.map(([id, count]) => `${escapeHtml(labels.get(id) ?? id)} ×${count}`).join(', ')}</p>` : ''}${history ? `<div class="mt-4 border-t border-stone-100/10 pt-3"><p class="text-[0.65rem] font-semibold uppercase tracking-wider text-stone-500">Completion receipts</p><ul class="mt-2 space-y-1 text-xs leading-5 text-stone-500">${history}</ul></div>` : '<p class="mt-2 text-xs text-stone-500">No completion receipts yet.</p>'}</section>`
}

function rewardPreview(definition: QuestDefinition, state?: CharacterQuestState): string {
  const reward = definition.reward
  const items = reward.items.map((item) => `${escapeHtml(item.label)} ×${item.quantity}`)
  const xp = state?.activeClassId ? `${reward.pendingXp} XP for ${escapeHtml(state.activeClassId)}` : `${reward.pendingXp} XP reserved for your first class`
  const parts = [xp, `${reward.currency} Currency`, ...items]
  return `<section class="mb-5 rounded-lg border border-amber-100/10 bg-amber-100/5 px-4 py-3"><p class="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-amber-200/65">Reward on completion</p><p class="mt-1 text-sm text-stone-300">${parts.join(' · ')}</p></section>`
}

function sceneMarkup(scenes: readonly DialogueScene[]): string {
  return scenes.map((scene) => `<section class="mb-5" data-scene="${escapeHtml(scene.id)}">${scene.lines.map((line) => `<p class="mb-2 text-stone-300"><strong class="font-semibold text-stone-100">${escapeHtml(line.speaker)}:</strong> ${escapeHtml(formatDialogueText(line.text))}</p>`).join('')}</section>`).join('')
}

export function formatDialogueText(text: string, playerName = 'Ashbearer'): string {
  return text.replaceAll('`{player}`', playerName).replaceAll('{player}', playerName)
}

function statusLabel(status: QuestJournalEntry['status']): string {
  return ({ available: 'Available !', active: 'Active —', ready: 'Ready ?', completed: 'Completed ✓', planned: 'Next chapter', locked: 'Locked' })[status]
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}
