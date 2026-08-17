import { updateMonsterAI } from './ai'
import { computeHit } from './damage'
import { itemMods, rollItem } from './items'
import { rollDrops, startingGear } from './loot'
import { generateArea, isWalkable, type PackPlan } from './mapgen'
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
import { canAllocate, levelForXp, levelMods, passive, xpPenalty } from './progression'
import { Rng } from './rng'
import { PLAYER_BASE, resolveStats, type BaseStats } from './stats'
import { PLAYER_SKILLS, skill as skillDef, speedMultiplier } from './skills'
import { aimPoint, assistCone, softTarget } from './targeting'
import {
  DT,
  type Actor,
  type AilmentKind,
  type AreaMap,
  type DamageType,
  type EntityId,
  type EquipSlot,
  type GroundItem,
  type Intent,
  type Item,
  type Mod,
  type MonsterArchetype,
  type MonsterRarity,
  type Orb,
  type Projectile,
  type SimEvent,
  type SkillDef,
  type SkillId,
  type WeaponBase,
} from './types'
import { add, angleOf, clone, distance, fromAngle, normalize, scale, sub, vec2, withinArc, type Vec2 } from './vec2'

export interface SimOptions {
  seed: number
  depth?: number
}

export interface PlayerProgress {
  xp: number
  level: number
  passivePoints: number
  allocated: Set<string>
  equipment: Map<EquipSlot, Item>
  inventory: Item[]
}

const UNARMED: WeaponBase = { physicalMin: 2, physicalMax: 5, attacksPerSecond: 1.2 }
const PLAYER_RADIUS = 0.44
const ITEM_PICKUP_RANGE = 2.6
const PORTAL_RANGE = 2.5
const RESPAWN_DELAY = 1.6
const ORB_LIFE_FRACTION = 0.22
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

  player: Actor
  progress: PlayerProgress

  monstersKilled = 0
  areaMonsterCount = 0
  areaStartTime = 0
  areaCleared = false
  areasCleared = 0

  private intents: Intent[] = []
  private nextEntityId = 1
  private respawnAt = 0

  constructor(options: SimOptions) {
    this.seed = options.seed
    this.rng = new Rng(options.seed)
    this.depth = options.depth ?? 1

    this.progress = {
      xp: 0,
      level: 1,
      passivePoints: 0,
      allocated: new Set(['root']),
      equipment: new Map(),
      inventory: [],
    }
    for (const item of startingGear(this.rng)) this.progress.equipment.set(item.slot, item)

    const generated = generateArea(this.rng, this.depth)
    this.map = generated.map
    this.nav = new NavGrid(this.map)
    this.player = this.createPlayer()
    this.actors.push(this.player)
    this.spawnPacks(generated.packs)
    this.areaStartTime = 0
    this.events.push({ kind: 'area_entered', depth: this.depth, seed: this.seed })
  }

  // -------------------------------------------------------------------------
  // Host surface
  // -------------------------------------------------------------------------

  queue(intent: Intent): void {
    this.intents.push(intent)
  }

  tick(): void {
    this.events = []
    this.time += DT
    this.tickCount++

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
    const queued = this.intents
    this.intents = []
    for (const intent of queued) {
      if (this.player.dead && intent.kind !== 'allocate_passive') continue
      switch (intent.kind) {
        case 'move':
          this.player.moveDirection = null
          this.setMoveTarget(this.player, intent.to)
          break
        case 'move_direction':
          this.applyDirectMove(intent.direction, intent.facing)
          break
        case 'stop':
          this.player.moveDirection = null
          this.clearPath(this.player)
          break
        case 'use_skill':
          this.beginCast(this.player, intent.skill, intent.aim)
          break
        case 'pickup':
          this.pickUp(intent.itemId)
          break
        case 'equip':
          this.equip(intent.itemId)
          break
        case 'allocate_passive':
          this.allocatePassive(intent.nodeId)
          break
        case 'enter_portal':
          if (distance(this.player.pos, this.map.portal) <= PORTAL_RANGE) this.enterNextArea()
          break
      }
    }
  }

  private advanceTimers(): void {
    for (const actor of this.actors) {
      if (actor.hitFlash > 0) actor.hitFlash = Math.max(0, actor.hitFlash - DT)
      for (const [id, remaining] of actor.cooldowns) {
        const next = remaining - DT
        if (next <= 0) actor.cooldowns.delete(id)
        else actor.cooldowns.set(id, next)
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
        if (actor.dead || projectile.hitIds.has(actor.id)) continue
        const isHostile = projectile.hostile ? actor.kind === 'player' : actor.kind === 'monster'
        if (!isHostile) continue
        if (distance(actor.pos, projectile.pos) > actor.radius + projectile.radius) continue

        projectile.hitIds.add(actor.id)
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
      if (actor.windup > 0 || actor.recovery > 0) {
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
    if (this.player.dead) return
    const remaining: Orb[] = []
    for (const orb of this.orbs) {
      if (distance(orb.pos, this.player.pos) <= this.player.stats.pickupRadius + this.player.radius) {
        const healed = Math.min(this.player.stats.maxLife - this.player.life, this.player.stats.maxLife * orb.lifeFraction)
        this.player.life += healed
        this.events.push({ kind: 'orb_collected', healed, pos: clone(orb.pos) })
      } else {
        remaining.push(orb)
      }
    }
    this.orbs = remaining
  }

  private updateRespawn(): void {
    if (!this.player.dead || this.time < this.respawnAt) return
    this.player.dead = false
    this.player.state = 'idle'
    this.player.pos = clone(this.map.spawn)
    this.player.life = this.player.stats.maxLife
    this.player.mana = this.player.stats.maxMana
    this.player.ailments = []
    this.player.windup = 0
    this.player.recovery = 0
    this.player.pendingCast = null
    this.player.dash = null
    this.clearPath(this.player)
    for (const actor of this.actors) {
      if (actor.kind !== 'monster') continue
      actor.aggroed = false
      actor.targetId = null
      this.clearPath(actor)
    }
  }

  private updateAreaState(): void {
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
    if ((actor.cooldowns.get(id) ?? 0) > 0) return false
    if (def.manaCost > 0 && actor.mana < def.manaCost) {
      if (actor.kind === 'player') this.events.push({ kind: 'mana_insufficient', skill: id })
      return false
    }

    actor.mana -= def.manaCost
    const speed = speedMultiplier(def, actor.stats.attackSpeed, actor.stats.castSpeed)
    actor.windup = def.windup / speed
    actor.activeSkill = id
    actor.pendingCast = { skill: id, aim: clone(aim), targetId: actor.targetId }
    actor.state = 'acting'
    if (def.cooldown > 0) actor.cooldowns.set(id, def.cooldown)
    if (distance(aim, actor.pos) > 0.05) actor.facing = angleOf(sub(aim, actor.pos))
    this.clearPath(actor)
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
      hitIds: new Set(),
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
    target.hitFlash = 0.12
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

  private applyDirectMove(direction: Vec2, facing: number | undefined): void {
    const player = this.player
    const magnitude = Math.hypot(direction.x, direction.y)
    if (magnitude < 1e-3) {
      player.moveDirection = null
      if (player.state === 'moving') player.state = 'idle'
      if (facing !== undefined) player.facing = facing
      return
    }
    // Direct input wins over a queued click destination rather than fighting it.
    if (player.path.length > 0) this.clearPath(player)
    player.moveDirection = { x: direction.x, y: direction.y }
    player.moveDirectionExpiry = this.time + DIRECT_MOVE_GRACE
    if (facing !== undefined) player.facing = facing
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
    actor.state = 'moving'
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
    if (direction.x !== 0 || direction.y !== 0) actor.facing = angleOf(direction)
    actor.state = 'moving'

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
    let speed = actor.stats.moveSpeed
    for (const ailment of actor.ailments) {
      if (ailment.kind === 'chilled') speed *= 1 - ailment.magnitude
    }
    return speed
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
    this.events.push({ kind: 'death', actorId: actor.id, killerId: this.player.id, pos: clone(actor.pos) })

    if (actor.kind === 'player') {
      this.respawnAt = this.time + RESPAWN_DELAY
      this.events.push({ kind: 'player_died', pos: clone(actor.pos) })
      return
    }

    this.monstersKilled++
    const drops = rollDrops(actor.rarity, actor.level, this.rng)
    for (const item of drops.items) {
      const groundItem: GroundItem = {
        id: this.nextEntityId++,
        item,
        pos: this.scatter(actor.pos, 1.1),
        droppedAt: this.time,
      }
      this.groundItems.push(groundItem)
      this.events.push({ kind: 'item_dropped', groundItemId: groundItem.id, rarity: item.rarity, pos: clone(groundItem.pos) })
    }
    for (let i = 0; i < drops.orbs; i++) {
      this.orbs.push({
        id: this.nextEntityId++,
        pos: this.scatter(actor.pos, 0.8),
        lifeFraction: ORB_LIFE_FRACTION,
        droppedAt: this.time,
      })
    }
    this.grantXp(actor.xpValue, actor.level)
  }

  private grantXp(amount: number, monsterLevel: number): void {
    const gained = Math.max(1, Math.round(amount * xpPenalty(this.progress.level, monsterLevel)))
    this.progress.xp += gained
    this.events.push({ kind: 'xp_gained', amount: gained, total: this.progress.xp })

    const level = levelForXp(this.progress.xp)
    while (this.progress.level < level) {
      this.progress.level++
      this.progress.passivePoints++
      this.player.level = this.progress.level
      const lifeBefore = this.player.stats.maxLife
      this.recomputeStats(this.player)
      this.player.life += this.player.stats.maxLife - lifeBefore
      this.events.push({ kind: 'level_up', level: this.progress.level, passivePoints: this.progress.passivePoints })
    }
  }

  private pickUp(groundItemId: EntityId): void {
    const index = this.groundItems.findIndex((g) => g.id === groundItemId)
    if (index === -1) return
    const ground = this.groundItems[index]!
    if (distance(ground.pos, this.player.pos) > ITEM_PICKUP_RANGE) return
    this.groundItems.splice(index, 1)
    this.progress.inventory.push(ground.item)
    this.events.push({
      kind: 'item_picked_up',
      itemId: ground.item.id,
      name: ground.item.name,
      rarity: ground.item.rarity,
    })
  }

  private equip(itemId: EntityId): void {
    const index = this.progress.inventory.findIndex((i) => i.id === itemId)
    if (index === -1) return
    const item = this.progress.inventory[index]!
    const slot = this.resolveSlot(item.slot)
    this.progress.inventory.splice(index, 1)
    const previous = this.progress.equipment.get(slot)
    if (previous) this.progress.inventory.push(previous)
    this.progress.equipment.set(slot, item)
    this.recomputeStats(this.player)
    this.events.push({ kind: 'item_equipped', itemId: item.id, slot })
  }

  private resolveSlot(slot: EquipSlot): EquipSlot {
    if (slot !== 'ring1') return slot
    return this.progress.equipment.has('ring1') && !this.progress.equipment.has('ring2') ? 'ring2' : 'ring1'
  }

  private allocatePassive(nodeId: string): void {
    if (!canAllocate(nodeId, this.progress.allocated, this.progress.passivePoints)) return
    this.progress.allocated.add(nodeId)
    this.progress.passivePoints--
    const lifeBefore = this.player.stats.maxLife
    this.recomputeStats(this.player)
    this.player.life += Math.max(0, this.player.stats.maxLife - lifeBefore)
    this.events.push({ kind: 'passive_allocated', nodeId })
  }

  // -------------------------------------------------------------------------
  // Areas
  // -------------------------------------------------------------------------

  enterNextArea(): void {
    this.depth++
    const generated = generateArea(this.rng, this.depth)
    this.map = generated.map
    this.nav = new NavGrid(this.map)

    this.actors = [this.player]
    this.projectiles = []
    this.groundItems = []
    this.orbs = []

    this.player.pos = clone(this.map.spawn)
    this.player.anchor = clone(this.map.spawn)
    this.player.life = this.player.stats.maxLife
    this.player.mana = this.player.stats.maxMana
    this.player.ailments = []
    this.player.windup = 0
    this.player.recovery = 0
    this.player.pendingCast = null
    this.player.dash = null
    this.player.cooldowns.clear()
    this.clearPath(this.player)

    this.spawnPacks(generated.packs)
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

  private createPlayer(): Actor {
    const actor: Actor = {
      id: this.nextEntityId++,
      kind: 'player',
      name: 'Ashbearer',
      level: this.progress.level,
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
      recovery: 0,
      activeSkill: null,
      pendingCast: null,
      cooldowns: new Map(),
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
      dead: false,
      diedAt: 0,
      hitFlash: 0,
      xpValue: 0,
    }
    this.recomputeStats(actor)
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
      recovery: 0,
      activeSkill: null,
      pendingCast: null,
      cooldowns: new Map(),
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
    actor.mods = this.playerMods()
    const previousMaxMana = actor.stats.maxMana
    // The equipped weapon's rate IS the base attack speed, so weapon choice is a
    // real trade between a fast blade and a slow maul.
    const weapon = this.weaponOf(actor) ?? UNARMED
    actor.stats = resolveStats({ ...PLAYER_BASE, attackSpeed: weapon.attacksPerSecond }, actor.mods)
    actor.life = Math.min(actor.life, actor.stats.maxLife)
    if (actor.stats.maxMana > previousMaxMana) actor.mana += actor.stats.maxMana - previousMaxMana
    actor.mana = Math.min(actor.mana, actor.stats.maxMana)
  }

  private playerMods(): Mod[] {
    const mods: Mod[] = [...levelMods(this.progress.level)]
    for (const nodeId of this.progress.allocated) mods.push(...passive(nodeId).mods)
    for (const item of this.progress.equipment.values()) mods.push(...itemMods(item))
    return mods
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
    return this.progress.equipment.get('weapon')?.weapon ?? UNARMED
  }

  cooldownRemaining(actor: Actor, id: SkillId): number {
    return actor.cooldowns.get(id) ?? 0
  }

  private scatter(origin: Vec2, spread: number): Vec2 {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = add(origin, fromAngle(this.rng.float(0, Math.PI * 2), this.rng.float(0.2, spread)))
      if (isWalkable(this.map, candidate, 0.3)) return candidate
    }
    return clone(origin)
  }

  /** Debug helper: hand the player a specific item, already equipped. */
  grantItem(baseId: string, itemLevel: number, rarity: Item['rarity']): Item {
    const item = rollItem(baseId, itemLevel, rarity, this.rng)
    this.progress.inventory.push(item)
    this.equip(item.id)
    return item
  }
}
