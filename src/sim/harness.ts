import { Sim } from './sim'
import {
  TICK_RATE,
  type EntityId,
  type ItemRarity,
  type SkillId,
  type SimEvent,
  type Vec2,
} from './types'
import { brawler, type BotPolicy } from './policies'

export { POLICIES, brawler, twinstick, punchingBag, runner, kiter, type BotPolicy } from './policies'

export interface HarnessMetrics {
  seed: number
  policy: string
  ticks: number
  seconds: number
  depthReached: number
  areasCleared: number
  clearSeconds: number[]
  areaMonsterCount: number
  monstersRemaining: number
  level: number
  xp: number
  xpPerMinute: number
  monstersKilled: number
  killsPerMinute: number
  playerDeaths: number
  damageDealt: number
  damageTaken: number
  dps: number
  damageTakenPerSecond: number
  /** Damage per second of actual combat, as opposed to per second of playtime. */
  combatDps: number
  /** Where the run's time went. The gap between these and `dps` is the real cost. */
  stateShare: { idle: number; moving: number; acting: number; dead: number }
  hits: number
  crits: number
  critRate: number
  averageTimeToKill: number
  drops: Record<ItemRarity, number>
  itemsEquipped: number
  manaBlockedCasts: number
  lowLifeSeconds: number
  timeInCombatSeconds: number
  damageBySkill: Record<string, number>
}

const LOW_LIFE_THRESHOLD = 0.35

export interface HarnessOptions {
  seed: number
  policy?: BotPolicy
  /** Ticks between bot decisions. 1 is superhuman; 6 is roughly human reaction. */
  decisionInterval?: number
  captureEvents?: boolean
}

export class Harness {
  readonly sim: Sim
  readonly policy: BotPolicy
  readonly log: SimEvent[] = []

  private readonly decisionInterval: number
  private readonly captureEvents: boolean

  private damageDealt = 0
  private damageTaken = 0
  private hits = 0
  private crits = 0
  private playerDeaths = 0
  private manaBlockedCasts = 0
  private itemsEquipped = 0
  private lowLifeTicks = 0
  private combatTicks = 0
  private readonly stateTicks: Record<string, number> = { idle: 0, moving: 0, acting: 0, dead: 0 }
  private readonly drops: Record<ItemRarity, number> = { normal: 0, magic: 0, rare: 0 }
  private readonly damageBySkill: Record<string, number> = {}
  private readonly clearSeconds: number[] = []
  private readonly monsterFirstHit = new Map<EntityId, number>()
  private readonly timeToKill: number[] = []

  constructor(options: HarnessOptions) {
    this.sim = new Sim({ seed: options.seed })
    this.policy = options.policy ?? brawler
    this.decisionInterval = options.decisionInterval ?? 3
    this.captureEvents = options.captureEvents ?? false
  }

  run(ticks: number): this {
    for (let i = 0; i < ticks; i++) this.step()
    return this
  }

  runUntil(predicate: (sim: Sim) => boolean, maxTicks: number): this {
    for (let i = 0; i < maxTicks; i++) {
      if (predicate(this.sim)) break
      this.step()
    }
    return this
  }

  step(): void {
    if (this.sim.tickCount % this.decisionInterval === 0) {
      for (const intent of this.policy.decide(this.sim)) this.sim.queue(intent)
    }
    this.sim.tick()
    this.collect()
  }

  private collect(): void {
    const sim = this.sim
    for (const event of sim.events) {
      if (this.captureEvents) this.log.push(event)
      switch (event.kind) {
        case 'hit': {
          const fromPlayer = event.sourceId === sim.player.id
          if (fromPlayer) {
            this.damageDealt += event.damage.total
            this.hits++
            if (event.damage.crit) this.crits++
            this.damageBySkill[event.skill] = (this.damageBySkill[event.skill] ?? 0) + event.damage.total
            if (!this.monsterFirstHit.has(event.targetId)) this.monsterFirstHit.set(event.targetId, sim.time)
          } else if (event.targetId === sim.player.id) {
            this.damageTaken += event.damage.total
          }
          break
        }
        case 'death': {
          const first = this.monsterFirstHit.get(event.actorId)
          if (first !== undefined) {
            this.timeToKill.push(sim.time - first)
            this.monsterFirstHit.delete(event.actorId)
          }
          break
        }
        case 'player_died':
          this.playerDeaths++
          break
        case 'item_dropped':
          this.drops[event.rarity]++
          break
        case 'item_equipped':
          this.itemsEquipped++
          break
        case 'mana_insufficient':
          this.manaBlockedCasts++
          break
        case 'area_cleared':
          this.clearSeconds.push(event.seconds)
          break
      }
    }

    this.stateTicks[sim.player.state] = (this.stateTicks[sim.player.state] ?? 0) + 1
    if (!sim.player.dead) {
      if (sim.player.life / sim.player.stats.maxLife < LOW_LIFE_THRESHOLD) this.lowLifeTicks++
      if (sim.monsters().some((m) => m.aggroed && !m.dead)) this.combatTicks++
    }
  }

  report(): HarnessMetrics {
    const sim = this.sim
    const seconds = sim.time
    const minutes = seconds / 60 || 1 / 60
    return {
      seed: sim.seed,
      policy: this.policy.name,
      ticks: sim.tickCount,
      seconds: round(seconds),
      depthReached: sim.depth,
      areasCleared: sim.areasCleared,
      clearSeconds: this.clearSeconds.map(round),
      areaMonsterCount: sim.areaMonsterCount,
      monstersRemaining: sim.monstersRemaining(),
      level: sim.progress.level,
      xp: sim.progress.xp,
      xpPerMinute: Math.round(sim.progress.xp / minutes),
      monstersKilled: sim.monstersKilled,
      killsPerMinute: round(sim.monstersKilled / minutes),
      playerDeaths: this.playerDeaths,
      damageDealt: Math.round(this.damageDealt),
      damageTaken: Math.round(this.damageTaken),
      dps: round(this.damageDealt / seconds),
      combatDps: round(this.combatTicks === 0 ? 0 : this.damageDealt / (this.combatTicks / TICK_RATE)),
      stateShare: {
        idle: share(this.stateTicks.idle ?? 0, sim.tickCount),
        moving: share(this.stateTicks.moving ?? 0, sim.tickCount),
        acting: share(this.stateTicks.acting ?? 0, sim.tickCount),
        dead: share(this.stateTicks.dead ?? 0, sim.tickCount),
      },
      damageTakenPerSecond: round(this.damageTaken / seconds),
      hits: this.hits,
      crits: this.crits,
      critRate: round(this.hits === 0 ? 0 : this.crits / this.hits),
      averageTimeToKill: round(average(this.timeToKill)),
      drops: { ...this.drops },
      itemsEquipped: this.itemsEquipped,
      manaBlockedCasts: this.manaBlockedCasts,
      lowLifeSeconds: round(this.lowLifeTicks / TICK_RATE),
      timeInCombatSeconds: round(this.combatTicks / TICK_RATE),
      damageBySkill: Object.fromEntries(
        Object.entries(this.damageBySkill).map(([id, total]) => [id, Math.round(total)]),
      ),
    }
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0
  let total = 0
  for (const value of values) total += value
  return total / values.length
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100)
}

// ---------------------------------------------------------------------------
// Focused probes
// ---------------------------------------------------------------------------

export interface DpsProbe {
  skill: SkillId
  dps: number
  hitsPerSecond: number
  averageHit: number
  crits: number
}

/**
 * Real DPS through the sim, so windup, recovery and attack speed all count.
 * The target's life is inflated so the measurement is not cut short by a kill.
 */
export function measureDps(options: {
  seed: number
  skill: SkillId
  seconds?: number
  level?: number
  gear?: readonly { baseId: string; itemLevel: number; rarity: ItemRarity }[]
  passives?: readonly string[]
}): DpsProbe {
  const sim = new Sim({ seed: options.seed })
  const seconds = options.seconds ?? 20

  if (options.level && options.level > 1) {
    sim.progress.level = options.level
    sim.player.level = options.level
    sim.progress.passivePoints = options.level - 1
  }
  for (const nodeId of options.passives ?? []) {
    if (!sim.progress.allocated.includes(nodeId)) sim.progress.allocated.push(nodeId)
  }
  sim.recomputeStats(sim.player)
  for (const gear of options.gear ?? []) sim.grantItem(gear.baseId, gear.itemLevel, gear.rarity)

  sim.player.life = sim.player.stats.maxLife
  sim.player.mana = sim.player.stats.maxMana

  const dummy = sim.monsters()[0]
  if (!dummy) throw new Error('measureDps: generated area had no monsters')
  dummy.stats = { ...dummy.stats, maxLife: 1e9, moveSpeed: 0 }
  dummy.life = 1e9
  dummy.skills = []
  dummy.pos = { x: sim.player.pos.x + 1.4, y: sim.player.pos.y }
  dummy.anchor = { ...dummy.pos }

  let damage = 0
  let hits = 0
  let crits = 0
  const totalTicks = Math.round(seconds * TICK_RATE)
  const aim: Vec2 = dummy.pos

  for (let i = 0; i < totalTicks; i++) {
    // Mana is refilled so the probe measures the skill, not the mana pool.
    sim.player.mana = sim.player.stats.maxMana
    dummy.pos = { x: sim.player.pos.x + 1.4, y: sim.player.pos.y }
    sim.queue({ kind: 'use_skill', skill: options.skill, aim: dummy.pos })
    sim.tick()
    for (const event of sim.events) {
      if (event.kind !== 'hit' || event.sourceId !== sim.player.id) continue
      damage += event.damage.total
      hits++
      if (event.damage.crit) crits++
    }
    void aim
  }

  return {
    skill: options.skill,
    dps: round(damage / seconds),
    hitsPerSecond: round(hits / seconds),
    averageHit: round(hits === 0 ? 0 : damage / hits),
    crits,
  }
}

/** Aggregates a policy across seeds, which is how balance changes get judged. */
export function sweep(options: {
  seeds: readonly number[]
  ticks: number
  policy?: BotPolicy
  decisionInterval?: number
}): { runs: HarnessMetrics[]; median: Pick<HarnessMetrics, 'dps' | 'killsPerMinute' | 'playerDeaths' | 'depthReached' | 'level' | 'xpPerMinute'> } {
  const runs = options.seeds.map((seed) => {
    const harness = new Harness({
      seed,
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.decisionInterval ? { decisionInterval: options.decisionInterval } : {}),
    })
    harness.run(options.ticks)
    return harness.report()
  })
  return {
    runs,
    median: {
      dps: median(runs.map((r) => r.dps)),
      killsPerMinute: median(runs.map((r) => r.killsPerMinute)),
      playerDeaths: median(runs.map((r) => r.playerDeaths)),
      depthReached: median(runs.map((r) => r.depthReached)),
      level: median(runs.map((r) => r.level)),
      xpPerMinute: median(runs.map((r) => r.xpPerMinute)),
    },
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!
}
