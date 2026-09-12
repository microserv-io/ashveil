import {
  openingQuestResolver,
  projectJournal,
  projectNpcOffers,
  type CharacterQuestState,
  type QuestDefinition,
  type QuestIntent,
  type QuestJournalEntry,
  type QuestObjectiveDefinition,
} from '../quests'
import { IndexedDbQuestStateRepository } from '../persistence'
import type { WorldInput } from './input'
import { createQuestHud, type QuestHud, type QuestHudAction } from './quest-hud'
import { WorldQuestHost, type QuestHostMutation, type WorldQuestTarget } from './quest-host'
import { QUEST_TARGETS, destinationForEntry, questTarget } from './quest-world-data'
import type { Explorer } from './movement'
import type { WorldView } from './renderer'

interface InteractionCandidate {
  readonly target: WorldQuestTarget
  readonly mode: 'available' | 'active' | 'early' | 'ready' | 'reminder' | 'introduction'
  readonly definition?: QuestDefinition
  readonly objective?: QuestObjectiveDefinition
}

const CHARACTER_ID = 'alderbank-offline'

export class WorldQuestController {
  private readonly hud: QuestHud
  private readonly host = new WorldQuestHost(CHARACTER_ID, new IndexedDbQuestStateRepository(), QUEST_TARGETS)
  private explorer: Explorer
  private nearby: InteractionCandidate | null = null
  private candidates: readonly InteractionCandidate[] = []
  private trackedDestination: WorldQuestTarget | null = null
  private busy = false

  constructor(root: HTMLElement, private readonly view: WorldView, private readonly input: WorldInput, initialExplorer: Explorer) {
    this.explorer = initialExplorer
    this.hud = createQuestHud(root, () => { void this.interact() })
    this.hud.setModalListener((open) => this.input.setEnabled(!open))
    this.hud.setTrackListener((questId, tracked) => { void this.setTracked(questId, tracked) })
    this.host.onStatus((status) => {
      if (status.kind === 'ready') this.render(status.state)
      else this.hud.showMessage('Quest save needs attention', status.reason)
    })
  }

  get state(): CharacterQuestState | null { return this.host.state }
  get modalOpen(): boolean { return this.hud.modalOpen }

  async initialize(): Promise<void> {
    const status = await this.host.initialize()
    if (status.kind === 'ready' && this.host.isFresh) {
      this.hud.showMessage(
        'After the crossing',
        'The broken crossing is behind you. Mara is counting survivors on Alderbank’s safe bank, and Iven is preparing the refuge awning. Walk to Mara and press F or use Talk.',
      )
    }
  }

  update(explorer: Explorer): void {
    this.explorer = explorer
    const state = this.host.state
    if (!state || this.hud.modalOpen) {
      this.nearby = null
      this.hud.setInteractPrompt(null)
      return
    }
    this.nearby = selectCandidate(this.candidates, explorer)
    this.hud.setInteractPrompt(this.nearby ? promptFor(this.nearby) : null)
    this.updateDestination(explorer)
  }

  openJournal(): void { this.hud.openJournal() }

  private async setTracked(questId: QuestDefinition['id'], tracked: boolean): Promise<void> {
    const result = await this.host.dispatch({ kind: 'track', questId, tracked }, this.explorer)
    if (result.kind !== 'committed') { this.showFailure(result); return }
    this.hud.openJournal()
  }

  private async interact(): Promise<void> {
    if (this.busy || this.hud.modalOpen || !this.nearby || !this.host.state) return
    this.busy = true
    try {
      if (this.nearby.mode === 'ready' && this.nearby.definition) {
        this.showTurnIn(this.nearby.definition)
      } else if (this.nearby.mode === 'available') {
        await this.openGiver(this.nearby.target.id)
      } else if (this.nearby.mode === 'introduction') {
        await this.introduceIven()
      } else if (this.nearby.mode === 'reminder' && this.nearby.definition) {
        this.hud.showQuest(
          this.nearby.definition,
          this.nearby.definition.scenes.filter((scene) => scene.kind === 'reminder'),
          [{ label: 'Continue', style: 'primary', run: () => this.hud.closeModal() }],
          this.host.state ?? undefined,
        )
      } else if (this.nearby.definition && this.nearby.objective?.choiceIds) {
        this.showChoices(this.nearby.definition, this.nearby.objective, this.nearby.target.id)
      } else if (this.nearby.definition) {
        await this.mutate({
          kind: 'interact',
          targetId: this.nearby.target.id,
          questId: this.nearby.definition.id,
          objectiveId: this.nearby.objective?.id,
        }, this.nearby.definition)
      }
    } finally {
      this.busy = false
    }
  }

  private async introduceIven(): Promise<void> {
    const result = await this.host.dispatch({ kind: 'interact', targetId: 'npc_iven' }, this.explorer)
    if (result.kind === 'committed') await this.openGiver('npc_iven')
    else this.showFailure(result)
  }

  private async openGiver(npcId: string): Promise<void> {
    if (npcId === 'npc_iven' && !this.host.state?.featureUnlocks.includes('iven_introduction_heard')) {
      const introduced = await this.host.dispatch({ kind: 'interact', targetId: npcId }, this.explorer)
      if (introduced.kind !== 'committed') { this.showFailure(introduced); return }
    }
    const state = this.host.state
    if (!state) return
    const offers = [...projectNpcOffers(npcId, state)].sort(questOrder)
    if (offers.length === 0) return
    this.showOffer(offers, 0)
  }

  private showOffer(offers: readonly QuestDefinition[], index: number): void {
    const definition = offers[index]!
    const actions: QuestHudAction[] = [
      { label: 'Accept quest', style: 'primary', run: () => { void this.accept(definition) } },
    ]
    if (offers.length > 1) actions.push({
      label: `Next offer (${index + 1}/${offers.length})`,
      run: () => this.showOffer(offers, (index + 1) % offers.length),
    })
    actions.push({ label: 'Not now', run: () => this.hud.closeModal() })
    this.hud.showQuest(definition, definition.scenes.filter((scene) => ['offer', 'reply', 'followup'].includes(scene.kind)), actions, this.host.state ?? undefined)
  }

  private async accept(definition: QuestDefinition): Promise<void> {
    this.hud.closeModal()
    const accepted = await this.host.dispatch({ kind: 'accept', questId: definition.id, giverId: definition.giverId }, this.explorer)
    if (accepted.kind !== 'committed') { this.showFailure(accepted); return }
    const tracked = await this.host.dispatch({ kind: 'track', questId: definition.id, tracked: true }, this.explorer)
    if (tracked.kind !== 'committed') { this.showFailure(tracked); return }
    this.hud.showMessage('Quest accepted', `${definition.title} is now in your journal.`)
  }

  private showTurnIn(definition: QuestDefinition): void {
    const reminder = definition.scenes.filter((scene) => scene.kind === 'reminder')
    this.hud.showQuest(definition, reminder, [
      { label: 'Complete quest', style: 'primary', run: () => { void this.turnIn(definition) } },
      { label: 'Close', run: () => this.hud.closeModal() },
    ], this.host.state ?? undefined)
  }

  private async turnIn(definition: QuestDefinition): Promise<void> {
    this.hud.closeModal()
    await this.mutate({ kind: 'turn_in', questId: definition.id, turnInId: definition.turnInId }, definition)
  }

  private showChoices(definition: QuestDefinition, objective: QuestObjectiveDefinition, targetId: string): void {
    const actions: QuestHudAction[] = (objective.choiceIds ?? []).map((choiceId) => ({
      label: choiceLabel(choiceId),
      style: 'primary',
      run: () => {
        this.hud.closeModal()
        void this.mutate({ kind: 'choose', questId: definition.id, objectiveId: objective.id, choiceId, targetId }, definition)
      },
    }))
    actions.push({ label: 'Close', run: () => this.hud.closeModal() })
    this.hud.showQuest(definition, definition.scenes.filter((scene) => scene.kind === 'reminder'), actions, this.host.state ?? undefined)
  }

  private async mutate(intent: QuestIntent, definition: QuestDefinition): Promise<void> {
    const result = await this.host.dispatch(intent, this.explorer)
    if (result.kind !== 'committed') { this.showFailure(result); return }
    if (result.scenes.length > 0) {
      this.hud.showQuest(definition, result.scenes, [{ label: 'Continue', style: 'primary', run: () => this.hud.closeModal() }], result.state)
    }
  }

  private showFailure(result: QuestHostMutation): void {
    if (result.kind === 'committed') return
    if (result.kind === 'conflict') {
      this.hud.showMessage('Progress changed in another tab', 'The current save was reloaded. Review your objective and try again.')
    } else if (result.kind === 'save_error') {
      this.hud.showMessage('Could not save progress', `${result.reason}. Your last committed progress is still safe; try again.`)
    } else {
      this.hud.showMessage('That cannot be done yet', readableReason(result.reason))
    }
  }

  private render(state: CharacterQuestState): void {
    const entries = projectJournal(state)
    this.candidates = interactionCandidates(state)
    const tracked = [...state.trackedIds].reverse().map((id) => entries.find((entry) => entry.id === id)).find((entry) => entry !== undefined)
    const definition = tracked ? pinnedDefinition(tracked, state) : undefined
    this.trackedDestination = tracked && definition ? destinationForEntry(tracked, definition, state) ?? null : null
    this.hud.setJournal(entries, state)
    this.view.setQuestMarkers(markerProjection(entries, state))
    this.update(this.explorer)
  }

  private updateDestination(explorer: Explorer): void {
    const destination = this.trackedDestination
    if (!destination) { this.hud.setDestination(null); return }
    const dx = destination.x - explorer.x
    const dz = destination.z - explorer.z
    const distance = Math.hypot(dx, dz)
    this.hud.setDestination(`${destination.label} · ${Math.round(distance)} m ${relativeDirection(dx, dz, explorer.facing)}`)
  }
}

export function selectQuestInteraction(state: CharacterQuestState, explorer: Explorer): InteractionCandidate | null {
  return selectCandidate(interactionCandidates(state), explorer)
}

function selectCandidate(candidates: readonly InteractionCandidate[], explorer: Explorer): InteractionCandidate | null {
  let selected: InteractionCandidate | null = null
  let selectedDistance = Infinity
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.target.x - explorer.x, candidate.target.z - explorer.z)
    if (distance > candidate.target.interactionRadius) continue
    if (!selected || candidatePriority(candidate) < candidatePriority(selected)
      || (candidatePriority(candidate) === candidatePriority(selected) && distance < selectedDistance)) {
      selected = candidate
      selectedDistance = distance
    }
  }
  return selected
}

function interactionCandidates(state: CharacterQuestState): InteractionCandidate[] {
  const entries = projectJournal(state)
  const candidates: InteractionCandidate[] = []
  for (const entry of entries) {
    const definition = pinnedDefinition(entry, state)
    if (!definition || definition.status !== 'playable') continue
    if (entry.status === 'available') {
      const target = questTarget(definition.giverId)
      if (target) candidates.push({ target, mode: 'available', definition })
      candidates.push(...earlyCandidates(definition, state))
    } else if (entry.status === 'ready') {
      const target = questTarget(definition.turnInId)
      if (target) candidates.push({ target, mode: 'ready', definition })
    } else if (entry.status === 'active' && entry.nextObjective) {
      const completed = new Set(state.accepted[entry.id]?.objectiveTargets[entry.nextObjective.id] ?? [])
      for (const id of entry.nextObjective.targetIds) {
        const target = questTarget(id)
        if (target && !completed.has(id)) candidates.push({ target, mode: 'active', definition, objective: entry.nextObjective })
      }
      const giver = questTarget(definition.giverId)
      if (giver && !entry.nextObjective.targetIds.includes(giver.id)) candidates.push({ target: giver, mode: 'reminder', definition })
    }
  }
  if (!state.featureUnlocks.includes('iven_introduction_heard')) {
    const target = questTarget('npc_iven')
    if (target) candidates.push({ target, mode: 'introduction' })
  }
  return candidates
}

function earlyCandidates(definition: QuestDefinition, state: CharacterQuestState): InteractionCandidate[] {
  for (const objective of definition.objectives) {
    const remaining = objective.targetIds.filter((id) => !state.discoveries.includes(`${definition.id}@${definition.version}:${objective.id}:${id}`))
    if (remaining.length === 0) continue
    if (!objective.earlyPrefix || objective.choiceIds) return []
    return remaining.flatMap((id): InteractionCandidate[] => {
      const target = questTarget(id)
      return target ? [{ target, mode: 'early', definition, objective }] : []
    })
  }
  return []
}

function markerProjection(entries: readonly QuestJournalEntry[], state: CharacterQuestState) {
  const markers = new Map<string, { id: string; category: QuestDefinition['category']; status: 'available' | 'active' | 'ready' }>()
  for (const entry of entries) {
    const definition = pinnedDefinition(entry, state)
    if (!definition || definition.status !== 'playable') continue
    if (entry.status === 'available') setPreferred(markers, { id: definition.giverId, category: definition.category, status: 'available' })
    if (entry.status === 'ready') setPreferred(markers, { id: definition.turnInId, category: definition.category, status: 'ready' })
    if (entry.status === 'active' && state.trackedIds.includes(entry.id)) {
      const destination = destinationForEntry(entry, definition, state)
      if (destination) setPreferred(markers, { id: destination.id, category: definition.category, status: 'active' })
    }
  }
  return [...markers.values()]
}

function setPreferred<T extends { id: string; category: QuestDefinition['category']; status: 'available' | 'active' | 'ready' }>(map: Map<string, T>, value: T): void {
  const current = map.get(value.id)
  const weight = (item: T): number => (item.status === 'ready' ? 0 : item.status === 'active' ? 1 : 2) + (item.category === 'main' ? 0 : 0.25)
  if (!current || weight(value) < weight(current)) map.set(value.id, value)
}

function pinnedDefinition(entry: QuestJournalEntry, state: CharacterQuestState): QuestDefinition | undefined {
  const version = state.accepted[entry.id]?.definitionVersion
  return openingQuestResolver.get(entry.id, version)
}

function questOrder(left: QuestDefinition, right: QuestDefinition): number {
  return Number(left.category === 'side') - Number(right.category === 'side') || left.id.localeCompare(right.id)
}
function candidatePriority(candidate: InteractionCandidate): number {
  return candidate.mode === 'ready' ? 0 : candidate.mode === 'active' ? 1
    : candidate.mode === 'available' ? candidate.definition?.category === 'main' ? 2 : 3
      : candidate.mode === 'early' ? 4 : candidate.mode === 'reminder' ? 5 : 6
}
function promptFor(candidate: InteractionCandidate): string {
  if (candidate.mode === 'ready') return `Turn in to ${candidate.target.label}`
  if (candidate.mode === 'available' || candidate.mode === 'introduction' || candidate.mode === 'reminder') return `Talk to ${candidate.target.label}`
  return candidate.target.id === 'seli_continue' ? 'Continue with Seli' : `Interact · ${candidate.target.label}`
}
function relativeDirection(dx: number, dz: number, facing: number): string {
  const angle = Math.atan2(dx, dz) - facing
  const normalized = Math.atan2(Math.sin(angle), Math.cos(angle))
  if (Math.abs(normalized) < Math.PI / 4) return 'ahead'
  if (Math.abs(normalized) > Math.PI * 3 / 4) return 'behind'
  return normalized > 0 ? 'right' : 'left'
}
function choiceLabel(choiceId: string): string {
  return ({ sit_nearby: 'Sit nearby', give_space: 'Give Seli space', include_parn: 'Include Parn', leave_space: 'Leave the space open' } as Record<string, string>)[choiceId] ?? choiceId
}
function readableReason(reason: string): string {
  return ({ out_of_range: 'Move closer to the marked person or object.', unknown_target: 'That interaction is not part of the current Alderbank outing.' } as Record<string, string>)[reason]
    ?? 'Finish the current objective before trying this interaction.'
}
