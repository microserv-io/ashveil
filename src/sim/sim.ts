import { updateMonsterAI } from './ai'
import { characterMods, createCharacter, type Character } from './character'
import { computeHit } from './damage'
import { spoilsOf, type DropSite } from './drops'
import { equipFromBag, pickUpGroundItem, type ItemHolder } from './equipment'
import { rollItem } from './items'
import { startingGear } from './loot'
import type { ItemMint } from './items'
import { allocatePassiveNode, grantKillXp, type Advancement } from './leveling'
import { isWalkable, type PackPlan } from './mapgen'
import { SNAPSHOT_VERSION, type InstanceSnapshot, type TickMode } from './snapshot'
import {
  MONSTERS,
  MONSTER_MODIFIERS,
  RARITY_SCALING,
  monsterBaseStats,
  monsterDamageMods,
  monsterModifierCount,
  monsterXp,
} from './monsters'
import { NavGrid, findPath, hasLineOfSight } from './pathfind'
import { Rng } from './rng'
import { PLAYER_BASE, resolveStats, type BaseStats } from './stats'
import { PLAYER_SKILLS, skill as skillDef, speedMultiplier } from './skills'
import { aimPoint, assistCone, softTarget } from './targeting'
import { enterArea, resetPlayerForArea, revivePlayerAt } from './transitions'
import {
  DT,
  HIT_FLASH_DURATION,
  type Actor,
  type AilmentKind,
  type AreaMap,
  type DamageType,
  type EntityId,
  type GroundItem,
  type Intent,
  type PlayerCommand,
  type PlayerId,
  type Item,
  type ItemId,
  type Mod,
  type MonsterArchetype,
  type MonsterRarity,
  type Orb,
  type Projectile,
  type SimEvent,
  type SkillDef,
  type SkillId,
  type WeaponBase,
  type ZoneKind,
  type ZoneRules,
  ZONE_RULES,
} from './types'
import { add, angleOf, clone, distance, normalize, scale, sub, vec2, withinArc, type Vec2 } from './vec2'

export interface SimOptions {
  seed: number
  depth?: number
  /** Characters joining at creation. Omitted, one is rolled for single-player. */
  characters?: readonly Character[]
  /**
   * Defaults to a dungeon, which is where the loop is played.
   */
  zone?: ZoneKind
  /**
   * Globally unique in a live deployment; the server supplies it. Locally it is
   * derived from the seed so item ids stay reproducible in tests and replays.
   */
  instanceId?: string
}

/**
 * A player inside this instance. The character is owned by the session and merely
 * lent here, which is what lets a party carry progress between areas.
 */
function subjectOf(playerId: PlayerId | null): { subject?: PlayerId } {
  return playerId === null ? {} : { subject: playerId }
}

export interface PlayerSlot {
  id: PlayerId
  character: Character
  actorId: EntityId
  /** Highest command sequence applied. A client reconciles its prediction to this. */
  lastSequence: number
}

function holderOf(slot: PlayerSlot, actor: Actor): ItemHolder {
  return { playerId: slot.id, character: slot.character, actor }
}

const UNARMED: WeaponBase = { physicalMin: 2, physicalMax: 5, attacksPerSecond: 1.2 }
const PLAYER_RADIUS = 0.44
const PORTAL_RANGE = 2.5
const RESPAWN_DELAY = 1.6
const PATH_WAYPOINT_EPSILON = 0.28
/** Direct input lapses this long after the last update, so releasing a stick stops you. */
const DIRECT_MOVE_GRACE = 0.1
const STUCK_GRACE = 0.25
const IGNITE_DURATION = 3
const CHILL_DURATION = 2.5
const CHILL_MAGNITUDE = 0.3

/**
 * The deterministic core. It owns the clock, the entity set and the tick order;
 * everything a host needs to draw or drive it comes through `events` and the
 * read-only queries at the bottom. No DOM, no wall-clock, no Math.random.
 */
export class Sim {
  readonly rng: Rng
  readonly seed: number
  depth: number
  time = 0
  tickCount = 0

  map: AreaMap
  nav: NavGrid
  actors: Actor[] = []
  projectiles: Projectile[] = []
  groundItems: GroundItem[] = []
  orbs: Orb[] = []
  /** Cleared at the start of every tick; hosts read it after `tick()` returns. */
  events: SimEvent[] = []

  readonly players = new Map<PlayerId, PlayerSlot>()
  /**
   * The player this host controls. A server leaves it at the first joiner; a client
   * sets it to whoever it owns. Everything host-side reads the world through it.
   */
  localPlayerId: PlayerId = 1

  readonly zone: ZoneKind
  readonly rules: ZoneRules
  readonly instanceId: string

  monstersKilled = 0
  areaMonsterCount = 0
  areaStartTime = 0
  areaCleared = false
  areasCleared = 0

  private commands: PlayerCommand[] = []
  private nextEntityId = 1
  private nextItemSerial = 1
  private nextPlayerId = 1
  private localSequence = 0
  private readonly respawnAt = new Map<PlayerId, number>()

  constructor(options: SimOptions) {
    this.seed = options.seed
    this.rng = new Rng(options.seed)
    this.depth = options.depth ?? 1
    this.zone = options.zone ?? 'dungeon'
    this.rules = ZONE_RULES[this.zone]
    this.instanceId = options.instanceId ?? `local-${options.seed >>> 0}`

    const entry = enterArea(this.seed, this.depth)
    this.map = entry.map
    this.nav = entry.nav

    // A session normally supplies characters. Without one, roll a fresh character
    // so a bare `new Sim(...)` is still a playable single-player instance.
    for (const character of options.characters ??
      [createCharacter('local', 'Ashbearer', startingGear(this.rng, this.mint))]) {
      this.addPlayer(character)
    }
    if (this.rules.combat) this.spawnPacks(entry.packs)
    this.areaStartTime = 0
    this.events.push({ kind: 'area_entered', depth: this.depth, seed: this.seed })
  }

  /**
   * Identity and provenance for items this instance creates. Per-instance rather
   * than module-global: a shared counter leaks across instances in one process,
   * which made ids depend on construction order and would have been a real problem
   * the moment items had value.
   */
  readonly mint: ItemMint = {
    next: (source: string) => ({
      id: `${this.instanceId}#${this.nextItemSerial++}`,
      origin: { instanceId: this.instanceId, depth: this.depth, tick: this.tickCount, source },
    }),
  }

  /** What a death needs to become loot on the floor. */
  private get dropSite(): DropSite {
    return {
      map: this.map,
      rng: this.rng,
      mint: this.mint,
      time: this.time,
      nextId: () => this.nextEntityId++,
    }
  }

  /** The instance-side half of progression: who is levelling, and how to re-resolve them. */
  private advancementOf(playerId: PlayerId | null): Advancement | null {
    const slot = playerId === null ? undefined : this.players.get(playerId)
    const actor = slot && this.actorOf(slot.id)
    if (!slot || !actor) return null
    return { playerId: slot.id, character: slot.character, actor, recomputeStats: (a) => this.recomputeStats(a) }
  }

  // -------------------------------------------------------------------------
  // Host surface
  // -------------------------------------------------------------------------

  /**
   * Seat a character. Returns the id the host uses to address commands and to know
   * which actor it owns.
   */
  addPlayer(character: Character): PlayerId {
    const id = this.nextPlayerId++
    const actor = this.createPlayerActor(character)
    this.actors.push(actor)
    this.players.set(id, { id, character, actorId: actor.id, lastSequence: 0 })
    return id
  }

  removePlayer(id: PlayerId): Character | null {
    const slot = this.players.get(id)
    if (!slot) return null
    this.players.delete(id)
    this.respawnAt.delete(id)
    this.actors = this.actors.filter((actor) => actor.id !== slot.actorId)
    return slot.character
  }

  /** The authoritative entry point: an addressed, sequenced command. */
  submit(command: PlayerCommand): void {
    this.commands.push(command)
  }

  /** Convenience for a host driving exactly one local player. */
  queue(intent: Intent): void {
    this.commands.push({ playerId: this.localPlayerId, sequence: ++this.localSequence, intent })
  }

  slot(id: PlayerId): PlayerSlot | undefined {
    return this.players.get(id)
  }

  actorOf(id: PlayerId): Actor | undefined {
    const slot = this.players.get(id)
    if (!slot) return undefined
    return this.actors.find((actor) => actor.id === slot.actorId)
  }

  characterOf(id: PlayerId): Character | undefined {
    return this.players.get(id)?.character
  }

  playerIdOfActor(actorId: EntityId): PlayerId | null {
    for (const slot of this.players.values()) {
      if (slot.actorId === actorId) return slot.id
    }
    return null
  }

  /** The local player's actor. Hosts render and aim through this. */
  get player(): Actor {
    const actor = this.actorOf(this.localPlayerId)
    if (!actor) throw new Error(`no actor for local player ${this.localPlayerId}`)
    return actor
  }

  get progress(): Character {
    const character = this.characterOf(this.localPlayerId)
    if (!character) throw new Error(`no character for local player ${this.localPlayerId}`)
    return character
  }

  playerActors(): Actor[] {
    const actors: Actor[] = []
    for (const slot of this.players.values()) {
      const actor = this.actors.find((a) => a.id === slot.actorId)
      if (actor) actors.push(actor)
    }
    return actors
  }

  /** Monsters chase whoever is closest, which is the whole of party aggro. */
  nearestPlayerTo(position: Vec2): Actor | null {
    let best: Actor | null = null
    let bestGap = Infinity
    for (const actor of this.playerActors()) {
      if (actor.dead) continue
      const gap = distance(position, actor.pos)
      if (gap < bestGap) {
        best = actor
        bestGap = gap
      }
    }
    return best
  }

  /**
   * `authoritative` is the whole game and only a server runs it. `predicted` is the
   * subset a client may run ahead of the server for its own responsiveness: input,
   * timers and movement, none of which touch the RNG. Everything that rolls dice or
   * decides an outcome — damage, loot, death, experience — is server-only, which is
   * what stops a client inventing its own drops.
   */
  tick(mode: TickMode = 'authoritative'): void {
    this.events = []
    this.time += DT
    this.tickCount++

    if (mode === 'predicted') {
      this.rng.locked = true
      try {
        this.applyIntents()
        this.advanceTimers()
        this.updateMovement()
        this.resolveSeparation()
      } finally {
        this.rng.locked = false
      }
      return
    }

    this.applyIntents()
    this.advanceTimers()

    // Everything that can deal damage, then the death pass, before anything
    // makes a decision — otherwise AI spends a tick reacting to a corpse.
    this.resolveCasts()
    this.updateProjectiles()
    this.updateAilments()
    this.updateDeaths()

    this.updateAI()
    this.updateMovement()
    this.resolveSeparation()
    this.updateRegeneration()
    this.updatePickups()
    this.updateRespawn()
    this.updateAreaState()
  }

  // -------------------------------------------------------------------------
  // Tick phases
  // -------------------------------------------------------------------------

  private applyIntents(): void {
    const queued = this.commands
    this.commands = []
    for (const command of queued) {
      const slot = this.players.get(command.playerId)
      if (!slot) continue
      const actor = this.actorOf(command.playerId)
      if (!actor) continue
      slot.lastSequence = Math.max(slot.lastSequence, command.sequence)

      const intent = command.intent
      // A corpse may still spend passive points; it may not act in the world.
      if (actor.dead && intent.kind !== 'allocate_passive') continue

      switch (intent.kind) {
        case 'move':
          actor.moveDirection = null
          this.setMoveTarget(actor, intent.to)
          break
        case 'move_direction':
          this.applyDirectMove(actor, intent.direction, intent.facing)
          break
        case 'stop':
          actor.moveDirection = null
          this.clearPath(actor)
          break
        case 'use_skill':
          this.beginCast(actor, intent.skill, intent.aim)
          break
        case 'pickup':
          this.events.push(...pickUpGroundItem(holderOf(slot, actor), this.groundItems, intent.itemId))
          break
        case 'equip':
          this.equip(slot, actor, intent.itemId)
          break
        case 'allocate_passive': {
          const advancing = this.advancementOf(slot.id)
          if (advancing) this.events.push(...allocatePassiveNode(advancing, intent.nodeId))
          break
        }
        case 'enter_portal':
          // Only a dungeon leads anywhere deeper; a hub or overworld is a place.
          if (this.rules.clearable && distance(actor.pos, this.map.portal) <= PORTAL_RANGE) this.enterNextArea()
          break
      }
    }
  }

  private advanceTimers(): void {
    for (const actor of this.actors) {
      if (actor.hitFlash > 0) actor.hitFlash = Math.max(0, actor.hitFlash - DT)
      for (const [id, remaining] of Object.entries(actor.cooldowns)) {
        const next = (remaining ?? 0) - DT
        if (next <= 0) delete actor.cooldowns[id as SkillId]
        else actor.cooldowns[id as SkillId] = next
      }
      if (actor.dead) continue
      if (actor.windup > 0) actor.windup = Math.max(0, actor.windup - DT)
      else if (actor.recovery > 0) {
        actor.recovery = Math.max(0, actor.recovery - DT)
        if (actor.recovery === 0) {
          actor.activeSkill = null
          actor.state = 'idle'
        }
      }
    }
  }

  private resolveCasts(): void {
    for (const actor of this.actors) {
      if (actor.dead || !actor.pendingCast || actor.windup > 0) continue
      const cast = actor.pendingCast
      actor.pendingCast = null
      const def = skillDef(cast.skill)
      actor.recovery = def.recovery / speedMultiplier(def, actor.stats.attackSpeed, actor.stats.castSpeed)
      actor.recoveryTotal = actor.recovery

      switch (def.shape) {
        case 'melee_arc':
          this.resolveMeleeArc(actor, def)
          break
        case 'nova':
          this.resolveNova(actor, def)
          break
        case 'projectile':
          this.spawnProjectile(actor, def, cast.aim)
          break
        case 'dash':
          this.startDash(actor, def, cast.aim)
          break
      }
    }
  }

  private updateAI(): void {
    for (const actor of this.actors) {
      if (actor.dead || actor.kind !== 'monster') continue
      updateMonsterAI(this, actor)
    }
  }

  private updateProjectiles(): void {
    const survivors: Projectile[] = []
    for (const projectile of this.projectiles) {
      const step = scale(projectile.velocity, DT)
      projectile.pos = add(projectile.pos, step)
      projectile.distanceLeft -= Math.hypot(step.x, step.y)

      if (projectile.distanceLeft <= 0) continue
      if (!isWalkable(this.map, projectile.pos, projectile.radius * 0.5)) continue

      const owner = this.actorById(projectile.ownerId)
      if (!owner) continue

      let consumed = false
      for (const actor of this.actors) {
        if (actor.dead || projectile.hitIds.includes(actor.id)) continue
        const isHostile = projectile.hostile ? actor.kind === 'player' : actor.kind === 'monster'
        if (!isHostile) continue
        if (distance(actor.pos, projectile.pos) > actor.radius + projectile.radius) continue

        projectile.hitIds.push(actor.id)
        this.applyHit(owner, actor, skillDef(projectile.skill))
        if (projectile.pierceLeft <= 0) {
          consumed = true
          break
        }
        projectile.pierceLeft--
      }
      if (!consumed) survivors.push(projectile)
    }
    this.projectiles = survivors
  }

  private updateMovement(): void {
    for (const actor of this.actors) {
      if (actor.dead) {
        actor.velocity = vec2()
        continue
      }
      if (actor.moveDirection && this.time > actor.moveDirectionExpiry) {
        actor.moveDirection = null
        if (actor.state === 'moving') actor.state = 'idle'
      }
      if (actor.dash) {
        this.advanceDash(actor)
        continue
      }
      if (this.mobilityOf(actor) === 0 && (actor.windup > 0 || actor.recovery > 0)) {
        actor.velocity = vec2()
        continue
      }
      if (actor.moveDirection) {
        this.steerDirect(actor)
        continue
      }
      this.followPath(actor)
    }
  }

  /** Bodies never overlap: monsters yield to the player and to each other. */
  private resolveSeparation(): void {
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i]!
      if (a.dead) continue
      for (let j = i + 1; j < this.actors.length; j++) {
        const b = this.actors[j]!
        if (b.dead) continue
        const minimum = a.radius + b.radius
        const delta = sub(b.pos, a.pos)
        const gap = Math.hypot(delta.x, delta.y)
        if (gap >= minimum || gap < 1e-6) continue

        const push = (minimum - gap) / 2
        const direction = scale(delta, 1 / gap)
        const aYields = a.kind === 'monster'
        const bYields = b.kind === 'monster'
        if (aYields && bYields) {
          this.nudge(a, scale(direction, -push))
          this.nudge(b, scale(direction, push))
        } else if (aYields) {
          this.nudge(a, scale(direction, -(minimum - gap)))
        } else if (bYields) {
          this.nudge(b, scale(direction, minimum - gap))
        }
      }
    }
  }

  private updateAilments(): void {
    for (const actor of this.actors) {
      if (actor.dead || actor.ailments.length === 0) continue
      const kept = []
      for (const ailment of actor.ailments) {
        if (ailment.expiresAt <= this.time) continue
        if (ailment.kind === 'ignited') actor.life -= ailment.magnitude * DT
        kept.push(ailment)
      }
      actor.ailments = kept
    }
  }

  private updateRegeneration(): void {
    for (const actor of this.actors) {
      if (actor.dead) continue
      if (actor.stats.lifeRegen > 0) {
        actor.life = Math.min(actor.stats.maxLife, actor.life + actor.stats.lifeRegen * DT)
      }
      if (actor.stats.manaRegen > 0) {
        actor.mana = Math.min(actor.stats.maxMana, actor.mana + actor.stats.manaRegen * DT)
      }
    }
  }

  private updateDeaths(): void {
    for (const actor of this.actors) {
      if (actor.dead || actor.life > 0) continue
      this.kill(actor)
    }
  }

  private updatePickups(): void {
    const remaining: Orb[] = []
    for (const orb of this.orbs) {
      const collector = this.playerActors().find(
        (actor) => !actor.dead && distance(orb.pos, actor.pos) <= actor.stats.pickupRadius + actor.radius,
      )
      if (!collector) {
        remaining.push(orb)
        continue
      }
      const healed = Math.min(collector.stats.maxLife - collector.life, collector.stats.maxLife * orb.lifeFraction)
      collector.life += healed
      this.events.push({
        kind: 'orb_collected',
        healed,
        pos: clone(orb.pos),
        ...subjectOf(this.playerIdOfActor(collector.id)),
      })
    }
    this.orbs = remaining
  }

  private updateRespawn(): void {
    for (const [playerId, dueAt] of this.respawnAt) {
      if (this.time < dueAt) continue
      const actor = this.actorOf(playerId)
      if (!actor) {
        this.respawnAt.delete(playerId)
        continue
      }
      this.respawnAt.delete(playerId)
      revivePlayerAt(actor, this.map.spawn)
      this.clearPath(actor)
    }

    // Nothing left alive to fight means the pack loses interest, however many
    // players are down.
    if (this.playerActors().some((actor) => !actor.dead)) return
    for (const actor of this.actors) {
      if (actor.kind !== 'monster') continue
      actor.aggroed = false
      actor.targetId = null
      this.clearPath(actor)
    }
  }

  private updateAreaState(): void {
    if (!this.rules.clearable) return
    if (this.areaCleared || this.areaMonsterCount === 0) return
    if (this.monstersRemaining() > 0) return
    this.areaCleared = true
    this.areasCleared++
    this.events.push({
      kind: 'area_cleared',
      monstersKilled: this.areaMonsterCount,
      seconds: Math.round((this.time - this.areaStartTime) * 10) / 10,
    })
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  beginCast(actor: Actor, id: SkillId, aim: Vec2): boolean {
    if (actor.dead || actor.windup > 0 || actor.recovery > 0 || actor.dash) return false
    if (!actor.skills.includes(id)) return false
    const def = skillDef(id)
    if ((actor.cooldowns[id] ?? 0) > 0) return false
    if (def.manaCost > 0 && actor.mana < def.manaCost) {
      if (actor.kind === 'player') this.events.push({ kind: 'mana_insufficient', skill: id })
      return false
    }

    actor.mana -= def.manaCost
    const speed = speedMultiplier(def, actor.stats.attackSpeed, actor.stats.castSpeed)
    actor.windup = def.windup / speed
    actor.windupTotal = actor.windup
    actor.activeSkill = id
    actor.pendingCast = { skill: id, aim: clone(aim), targetId: actor.targetId }
    actor.state = 'acting'
    if (def.cooldown > 0) actor.cooldowns[id] = def.cooldown
    if (distance(aim, actor.pos) > 0.05) actor.facing = angleOf(sub(aim, actor.pos))
    if ((def.mobility ?? 0) === 0) this.clearPath(actor)
    this.events.push({ kind: 'skill_used', actorId: actor.id, skill: id, aim: clone(aim) })
    return true
  }

  private resolveMeleeArc(actor: Actor, def: SkillDef): void {
    const halfArc = ((def.arcDegrees ?? 90) * Math.PI) / 360
    for (const target of this.hostilesOf(actor)) {
      if (distance(actor.pos, target.pos) > def.range + target.radius) continue
      if (!withinArc(actor.pos, actor.facing, halfArc, target.pos)) continue
      this.applyHit(actor, target, def)
    }
  }

  private resolveNova(actor: Actor, def: SkillDef): void {
    const radius = (def.radius ?? 3) * actor.stats.areaRadius
    for (const target of this.hostilesOf(actor)) {
      const gap = distance(actor.pos, target.pos) - target.radius
      if (gap > radius) continue
      // Rim hits land for less, which rewards standing in the middle of a pack.
      const falloff = 1 - 0.35 * Math.max(0, Math.min(1, gap / radius))
      this.applyHit(actor, target, def, falloff)
    }
  }

  private spawnProjectile(actor: Actor, def: SkillDef, aim: Vec2): void {
    const direction = normalize(sub(aim, actor.pos))
    if (direction.x === 0 && direction.y === 0) return
    this.projectiles.push({
      id: this.nextEntityId++,
      skill: def.id,
      ownerId: actor.id,
      hostile: actor.kind === 'monster',
      pos: add(actor.pos, scale(direction, actor.radius + 0.2)),
      velocity: scale(direction, def.projectileSpeed ?? 12),
      radius: def.projectileRadius ?? 0.3,
      distanceLeft: def.range,
      pierceLeft: def.pierce ?? 0,
      hitIds: [],
    })
  }

  private startDash(actor: Actor, def: SkillDef, aim: Vec2): void {
    const direction = normalize(sub(aim, actor.pos))
    if (direction.x === 0 && direction.y === 0) return
    actor.dash = { direction, distanceLeft: def.range, speed: def.dashSpeed ?? 20 }
    actor.facing = angleOf(direction)
  }

  private applyHit(source: Actor, target: Actor, def: SkillDef, effectiveness = 1): void {
    const breakdown = computeHit(source, target, def, this.weaponOf(source), this.rng, effectiveness)
    target.life -= breakdown.total
    target.hitFlash = HIT_FLASH_DURATION
    if (source.kind === 'player') target.lastDamageFrom = this.playerIdOfActor(source.id)
    this.events.push({
      kind: 'hit',
      sourceId: source.id,
      targetId: target.id,
      skill: def.id,
      damage: breakdown,
      pos: clone(target.pos),
    })

    if (target.kind === 'monster' && !target.aggroed) {
      target.aggroed = true
      target.targetId = source.id
    }

    if (def.ailmentChance && this.rng.chance(def.ailmentChance)) {
      this.applyAilment(source, target, breakdown.byType)
    }
  }

  private applyAilment(source: Actor, target: Actor, byType: Record<DamageType, number>): void {
    let dominant: DamageType = 'physical'
    let best = 0
    for (const type of ['fire', 'cold', 'lightning'] as const) {
      if (byType[type] > best) {
        best = byType[type]
        dominant = type
      }
    }
    if (best <= 0) return

    let kind: AilmentKind | null = null
    let magnitude = 0
    if (dominant === 'fire') {
      kind = 'ignited'
      magnitude = (best * 0.5) / IGNITE_DURATION
    } else if (dominant === 'cold') {
      kind = 'chilled'
      magnitude = CHILL_MAGNITUDE
    }
    if (!kind) return

    const duration = kind === 'ignited' ? IGNITE_DURATION : CHILL_DURATION
    const existing = target.ailments.find((a) => a.kind === kind)
    if (existing && existing.magnitude >= magnitude) {
      existing.expiresAt = Math.max(existing.expiresAt, this.time + duration)
      return
    }
    target.ailments = target.ailments.filter((a) => a.kind !== kind)
    target.ailments.push({ kind, magnitude, expiresAt: this.time + duration, sourceId: source.id })
    this.events.push({ kind: 'ailment_applied', targetId: target.id, ailment: kind })
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  setMoveTarget(actor: Actor, to: Vec2): void {
    const path = findPath(this.nav, actor.pos, to, actor.radius)
    if (!path || path.length === 0) {
      this.clearPath(actor)
      return
    }
    actor.moveTarget = clone(to)
    actor.path = path
    actor.pathCursor = 0
    actor.state = 'moving'
  }

  clearPath(actor: Actor): void {
    actor.path = []
    actor.pathCursor = 0
    actor.moveTarget = null
    actor.stuckFor = 0
    actor.velocity = vec2()
    if (actor.state === 'moving') actor.state = 'idle'
  }

  private applyDirectMove(player: Actor, direction: Vec2, facing: number | undefined): void {
    const magnitude = Math.hypot(direction.x, direction.y)
    if (magnitude < 1e-3) {
      player.moveDirection = null
      if (player.state === 'moving') player.state = 'idle'
      if (facing !== undefined && !this.isActing(player)) player.facing = facing
      return
    }
    if (facing === undefined && !this.isActing(player)) player.facing = Math.atan2(direction.y, direction.x)
    // Direct input wins over a queued click destination rather than fighting it.
    if (player.path.length > 0) this.clearPath(player)
    player.moveDirection = { x: direction.x, y: direction.y }
    player.moveDirectionExpiry = this.time + DIRECT_MOVE_GRACE
    if (facing !== undefined && !this.isActing(player)) player.facing = facing
  }

  /** Analog steering: no path, no waypoints, just push and slide along what blocks. */
  private steerDirect(actor: Actor): void {
    const direction = actor.moveDirection!
    const magnitude = Math.hypot(direction.x, direction.y)
    if (magnitude < 1e-3) return

    const unit = { x: direction.x / magnitude, y: direction.y / magnitude }
    const speed = this.effectiveMoveSpeed(actor) * Math.min(1, magnitude)
    const before = clone(actor.pos)
    this.nudge(actor, scale(unit, speed * DT))
    actor.velocity = scale(sub(actor.pos, before), 1 / DT)
    if (!this.isActing(actor)) actor.state = 'moving'
  }

  /**
   * What a skill is aimed at for a player with no cursor. Hosts pass the aim stick
   * when they have one; the browser passes the mouse point as an explicit aim.
   */
  aimFor(actor: Actor, id: SkillId, stick: Vec2 | null): { aim: Vec2; target: Actor | null } {
    const def = skillDef(id)
    const reach = def.shape === 'nova' ? (def.radius ?? 3) * actor.stats.areaRadius : def.range
    const target = softTarget(this.hostilesOf(actor), actor.pos, actor.facing, {
      range: reach,
      coneDegrees: assistCone(def.shape),
    })
    return { aim: aimPoint(actor.pos, actor.facing, stick, reach, target), target }
  }

  private followPath(actor: Actor): void {
    if (actor.pathCursor >= actor.path.length) {
      if (actor.path.length > 0) this.clearPath(actor)
      actor.velocity = vec2()
      return
    }

    const waypoint = actor.path[actor.pathCursor]!
    if (distance(actor.pos, waypoint) <= PATH_WAYPOINT_EPSILON) {
      actor.pathCursor++
      if (actor.pathCursor >= actor.path.length) {
        this.clearPath(actor)
        return
      }
    }

    const next = actor.path[actor.pathCursor]!
    const direction = normalize(sub(next, actor.pos))
    const speed = this.effectiveMoveSpeed(actor)
    const step = scale(direction, speed * DT)
    const before = clone(actor.pos)
    const gapBefore = distance(before, next)
    this.nudge(actor, step)
    actor.velocity = scale(sub(actor.pos, before), 1 / DT)
    // Mid-skill the body stays pointed at what it is casting at, so a walking cast
    // strafes rather than turning its back on the target.
    if (!this.isActing(actor) && (direction.x !== 0 || direction.y !== 0)) actor.facing = angleOf(direction)
    if (!this.isActing(actor)) actor.state = 'moving'

    this.trackStuck(actor, gapBefore - distance(actor.pos, next), speed * DT)
  }

  /**
   * Progress toward the waypoint, not distance travelled: a body grinding along a
   * wall moves at nearly full speed while getting no closer, and that is exactly
   * the case the naive check misses. Separation pushes also drift actors off their
   * path, so recovery is a repath from where the body actually is.
   */
  private trackStuck(actor: Actor, progress: number, intended: number): void {
    if (progress >= intended * 0.3) {
      actor.stuckFor = 0
      return
    }
    actor.stuckFor += DT
    if (actor.stuckFor < STUCK_GRACE) return

    actor.stuckFor = 0
    const destination = actor.moveTarget
    if (!destination) {
      this.clearPath(actor)
      return
    }
    const path = findPath(this.nav, actor.pos, destination, actor.radius)
    if (!path || path.length === 0) {
      this.clearPath(actor)
      return
    }
    actor.path = path
    actor.pathCursor = 0
  }

  private advanceDash(actor: Actor): void {
    const dash = actor.dash!
    const step = Math.min(dash.speed * DT, dash.distanceLeft)
    const before = clone(actor.pos)
    this.nudge(actor, scale(dash.direction, step))
    const travelled = distance(before, actor.pos)
    dash.distanceLeft -= Math.max(step, 0.0001)
    actor.velocity = scale(sub(actor.pos, before), 1 / DT)
    // A dash into a wall ends there rather than grinding along it.
    if (dash.distanceLeft <= 0 || travelled < step * 0.4) actor.dash = null
  }

  private effectiveMoveSpeed(actor: Actor): number {
    let speed = actor.stats.moveSpeed * (this.isActing(actor) ? this.mobilityOf(actor) : 1)
    for (const ailment of actor.ailments) {
      if (ailment.kind === 'chilled') speed *= 1 - ailment.magnitude
    }
    return speed
  }

  private isActing(actor: Actor): boolean {
    return actor.windup > 0 || actor.recovery > 0
  }

  /** How much of its speed an actor keeps mid-skill. Rooted unless the skill says so. */
  private mobilityOf(actor: Actor): number {
    if (!actor.activeSkill) return 0
    return skillDef(actor.activeSkill).mobility ?? 0
  }

  /** Wall-aware translation: slides along the blocking axis instead of stopping dead. */
  private nudge(actor: Actor, delta: Vec2): void {
    const target = add(actor.pos, delta)
    if (isWalkable(this.map, target, actor.radius)) {
      actor.pos = target
      return
    }
    const slideX = vec2(target.x, actor.pos.y)
    if (isWalkable(this.map, slideX, actor.radius)) {
      actor.pos = slideX
      return
    }
    const slideY = vec2(actor.pos.x, target.y)
    if (isWalkable(this.map, slideY, actor.radius)) actor.pos = slideY
  }

  // -------------------------------------------------------------------------
  // Death, loot, progression
  // -------------------------------------------------------------------------

  private kill(actor: Actor): void {
    actor.dead = true
    actor.diedAt = this.time
    actor.state = 'dead'
    actor.life = 0
    actor.pendingCast = null
    actor.dash = null
    actor.ailments = []
    this.clearPath(actor)
    const killer = actor.lastDamageFrom
    const killerActorId = killer === null ? null : (this.players.get(killer)?.actorId ?? null)
    this.events.push({ kind: 'death', actorId: actor.id, killerId: killerActorId, pos: clone(actor.pos) })

    if (actor.kind === 'player') {
      const playerId = this.playerIdOfActor(actor.id)
      if (playerId !== null) this.respawnAt.set(playerId, this.time + RESPAWN_DELAY)
      this.events.push({ kind: 'player_died', pos: clone(actor.pos), ...subjectOf(playerId) })
      return
    }

    this.monstersKilled++
    const spoils = spoilsOf(this.dropSite, actor)
    this.groundItems.push(...spoils.groundItems)
    this.orbs.push(...spoils.orbs)
    this.events.push(...spoils.events)
    const earner = this.advancementOf(killer)
    if (earner) this.events.push(...grantKillXp(earner, actor.xpValue, actor.level))
  }

  private equip(slot: PlayerSlot, actor: Actor, itemId: ItemId): void {
    this.events.push(...equipFromBag(holderOf(slot, actor), itemId, (target) => this.recomputeStats(target)))
  }

  // -------------------------------------------------------------------------
  // Areas
  // -------------------------------------------------------------------------

  enterNextArea(): void {
    this.depth++
    const entry = enterArea(this.seed, this.depth)
    this.map = entry.map
    this.nav = entry.nav

    this.actors = this.playerActors()
    this.projectiles = []
    this.groundItems = []
    this.orbs = []
    this.respawnAt.clear()

    for (const actor of this.actors) {
      resetPlayerForArea(actor, this.map.spawn)
      this.clearPath(actor)
    }

    if (this.rules.combat) this.spawnPacks(entry.packs)
    this.areaCleared = false
    this.areaStartTime = this.time
    this.events.push({ kind: 'area_entered', depth: this.depth, seed: this.seed })
  }

  private spawnPacks(packs: readonly PackPlan[]): void {
    let count = 0
    for (const pack of packs) {
      for (const member of pack.members) {
        this.actors.push(this.createMonster(member.archetype, member.rarity, member.pos, pack.id))
        count++
      }
    }
    this.areaMonsterCount = count
  }

  // -------------------------------------------------------------------------
  // Actor construction
  // -------------------------------------------------------------------------

  private createPlayerActor(character: Character): Actor {
    const actor: Actor = {
      id: this.nextEntityId++,
      kind: 'player',
      name: character.name,
      level: character.level,
      archetype: null,
      rarity: 'normal',
      packId: 0,
      pos: clone(this.map.spawn),
      radius: PLAYER_RADIUS,
      facing: 0,
      velocity: vec2(),
      life: 1,
      mana: 0,
      mods: [],
      stats: resolveStats(PLAYER_BASE, []),
      state: 'idle',
      targetId: null,
      windup: 0,
      windupTotal: 0,
      recovery: 0,
      recoveryTotal: 0,
      activeSkill: null,
      pendingCast: null,
      cooldowns: {},
      skills: [...PLAYER_SKILLS],
      moveTarget: null,
      moveDirection: null,
      moveDirectionExpiry: 0,
      path: [],
      pathCursor: 0,
      repathAt: 0,
      stuckFor: 0,
      anchor: clone(this.map.spawn),
      aggroed: true,
      dash: null,
      ailments: [],
      lastDamageFrom: null,
      dead: false,
      diedAt: 0,
      hitFlash: 0,
      xpValue: 0,
    }
    actor.mods = characterMods(character)
    actor.stats = resolveStats(
      { ...PLAYER_BASE, attackSpeed: (character.equipment.weapon?.weapon ?? UNARMED).attacksPerSecond },
      actor.mods,
    )
    actor.life = actor.stats.maxLife
    actor.mana = actor.stats.maxMana
    return actor
  }

  private createMonster(archetype: MonsterArchetype, rarity: MonsterRarity, pos: Vec2, packId: number): Actor {
    const def = MONSTERS[archetype]
    const level = this.depth
    const mods: Mod[] = [...monsterDamageMods(def, level, rarity)]
    const scaling = RARITY_SCALING[rarity]
    let name = `${scaling.namePrefix}${def.name}`

    const modifierCount = monsterModifierCount(rarity, this.depth)
    for (let i = 0; i < modifierCount; i++) {
      const modifier = this.rng.pick(MONSTER_MODIFIERS)
      mods.push(...modifier.mods)
      name = `${modifier.name} ${name}`
    }

    const base: BaseStats = monsterBaseStats(def, level, rarity)
    const actor: Actor = {
      id: this.nextEntityId++,
      kind: 'monster',
      name,
      level,
      archetype,
      rarity,
      packId,
      pos: clone(pos),
      radius: def.radius * (rarity === 'rare' ? 1.25 : 1),
      facing: this.rng.float(0, Math.PI * 2),
      velocity: vec2(),
      life: 1,
      mana: 0,
      mods,
      stats: resolveStats(base, mods),
      state: 'idle',
      targetId: null,
      windup: 0,
      windupTotal: 0,
      recovery: 0,
      recoveryTotal: 0,
      activeSkill: null,
      pendingCast: null,
      cooldowns: {},
      skills: [...def.skills],
      moveTarget: null,
      moveDirection: null,
      moveDirectionExpiry: 0,
      path: [],
      pathCursor: 0,
      repathAt: 0,
      stuckFor: 0,
      anchor: clone(pos),
      aggroed: false,
      dash: null,
      ailments: [],
      lastDamageFrom: null,
      dead: false,
      diedAt: 0,
      hitFlash: 0,
      xpValue: monsterXp(def, level, rarity),
    }
    actor.life = actor.stats.maxLife
    return actor
  }

  recomputeStats(actor: Actor): void {
    if (actor.kind !== 'player') {
      actor.stats = resolveStats(monsterBaseStats(MONSTERS[actor.archetype!], actor.level, actor.rarity), actor.mods)
      return
    }
    const character = this.characterOfActor(actor)
    if (!character) return

    actor.mods = characterMods(character)
    const previousMaxMana = actor.stats.maxMana
    // The equipped weapon's rate IS the base attack speed, so weapon choice is a
    // real trade between a fast blade and a slow maul.
    const weapon = character.equipment.weapon?.weapon ?? UNARMED
    actor.stats = resolveStats({ ...PLAYER_BASE, attackSpeed: weapon.attacksPerSecond }, actor.mods)
    actor.life = Math.min(actor.life, actor.stats.maxLife)
    if (actor.stats.maxMana > previousMaxMana) actor.mana += actor.stats.maxMana - previousMaxMana
    actor.mana = Math.min(actor.mana, actor.stats.maxMana)
  }

  characterOfActor(actor: Actor): Character | undefined {
    for (const slot of this.players.values()) {
      if (slot.actorId === actor.id) return slot.character
    }
    return undefined
  }

  // -------------------------------------------------------------------------
  // Snapshots — late join, prediction reconciliation, and save games
  // -------------------------------------------------------------------------

  /**
   * Everything needed to rebuild this instance elsewhere. The map is absent on
   * purpose: it is a pure function of (seed, depth), so it costs a few bytes to
   * describe and is regenerated on arrival.
   */
  snapshot(): InstanceSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      seed: this.seed,
      depth: this.depth,
      zone: this.zone,
      time: this.time,
      tickCount: this.tickCount,
      rngState: this.rng.state,
      nextEntityId: this.nextEntityId,
      nextItemSerial: this.nextItemSerial,
      nextPlayerId: this.nextPlayerId,
      actors: structuredClone(this.actors),
      projectiles: structuredClone(this.projectiles),
      groundItems: structuredClone(this.groundItems),
      orbs: structuredClone(this.orbs),
      players: [...this.players.values()].map((slot) => structuredClone(slot)),
      respawnAt: [...this.respawnAt.entries()],
      monstersKilled: this.monstersKilled,
      areaMonsterCount: this.areaMonsterCount,
      areaStartTime: this.areaStartTime,
      areaCleared: this.areaCleared,
      areasCleared: this.areasCleared,
    }
  }

  static restore(snapshot: InstanceSnapshot): Sim {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(`snapshot version ${snapshot.version}, expected ${SNAPSHOT_VERSION}`)
    }
    const sim = new Sim({ seed: snapshot.seed, depth: snapshot.depth, characters: [], zone: snapshot.zone })
    sim.apply(snapshot)
    return sim
  }

  /** Overwrite this instance with a snapshot, as a client does on reconciliation. */
  apply(snapshot: InstanceSnapshot): void {
    if (snapshot.depth !== this.depth) {
      this.depth = snapshot.depth
      const entry = enterArea(snapshot.seed, snapshot.depth)
      this.map = entry.map
      this.nav = entry.nav
    }
    this.time = snapshot.time
    this.tickCount = snapshot.tickCount
    this.rng.state = snapshot.rngState
    this.nextEntityId = snapshot.nextEntityId
    this.nextItemSerial = snapshot.nextItemSerial
    this.nextPlayerId = snapshot.nextPlayerId
    this.actors = structuredClone(snapshot.actors) as Actor[]
    this.projectiles = structuredClone(snapshot.projectiles) as Projectile[]
    this.groundItems = structuredClone(snapshot.groundItems) as GroundItem[]
    this.orbs = structuredClone(snapshot.orbs) as Orb[]
    this.players.clear()
    for (const slot of snapshot.players) this.players.set(slot.id, structuredClone(slot) as PlayerSlot)
    this.respawnAt.clear()
    for (const [playerId, dueAt] of snapshot.respawnAt) this.respawnAt.set(playerId, dueAt)
    this.monstersKilled = snapshot.monstersKilled
    this.areaMonsterCount = snapshot.areaMonsterCount
    this.areaStartTime = snapshot.areaStartTime
    this.areaCleared = snapshot.areaCleared
    this.areasCleared = snapshot.areasCleared
    this.commands = []
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  actorById(id: EntityId): Actor | undefined {
    return this.actors.find((a) => a.id === id)
  }

  monsters(): Actor[] {
    return this.actors.filter((a) => a.kind === 'monster')
  }

  monstersRemaining(): number {
    let count = 0
    for (const actor of this.actors) if (actor.kind === 'monster' && !actor.dead) count++
    return count
  }

  packIsAggroed(packId: number): boolean {
    for (const actor of this.actors) {
      if (actor.kind === 'monster' && actor.packId === packId && actor.aggroed && !actor.dead) return true
    }
    return false
  }

  hostilesOf(actor: Actor): Actor[] {
    return this.actors.filter((other) => !other.dead && other.kind !== actor.kind)
  }

  /** Nearest live hostile with clear sight, used by AI and by the harness bot. */
  nearestHostile(actor: Actor, maxRange = Infinity): Actor | null {
    let best: Actor | null = null
    let bestDistance = maxRange
    for (const other of this.hostilesOf(actor)) {
      const gap = distance(actor.pos, other.pos)
      if (gap >= bestDistance) continue
      if (!hasLineOfSight(this.map, actor.pos, other.pos)) continue
      best = other
      bestDistance = gap
    }
    return best
  }

  hostilesWithin(pos: Vec2, radius: number, kind: 'player' | 'monster'): Actor[] {
    return this.actors.filter((a) => !a.dead && a.kind === kind && distance(a.pos, pos) <= radius)
  }

  weaponOf(actor: Actor): WeaponBase | null {
    if (actor.kind !== 'player') return null
    return this.characterOfActor(actor)?.equipment.weapon?.weapon ?? UNARMED
  }

  cooldownRemaining(actor: Actor, id: SkillId): number {
    return actor.cooldowns[id] ?? 0
  }

  /** Debug helper: hand the player a specific item, already equipped. */
  grantItem(baseId: string, itemLevel: number, rarity: Item['rarity']): Item {
    const item = rollItem(baseId, itemLevel, rarity, this.rng, this.mint)
    const slot = this.players.get(this.localPlayerId)!
    slot.character.inventory.push(item)
    this.equip(slot, this.player, item.id)
    return item
  }
}
