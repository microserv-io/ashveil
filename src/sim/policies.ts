import { itemScore } from './items'
import { findPath, hasLineOfWalk } from './pathfind'
import { PASSIVES, canAllocate } from './progression'
import { Sim } from './sim'
import { skill as skillDef } from './skills'
import {
  type Actor,
  type EquipSlot,
  type Intent,
  type SkillId,
  type Vec2,
} from './types'
import { distance, sub } from './vec2'

/**
 * Scripted bots. Each exists to ask one question about the game; add a policy for a
 * new question rather than bending an existing one until it answers two.
 */

/**
 * A scripted player. The harness drives the sim through exactly the same intent
 * queue the browser host uses, so anything a bot can reach a human can too.
 */
/** How close a monster gets before the kiter gives ground. */
const KITE_RANGE = 7

export interface BotPolicy {
  name: string
  decide(sim: Sim): Intent[]
}

const CLEAVE_RANGE = skillDef('cleave').range
const NOVA_RADIUS = skillDef('frost_nova').radius ?? 4
const FIREBOLT_RANGE = skillDef('firebolt').range

const DISENGAGE_LIFE = 0.35

/** Preference order the bot spends passive points in. */
const PASSIVE_PRIORITY: readonly string[] = [
  'ward_1',
  'might_1',
  'might_3',
  'ward_2',
  'might_2',
  'ward_3',
  'ember_1',
  'ward_4',
  'might_4',
  'ember_3',
  'ember_2',
  'ember_5',
  'ember_4',
]

/**
 * Plays the intended loop: pull a pack, nova when surrounded, cleave what is in
 * reach, firebolt what is not, loot upgrades, then take the portal down.
 */
export const brawler: BotPolicy = {
  name: 'brawler',
  decide(sim: Sim): Intent[] {
    const intents: Intent[] = []
    const player = sim.player

    intents.push(...spendPassives(sim))
    if (player.dead) return intents

    intents.push(...handleLoot(sim))

    const target = sim.nearestHostile(player, 18)
    if (!target) {
      if (sim.monstersRemaining() === 0) {
        if (distance(player.pos, sim.map.portal) <= 2.4) intents.push({ kind: 'enter_portal' })
        else if (!player.moveTarget) intents.push({ kind: 'move', to: sim.map.portal })
      } else if (!player.moveTarget) {
        const nearest = nearestLiveMonster(sim)
        if (nearest) intents.push({ kind: 'move', to: nearest.pos })
      }
      return intents
    }

    if (player.windup > 0 || player.recovery > 0 || player.dash) return intents

    const gap = distance(player.pos, target.pos)
    const crowd = sim.hostilesWithin(player.pos, NOVA_RADIUS, 'monster').length
    const lifeFraction = player.life / player.stats.maxLife

    // A human walks away from a fight they are losing. Without this the bot
    // face-tanks anything it has targeted and the death count measures nothing.
    if (lifeFraction < DISENGAGE_LIFE && gap < 6) {
      if (canCast(sim, 'dash')) {
        intents.push({ kind: 'use_skill', skill: 'dash', aim: awayFrom(player.pos, target.pos, 6) })
      } else {
        intents.push({ kind: 'move', to: awayFrom(player.pos, target.pos, 7) })
      }
      return intents
    }

    if (crowd >= 2 && canCast(sim, 'frost_nova')) {
      intents.push({ kind: 'use_skill', skill: 'frost_nova', aim: player.pos })
      return intents
    }
    if (gap > 8 && canCast(sim, 'dash')) {
      intents.push({ kind: 'use_skill', skill: 'dash', aim: target.pos })
      return intents
    }
    if (gap <= CLEAVE_RANGE + target.radius) {
      intents.push({ kind: 'use_skill', skill: 'cleave', aim: target.pos })
      return intents
    }
    if (gap <= FIREBOLT_RANGE && canCast(sim, 'firebolt')) {
      intents.push({ kind: 'use_skill', skill: 'firebolt', aim: target.pos })
      return intents
    }
    intents.push({ kind: 'move', to: target.pos })
    return intents
  },
}

/**
 * Plays with a stick rather than a cursor: direct movement plus soft-targeted
 * skills. Keeps the controller path covered by the same sweeps the mouse path is,
 * so a regression there shows up as a number rather than as a bug report.
 */
export const twinstick: BotPolicy = {
  name: 'twinstick',
  decide(sim: Sim): Intent[] {
    const intents: Intent[] = []
    const player = sim.player

    intents.push(...spendPassives(sim))
    if (player.dead) return intents
    intents.push(...handleLoot(sim))

    const target = sim.nearestHostile(player, 18) ?? nearestLiveMonster(sim)
    const destination = target
      ? target.pos
      : sim.monstersRemaining() === 0
        ? sim.map.portal
        : player.pos

    const dx = destination.x - player.pos.x
    const dy = destination.y - player.pos.y
    const gap = Math.hypot(dx, dy)
    const facing = gap > 0.01 ? Math.atan2(dy, dx) : player.facing

    if (!target) {
      if (gap <= 2.4 && sim.monstersRemaining() === 0) intents.push({ kind: 'enter_portal' })
      else intents.push({ kind: 'move_direction', direction: steerToward(sim, destination), facing })
      return intents
    }

    // Close to melee range, then hold position and swing rather than shoving past.
    const wantsGap = CLEAVE_RANGE * 0.75
    const approach = gap > wantsGap ? steerToward(sim, destination) : { x: 0, y: 0 }
    intents.push({ kind: 'move_direction', direction: approach, facing })

    if (player.windup > 0 || player.recovery > 0 || player.dash) return intents

    const crowd = sim.hostilesWithin(player.pos, NOVA_RADIUS, 'monster').length
    const aimStick = { x: Math.cos(facing), y: Math.sin(facing) }

    // Same disengage rule the cursor bot has, so a comparison between the two
    // measures the control scheme rather than the difference in bot smarts.
    if (player.life / player.stats.maxLife < DISENGAGE_LIFE && gap < 6) {
      const away = awayFrom(player.pos, target.pos, 6)
      if (canCast(sim, 'dash')) intents.push({ kind: 'use_skill', skill: 'dash', aim: away })
      else intents.push({ kind: 'move_direction', direction: steerToward(sim, away), facing })
      return intents
    }

    if (crowd >= 2 && canCast(sim, 'frost_nova')) {
      intents.push({ kind: 'use_skill', skill: 'frost_nova', aim: player.pos })
    } else if (gap > 8 && canCast(sim, 'dash')) {
      intents.push({ kind: 'use_skill', skill: 'dash', aim: sim.aimFor(player, 'dash', aimStick).aim })
    } else if (gap <= CLEAVE_RANGE + target.radius) {
      intents.push({ kind: 'use_skill', skill: 'cleave', aim: sim.aimFor(player, 'cleave', null).aim })
    } else if (gap <= FIREBOLT_RANGE && canCast(sim, 'firebolt')) {
      intents.push({ kind: 'use_skill', skill: 'firebolt', aim: sim.aimFor(player, 'firebolt', aimStick).aim })
    }

    return intents
  },
}

function unit(dx: number, dy: number, length: number): { x: number; y: number } {
  return length < 1e-6 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length }
}

interface TravelState {
  path: Vec2[]
  cursor: number
  computedAt: number
  destination: Vec2
}

const travelStates = new WeakMap<Sim, TravelState>()
const REPLAN_INTERVAL = 0.6
const WAYPOINT_REACHED = 0.6

/**
 * A stick has no pathfinder behind it, so walking at a destination in a straight
 * line just grinds into the nearest wall. A player solves this by eye — steering
 * along the corridor they can see. The bot solves it by steering along a path,
 * and only falls back to a straight line when the destination is already in view.
 */
function steerToward(sim: Sim, destination: Vec2): Vec2 {
  const player = sim.player
  const direct = sub(destination, player.pos)
  const gap = Math.hypot(direct.x, direct.y)
  if (gap < 1e-6) return { x: 0, y: 0 }
  // Sight is not the test — a body has width. A gap a bolt flies through is one
  // a shoulder wedges in, which is how the straight-line shortcut wedged the bot.
  if (hasLineOfWalk(sim.nav, player.pos, destination, player.radius)) return unit(direct.x, direct.y, gap)

  let state = travelStates.get(sim)
  const stale =
    !state ||
    sim.time - state.computedAt > REPLAN_INTERVAL ||
    state.cursor >= state.path.length ||
    distance(state.destination, destination) > 2.5

  if (stale) {
    const path = findPath(sim.nav, player.pos, destination, player.radius)
    if (!path || path.length === 0) return unit(direct.x, direct.y, gap)
    state = { path, cursor: 0, computedAt: sim.time, destination: { ...destination } }
    travelStates.set(sim, state)
  }

  const travel = state!
  while (travel.cursor < travel.path.length && distance(player.pos, travel.path[travel.cursor]!) <= WAYPOINT_REACHED) {
    travel.cursor++
  }
  const waypoint = travel.path[travel.cursor]
  if (!waypoint) return unit(direct.x, direct.y, gap)

  const toWaypoint = sub(waypoint, player.pos)
  return unit(toWaypoint.x, toWaypoint.y, Math.hypot(toWaypoint.x, toWaypoint.y))
}

/** Never attacks. Use it to measure what a pack does to a standing target. */
export const punchingBag: BotPolicy = {
  name: 'punching-bag',
  decide(): Intent[] {
    return []
  },
}

/** Runs the level without fighting: measures whether packs can be outrun. */
export const runner: BotPolicy = {
  name: 'runner',
  decide(sim: Sim): Intent[] {
    if (sim.player.dead) return []
    if (distance(sim.player.pos, sim.map.portal) <= 2.4) return [{ kind: 'enter_portal' }]
    if (!sim.player.moveTarget) return [{ kind: 'move', to: sim.map.portal }]
    return []
  },
}

/**
 * Backs away while it shoots. Exists to ask one question the other policies cannot:
 * if a skill lets you move mid-cast, can a player simply walk backwards forever?
 * Every other policy stops issuing move intents while acting, so none of them can
 * answer it, and a rooted build makes this bot strictly worse than `brawler`.
 */
export const kiter: BotPolicy = {
  name: 'kiter',
  decide(sim: Sim): Intent[] {
    const intents: Intent[] = []
    const player = sim.player
    intents.push(...spendPassives(sim))
    if (player.dead) return intents
    intents.push(...handleLoot(sim))

    const target = sim.nearestHostile(player, 18)
    if (!target) {
      if (sim.monstersRemaining() === 0 && distance(player.pos, sim.map.portal) <= 2.4) {
        intents.push({ kind: 'enter_portal' })
      } else {
        const destination = sim.monstersRemaining() === 0 ? sim.map.portal : (nearestLiveMonster(sim)?.pos ?? sim.map.portal)
        if (!player.moveTarget) intents.push({ kind: 'move', to: destination })
      }
      return intents
    }

    // Retreat every tick it is too close, whether or not it is mid-cast. That is the
    // whole experiment: a rooted skill simply ignores this and the bot stands still.
    const gap = distance(player.pos, target.pos)
    if (gap < KITE_RANGE) intents.push({ kind: 'move_direction', direction: awayFrom(player.pos, target.pos, 1) })

    if (!player.windup && !player.recovery && canCast(sim, 'firebolt')) {
      intents.push({ kind: 'use_skill', skill: 'firebolt', aim: { x: target.pos.x, y: target.pos.y } })
    }
    return intents
  },
}

export const POLICIES: Record<string, BotPolicy> = {
  brawler,
  twinstick,
  'punching-bag': punchingBag,
  runner,
  kiter,
}

function awayFrom(pos: Vec2, threat: Vec2, magnitude: number): Vec2 {
  const dx = pos.x - threat.x
  const dy = pos.y - threat.y
  const length = Math.hypot(dx, dy) || 1
  return { x: pos.x + (dx / length) * magnitude, y: pos.y + (dy / length) * magnitude }
}

function canCast(sim: Sim, id: SkillId): boolean {
  const def = skillDef(id)
  if (sim.cooldownRemaining(sim.player, id) > 0) return false
  return sim.player.mana >= def.manaCost
}

function nearestLiveMonster(sim: Sim): Actor | null {
  let best: Actor | null = null
  let bestGap = Infinity
  for (const monster of sim.monsters()) {
    if (monster.dead) continue
    const gap = distance(sim.player.pos, monster.pos)
    if (gap < bestGap) {
      best = monster
      bestGap = gap
    }
  }
  return best
}

function spendPassives(sim: Sim): Intent[] {
  if (sim.progress.passivePoints <= 0) return []
  for (const nodeId of PASSIVE_PRIORITY) {
    if (canAllocate(nodeId, new Set(sim.progress.allocated), sim.progress.passivePoints)) {
      return [{ kind: 'allocate_passive', nodeId }]
    }
  }
  for (const node of PASSIVES) {
    if (canAllocate(node.id, new Set(sim.progress.allocated), sim.progress.passivePoints)) {
      return [{ kind: 'allocate_passive', nodeId: node.id }]
    }
  }
  return []
}

function handleLoot(sim: Sim): Intent[] {
  const intents: Intent[] = []
  const player = sim.player

  for (const ground of sim.groundItems) {
    if (distance(ground.pos, player.pos) > 2.5) continue
    if (ground.item.rarity === 'normal' && itemScore(ground.item) < currentScore(sim, ground.item.slot)) continue
    intents.push({ kind: 'pickup', itemId: ground.id })
  }

  for (const item of sim.progress.inventory) {
    if (itemScore(item) > currentScore(sim, item.slot) * 1.02) {
      intents.push({ kind: 'equip', itemId: item.id })
      break
    }
  }
  return intents
}

function currentScore(sim: Sim, slot: EquipSlot): number {
  const equipped = sim.progress.equipment[slot]
  return equipped ? itemScore(equipped) : 0
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
