import type { Vec2 } from './vec2'

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export const TICK_RATE = 60
export const DT = 1 / TICK_RATE

// ---------------------------------------------------------------------------
// Damage model
// ---------------------------------------------------------------------------

export const DAMAGE_TYPES = ['physical', 'fire', 'cold', 'lightning', 'chaos'] as const
export type DamageType = (typeof DAMAGE_TYPES)[number]

export const ELEMENTAL_TYPES = ['fire', 'cold', 'lightning'] as const

/** Resistances are capped like PoE's: overcapping is only insurance against curses. */
export const MAX_RESISTANCE = 0.75
/** Armour cannot mitigate a hit into nothing, no matter how large the number. */
export const MAX_PHYSICAL_REDUCTION = 0.9
/** Higher divisor means armour is worse against big hits — the whole point of it. */
export const ARMOUR_DAMAGE_DIVISOR = 5

export type Tag =
  | 'attack'
  | 'spell'
  | 'melee'
  | 'projectile'
  | 'area'
  | 'movement'
  | DamageType

export type ModKind = 'flat' | 'increased' | 'more'

/**
 * One line of text on an item or passive. `tags` narrows what a damage mod
 * applies to: a mod applies to a hit only when every one of its tags is present
 * on that hit, so `{stat:'damage', tags:['fire','spell']}` is
 * "increased Fire Spell Damage".
 */
export interface Mod {
  stat: StatKey | 'damage'
  kind: ModKind
  value: number
  /** Flat damage mods roll a range; `value` is the low end and this the high. */
  valueMax?: number
  /** Which damage type a flat 'damage' mod adds. */
  damageType?: DamageType
  tags?: readonly Tag[]
  source?: string
}

export type StatKey =
  | 'maxLife'
  | 'maxMana'
  | 'lifeRegen'
  | 'manaRegen'
  | 'armour'
  | 'moveSpeed'
  | 'attackSpeed'
  | 'castSpeed'
  | 'critChance'
  | 'critMulti'
  | 'areaRadius'
  | 'pickupRadius'
  | 'res_physical'
  | 'res_fire'
  | 'res_cold'
  | 'res_lightning'
  | 'res_chaos'

/** Everything the sim reads per tick, resolved from base + mods and cached. */
export interface Stats {
  maxLife: number
  maxMana: number
  lifeRegen: number
  manaRegen: number
  armour: number
  moveSpeed: number
  attackSpeed: number
  castSpeed: number
  critChance: number
  critMulti: number
  areaRadius: number
  pickupRadius: number
  resistances: Record<DamageType, number>
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

export type EntityId = number

export type ActorKind = 'player' | 'monster'

export type MonsterArchetype = 'swarm' | 'ranged' | 'brute'

export type MonsterRarity = 'normal' | 'magic' | 'rare'

export type ActorState = 'idle' | 'moving' | 'acting' | 'dead'

export type AilmentKind = 'chilled' | 'ignited'

export interface Ailment {
  kind: AilmentKind
  /** Chill: fractional slow. Ignite: damage per second. */
  magnitude: number
  expiresAt: number
  sourceId: EntityId
}

export interface Actor {
  id: EntityId
  kind: ActorKind
  name: string
  level: number
  archetype: MonsterArchetype | null
  rarity: MonsterRarity
  packId: number

  pos: Vec2
  radius: number
  facing: number
  /** Last frame's realised movement, for animation and for the kiting AI. */
  velocity: Vec2

  life: number
  mana: number
  mods: Mod[]
  stats: Stats

  state: ActorState
  targetId: EntityId | null
  /** Remaining seconds of the current skill's windup. */
  windup: number
  /** Remaining seconds of post-hit recovery, during which no new skill starts. */
  recovery: number
  activeSkill: SkillId | null
  /** Set while a skill is winding up; resolved when `windup` hits zero. */
  pendingCast: PendingCast | null
  cooldowns: Map<SkillId, number>
  skills: SkillId[]

  moveTarget: Vec2 | null
  path: Vec2[]
  pathCursor: number
  repathAt: number
  /** Seconds of near-zero progress while trying to move; drives the unstuck net. */
  stuckFor: number
  /** Monsters return here when they lose the player. */
  anchor: Vec2
  aggroed: boolean
  /** Set while a dash is in flight; movement ignores the path until it ends. */
  dash: DashState | null

  ailments: Ailment[]
  dead: boolean
  diedAt: number
  /** Seconds of hit-flash left; presentation only, but part of sim state so replays match. */
  hitFlash: number
  xpValue: number
}

export interface DashState {
  direction: Vec2
  distanceLeft: number
  speed: number
}

export interface PendingCast {
  skill: SkillId
  /** Where the skill was aimed when it started — commitment, like an ARPG should have. */
  aim: Vec2
  targetId: EntityId | null
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export type SkillId =
  | 'cleave'
  | 'frost_nova'
  | 'firebolt'
  | 'dash'
  | 'monster_bite'
  | 'monster_bolt'
  | 'monster_slam'

export type SkillShape = 'melee_arc' | 'nova' | 'projectile' | 'dash'

export interface SkillDef {
  id: SkillId
  name: string
  shape: SkillShape
  tags: readonly Tag[]
  manaCost: number
  cooldown: number
  /** Seconds before the hit lands. Scaled by attack or cast speed. */
  windup: number
  /** Seconds locked after the hit. Also scaled. */
  recovery: number
  range: number
  /** Base damage per type, rolled uniformly. Empty for pure utility skills. */
  damage: Partial<Record<DamageType, readonly [number, number]>>
  /** Fraction of weapon damage added as base. 1 for attacks, 0 for spells. */
  weaponScaling: number
  arcDegrees?: number
  radius?: number
  projectileSpeed?: number
  projectileRadius?: number
  pierce?: number
  /** Chance to apply the type's ailment on hit. */
  ailmentChance?: number
  dashSpeed?: number
  /** Telegraph in seconds a monster shows before a big hit, so it can be dodged. */
  telegraph?: number
}

export interface Projectile {
  id: EntityId
  skill: SkillId
  ownerId: EntityId
  hostile: boolean
  pos: Vec2
  velocity: Vec2
  radius: number
  distanceLeft: number
  pierceLeft: number
  hitIds: Set<EntityId>
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const EQUIP_SLOTS = [
  'weapon',
  'helm',
  'body',
  'gloves',
  'boots',
  'amulet',
  'ring1',
  'ring2',
] as const
export type EquipSlot = (typeof EQUIP_SLOTS)[number]

export type ItemRarity = 'normal' | 'magic' | 'rare'

export interface WeaponBase {
  physicalMin: number
  physicalMax: number
  attacksPerSecond: number
}

export interface ItemBaseDef {
  id: string
  name: string
  slot: EquipSlot
  /** Slot-inherent defence or offence before any affix. */
  implicit: readonly Mod[]
  weapon?: WeaponBase
  dropLevel: number
}

export interface Item {
  id: EntityId
  baseId: string
  name: string
  slot: EquipSlot
  rarity: ItemRarity
  itemLevel: number
  implicit: readonly Mod[]
  affixes: RolledAffix[]
  weapon?: WeaponBase
}

export interface RolledAffix {
  id: string
  name: string
  kind: 'prefix' | 'suffix'
  tier: number
  mods: Mod[]
}

export interface GroundItem {
  id: EntityId
  item: Item
  pos: Vec2
  droppedAt: number
}

/** Walk-over life pickup. The only sustain in the loop, so packs stay dangerous. */
export interface Orb {
  id: EntityId
  pos: Vec2
  lifeFraction: number
  droppedAt: number
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export const TILE_SIZE = 1

export type TileKind = 0 | 1 // 0 wall, 1 floor

export interface AreaMap {
  width: number
  height: number
  tiles: Uint8Array
  spawn: Vec2
  portal: Vec2
  rooms: Rect[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// ---------------------------------------------------------------------------
// Player intents — the entire surface a host may drive the sim through
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: 'move'; to: Vec2 }
  | { kind: 'stop' }
  | { kind: 'use_skill'; skill: SkillId; aim: Vec2 }
  | { kind: 'pickup'; itemId: EntityId }
  | { kind: 'equip'; itemId: EntityId }
  | { kind: 'allocate_passive'; nodeId: string }
  | { kind: 'enter_portal' }

// ---------------------------------------------------------------------------
// Events — what happened this tick, drained by renderer, HUD and harness
// ---------------------------------------------------------------------------

export interface HitBreakdown {
  byType: Record<DamageType, number>
  total: number
  crit: boolean
  mitigated: number
}

export type SimEvent =
  | { kind: 'skill_used'; actorId: EntityId; skill: SkillId; aim: Vec2 }
  | { kind: 'hit'; sourceId: EntityId; targetId: EntityId; skill: SkillId; damage: HitBreakdown; pos: Vec2 }
  | { kind: 'ailment_applied'; targetId: EntityId; ailment: AilmentKind }
  | { kind: 'death'; actorId: EntityId; killerId: EntityId | null; pos: Vec2 }
  | { kind: 'item_dropped'; groundItemId: EntityId; rarity: ItemRarity; pos: Vec2 }
  | { kind: 'item_picked_up'; itemId: EntityId; name: string; rarity: ItemRarity }
  | { kind: 'orb_collected'; healed: number; pos: Vec2 }
  | { kind: 'item_equipped'; itemId: EntityId; slot: EquipSlot }
  | { kind: 'xp_gained'; amount: number; total: number }
  | { kind: 'level_up'; level: number; passivePoints: number }
  | { kind: 'passive_allocated'; nodeId: string }
  | { kind: 'player_died'; pos: Vec2 }
  | { kind: 'area_cleared'; monstersKilled: number; seconds: number }
  | { kind: 'area_entered'; depth: number; seed: number }
  | { kind: 'mana_insufficient'; skill: SkillId }
