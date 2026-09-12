import {
  createQuestState,
  openingQuestResolver,
  reduceQuestIntent,
  type CharacterQuestState,
  type DialogueScene,
  type QuestDefinitionResolver,
  type QuestIntent,
  type QuestMutationError,
  type QuestTargetId,
} from '../quests'
import type { QuestStateRepository } from '../persistence'
import type { Explorer } from './movement'

export interface WorldQuestTarget {
  readonly id: QuestTargetId
  readonly label: string
  readonly x: number
  readonly z: number
  readonly interactionRadius: number
  readonly kind: 'npc' | 'patient' | 'prop'
}

export type QuestHostStatus =
  | { readonly kind: 'ready'; readonly state: CharacterQuestState }
  | { readonly kind: 'invalid_save'; readonly reason: string }
  | { readonly kind: 'save_error'; readonly reason: string }

export type QuestHostMutation =
  | { readonly kind: 'committed'; readonly state: CharacterQuestState; readonly scenes: readonly DialogueScene[] }
  | { readonly kind: 'rejected'; readonly state: CharacterQuestState; readonly reason: QuestMutationError | 'out_of_range' | 'unknown_target'; readonly scenes: readonly DialogueScene[] }
  | { readonly kind: 'conflict'; readonly state: CharacterQuestState }
  | { readonly kind: 'save_error'; readonly state: CharacterQuestState; readonly reason: string }

export class WorldQuestHost {
  private current: CharacterQuestState | null = null
  private created = false
  private statusListener: (status: QuestHostStatus) => void = () => {}
  private mutationQueue: Promise<QuestHostMutation | null> = Promise.resolve(null)
  private readonly targetsById: ReadonlyMap<string, WorldQuestTarget>

  constructor(
    private readonly characterId: string,
    private readonly repository: QuestStateRepository,
    targets: readonly WorldQuestTarget[],
    private readonly resolver: QuestDefinitionResolver = openingQuestResolver,
  ) {
    const ids = new Set<string>()
    for (const target of targets) {
      if (ids.has(target.id)) throw new Error(`duplicate quest target: ${target.id}`)
      if (!Number.isFinite(target.x) || !Number.isFinite(target.z)
        || !Number.isFinite(target.interactionRadius) || target.interactionRadius <= 0) {
        throw new Error(`invalid quest target placement: ${target.id}`)
      }
      ids.add(target.id)
    }
    this.targetsById = new Map(targets.map((target) => [target.id, target]))
  }

  get state(): CharacterQuestState | null { return this.current }
  get isFresh(): boolean { return this.created }

  onStatus(listener: (status: QuestHostStatus) => void): void {
    this.statusListener = listener
    if (this.current) listener({ kind: 'ready', state: this.current })
  }

  async initialize(): Promise<QuestHostStatus> {
    try {
      const loaded = await this.repository.load(this.characterId)
      if (loaded.kind === 'invalid') return this.publish({ kind: 'invalid_save', reason: loaded.reason })
      this.created = loaded.kind === 'missing'
      this.current = loaded.kind === 'loaded' ? loaded.snapshot : createQuestState(this.characterId)
      return this.publish({ kind: 'ready', state: this.current })
    } catch (error) {
      return this.publish({ kind: 'save_error', reason: readableError(error) })
    }
  }

  dispatch(intent: QuestIntent, explorer: Pick<Explorer, 'x' | 'z'>): Promise<QuestHostMutation> {
    const queued = this.mutationQueue.then(() => this.apply(intent, explorer))
    this.mutationQueue = queued
    return queued
  }

  nearestTarget(explorer: Pick<Explorer, 'x' | 'z'>): WorldQuestTarget | null {
    let nearest: WorldQuestTarget | null = null
    let nearestDistance = Infinity
    for (const target of this.targetsById.values()) {
      const distance = Math.hypot(target.x - explorer.x, target.z - explorer.z)
      if (distance <= target.interactionRadius && distance < nearestDistance) {
        nearest = target
        nearestDistance = distance
      }
    }
    return nearest
  }

  private async apply(intent: QuestIntent, explorer: Pick<Explorer, 'x' | 'z'>): Promise<QuestHostMutation> {
    const current = this.current
    if (!current) throw new Error('Quest host must initialize before accepting intents.')
    if (!Number.isFinite(explorer.x) || !Number.isFinite(explorer.z)) {
      return { kind: 'rejected', state: current, reason: 'out_of_range', scenes: [] }
    }
    const targetId = intentTarget(intent)
    if (targetId) {
      const target = this.targetsById.get(targetId)
      if (!target) return { kind: 'rejected', state: current, reason: 'unknown_target', scenes: [] }
      if (Math.hypot(target.x - explorer.x, target.z - explorer.z) > target.interactionRadius) {
        return { kind: 'rejected', state: current, reason: 'out_of_range', scenes: [] }
      }
    }
    const reduced = reduceQuestIntent(current, intent, this.resolver)
    if (!reduced.changed) {
      return { kind: 'rejected', state: current, reason: reduced.error ?? 'invalid_state', scenes: reduced.scenes }
    }
    try {
      const committed = await this.repository.commit(this.characterId, current.revision, reduced.state)
      if (committed.kind === 'conflict') {
        this.current = committed.current
        this.publish({ kind: 'ready', state: committed.current })
        return { kind: 'conflict', state: committed.current }
      }
      if (committed.kind === 'invalid' || committed.kind === 'error') {
        return { kind: 'save_error', state: current, reason: committed.reason }
      }
      this.current = committed.snapshot
      this.publish({ kind: 'ready', state: committed.snapshot })
      return { kind: 'committed', state: committed.snapshot, scenes: reduced.scenes }
    } catch (error) {
      return { kind: 'save_error', state: current, reason: readableError(error) }
    }
  }

  private publish<T extends QuestHostStatus>(status: T): T {
    this.statusListener(status)
    return status
  }
}

function intentTarget(intent: QuestIntent): string | null {
  switch (intent.kind) {
    case 'accept': return intent.giverId
    case 'interact': return intent.targetId
    case 'choose': return intent.targetId
    case 'turn_in': return intent.turnInId
    case 'track': return null
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
