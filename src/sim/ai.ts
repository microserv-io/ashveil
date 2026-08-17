import { MONSTERS } from './monsters'
import { hasLineOfSight } from './pathfind'
import { skill as skillDef } from './skills'
import type { Sim } from './sim'
import { distance, fromAngle, add, angleOf, sub, type Vec2 } from './vec2'
import type { Actor, SkillId } from './types'

const REPATH_INTERVAL = 0.35
const RETREAT_INTERVAL = 1.1
const PACK_AGGRO_RADIUS = 13

export function updateMonsterAI(sim: Sim, monster: Actor): void {
  const def = MONSTERS[monster.archetype!]
  // Whoever is closest, which is all party aggro amounts to at this scale.
  const player = sim.nearestPlayerTo(monster.pos)

  if (!player || player.dead) {
    monster.aggroed = false
    monster.targetId = null
    return
  }

  const toPlayer = distance(monster.pos, player.pos)

  if (!monster.aggroed) {
    const sees = toPlayer <= def.aggroRadius && hasLineOfSight(sim.map, monster.pos, player.pos)
    const packAlerted = toPlayer <= PACK_AGGRO_RADIUS && sim.packIsAggroed(monster.packId)
    if (!sees && !packAlerted) return
    monster.aggroed = true
  }

  monster.targetId = player.id

  // Leashing keeps a pack fighting in its own room instead of trailing across the level.
  if (distance(monster.pos, monster.anchor) > def.leashRadius) {
    monster.aggroed = false
    monster.targetId = null
    sim.setMoveTarget(monster, monster.anchor)
    return
  }

  if (monster.windup > 0 || monster.recovery > 0) return

  const choice = chooseSkill(sim, monster, player, toPlayer)
  if (choice) {
    sim.beginCast(monster, choice, player.pos)
    return
  }

  const wantsDistance = def.archetype === 'ranged'
  // Step back occasionally rather than fleeing every tick, which turned fights
  // into a walking race the player could never close.
  if (wantsDistance && toPlayer < def.preferredRange * 0.45) {
    if (sim.time >= monster.repathAt) {
      monster.repathAt = sim.time + RETREAT_INTERVAL
      retreat(sim, monster, player.pos)
    }
    return
  }

  const stopAt = wantsDistance ? def.preferredRange * 0.9 : def.preferredRange
  if (toPlayer > stopAt) {
    if (sim.time >= monster.repathAt) {
      monster.repathAt = sim.time + REPATH_INTERVAL + (monster.id % 7) * 0.01
      sim.setMoveTarget(monster, player.pos)
    }
  } else {
    sim.clearPath(monster)
    monster.facing = angleOf(sub(player.pos, monster.pos))
  }
}

function chooseSkill(sim: Sim, monster: Actor, player: Actor, toPlayer: number): SkillId | null {
  for (const id of monster.skills) {
    const def = skillDef(id)
    const cooldown = monster.cooldowns[id] ?? 0
    if (cooldown > 0) continue
    const reach = def.shape === 'nova' ? def.range : def.range
    if (toPlayer > reach) continue
    if (!hasLineOfSight(sim.map, monster.pos, player.pos)) continue
    return id
  }
  return null
}

/** Ranged monsters step back rather than pathfinding away — it reads as flinching. */
function retreat(sim: Sim, monster: Actor, from: Vec2): void {
  const away = angleOf(sub(monster.pos, from))
  const target = add(monster.pos, fromAngle(away, 4))
  sim.setMoveTarget(monster, target)
}
