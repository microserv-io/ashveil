import { itemMods } from './items'
import { levelForXp, levelMods, passive, canAllocate } from './progression'
import { EQUIP_SLOTS, type EntityId, type EquipSlot, type Item, type Mod } from './types'

export type CharacterId = string

/**
 * What survives an area. Level, gear and passives belong to the account, not to the
 * instance the character happens to be standing in, so this is also the save game
 * and the unit a session hands to an instance on join.
 *
 * Every field is plain JSON — no Map, no Set. Replicated and persisted state has to
 * survive a round trip through the wire and the disk.
 */
export interface Character {
  id: CharacterId
  name: string
  xp: number
  level: number
  passivePoints: number
  allocated: string[]
  equipment: Partial<Record<EquipSlot, Item>>
  inventory: Item[]
}

export function createCharacter(id: CharacterId, name: string, startingGear: readonly Item[] = []): Character {
  const character: Character = {
    id,
    name,
    xp: 0,
    level: 1,
    passivePoints: 0,
    allocated: ['root'],
    equipment: {},
    inventory: [],
  }
  for (const item of startingGear) character.equipment[item.slot] = item
  return character
}

/** Everything the character contributes to their actor's stats. */
export function characterMods(character: Character): Mod[] {
  const mods: Mod[] = [...levelMods(character.level)]
  for (const nodeId of character.allocated) mods.push(...passive(nodeId).mods)
  for (const slot of EQUIP_SLOTS) {
    const item = character.equipment[slot]
    if (item) mods.push(...itemMods(item))
  }
  return mods
}

export function equippedWeapon(character: Character): Item | undefined {
  return character.equipment.weapon
}

export function hasAllocated(character: Character, nodeId: string): boolean {
  return character.allocated.includes(nodeId)
}

export function allocatePassive(character: Character, nodeId: string): boolean {
  if (!canAllocate(nodeId, new Set(character.allocated), character.passivePoints)) return false
  character.allocated.push(nodeId)
  character.passivePoints--
  return true
}

export interface EquipResult {
  slot: EquipSlot
  replaced: Item | undefined
}

export function equipFromInventory(character: Character, itemId: EntityId): EquipResult | null {
  const index = character.inventory.findIndex((item) => item.id === itemId)
  if (index === -1) return null
  const item = character.inventory[index]!
  const slot = resolveSlot(character, item.slot)
  character.inventory.splice(index, 1)
  const replaced = character.equipment[slot]
  if (replaced) character.inventory.push(replaced)
  character.equipment[slot] = item
  return { slot, replaced }
}

/** A second ring goes on the other hand rather than replacing the first. */
function resolveSlot(character: Character, slot: EquipSlot): EquipSlot {
  if (slot !== 'ring1') return slot
  return character.equipment.ring1 && !character.equipment.ring2 ? 'ring2' : 'ring1'
}

/** Returns the levels gained, so the caller can announce each one. */
export function grantExperience(character: Character, amount: number): number {
  character.xp += amount
  const target = levelForXp(character.xp)
  let gained = 0
  while (character.level < target) {
    character.level++
    character.passivePoints++
    gained++
  }
  return gained
}

export function cloneCharacter(character: Character): Character {
  return structuredClone(character)
}
