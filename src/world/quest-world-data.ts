import type { CharacterQuestState, QuestDefinition, QuestJournalEntry, QuestTargetId } from '../quests'
import type { WorldQuestTarget } from './quest-host'

export interface WorldQuestNpcPlacement extends WorldQuestTarget {
  readonly name: string
  readonly facing: number
  readonly castsShadow: boolean
}

const npc = (id: string, label: string, x: number, z: number, castsShadow = false): WorldQuestNpcPlacement => ({
  id, label, name: label, x, z, facing: Math.PI, castsShadow, interactionRadius: 3.2, kind: 'npc',
})
const patient = (id: string, label: string, x: number, z: number): WorldQuestNpcPlacement => ({
  id, label, name: label, x, z, facing: Math.PI * 0.75, castsShadow: false, interactionRadius: 2.7, kind: 'patient',
})
const prop = (id: string, label: string, x: number, z: number): WorldQuestTarget => ({
  id, label, x, z, interactionRadius: 2.35, kind: 'prop',
})

export const QUEST_NPCS: readonly WorldQuestNpcPlacement[] = [
  npc('npc_mara', 'Mara', -41, 22, true),
  npc('npc_iven', 'Iven', -38, 22, true),
  npc('npc_edda', 'Edda', -44, 28, true),
  npc('npc_tavi', 'Tavi', -44, 25),
  npc('npc_seli', 'Seli', -35, 13),
  npc('npc_ferryman', 'Ferryman', -38, 10),
  patient('npc_family', 'Family by the supply awning', -44, 31),
  patient('survivor_willow', 'Willow survivor', -47, 13),
  patient('survivor_ferry_post', 'Ferry-post survivor', -44, 10),
  patient('survivor_driftwood', 'Dazed survivor', -41, 10),
  patient('patient_wrap_1', 'Wounded traveler', -35, 22),
  patient('patient_wrap_2', 'Wounded traveler', -35, 25),
  patient('patient_wrap_3', 'Wounded traveler', -35, 28),
  patient('meal_recipient_1', 'Resting traveler', -38, 28),
  patient('meal_recipient_2', 'Resting traveler', -38, 31),
] as const

export const QUEST_TARGETS: readonly WorldQuestTarget[] = [
  ...QUEST_NPCS,
  prop('rescue_ties', 'Blue rescue ties', -43, 21),
  prop('willow_branch_1', 'Fallen willow branch', -50, 16),
  prop('willow_branch_2', 'Tangled willow branch', -47, 16),
  prop('rescue_line_footing', 'Marked rescue footing', -45, 11),
  prop('satchel_reeds_1', 'Downriver reeds', -38, 13),
  prop('satchel_reeds_2', 'Downriver reeds', -35, 10),
  prop('satchel_reeds_3', 'Downriver reeds', -35, 13),
  prop('water_pump', 'Alderbank hand pump', -35, 31),
  prop('scuffed_plank', 'Scuffed landing plank', -44, 13),
  prop('reed_flash_1', 'Small flash in the reeds', -41, 13),
  prop('reed_flash_2', 'Dull flash in the reeds', -38, 13),
  prop('reed_flash_3', 'Bent reed', -35, 13),
  prop('tin_thrush', 'Tin thrush', -35, 13),
  prop('damp_bedding_1', 'Damp bedding roll', -50, 19),
  prop('damp_bedding_2', 'Damp bedding roll', -47, 19),
  prop('damp_bedding_3', 'Damp bedding roll', -44, 19),
  prop('drying_line_1', 'Marked drying line', -47, 10),
  prop('drying_line_2', 'Marked drying line', -44, 10),
  prop('drying_line_3', 'Marked drying line', -41, 10),
  prop('blue_cloth_roll_1', 'Blue-cord cloth roll', -50, 13),
  prop('blue_cloth_roll_2', 'Blue-cord cloth roll', -47, 13),
  prop('covered_water_barrel', 'Covered water barrel', -44, 28),
  prop('root_cutter_1', 'Hand root cutter', -41, 28),
  prop('root_cutter_2', 'Hand root cutter', -41, 28),
  prop('root_cutter_3', 'Hand root cutter', -41, 28),
  prop('root_cutter_4', 'Hand root cutter', -41, 28),
  prop('warm_cup', 'Warm cup', -37, 21),
  prop('seli_continue', 'Keep Seli company', -35, 13),
  prop('family_name_1', 'Ask the family about Yara', -44, 31),
  prop('family_name_2', 'Confirm the family’s second name', -44, 31),
  prop('notice_board_title', 'Waiting Wood notice board', -42, 23),
  prop('notice_board_hooks', 'Low notice-board hooks', -42, 23),
] as const

const TARGETS_BY_ID = new Map(QUEST_TARGETS.map((target) => [target.id, target]))

export function questTarget(id: QuestTargetId): WorldQuestTarget | undefined { return TARGETS_BY_ID.get(id) }

export function destinationForEntry(
  entry: QuestJournalEntry,
  definition: QuestDefinition,
  state: CharacterQuestState,
): WorldQuestTarget | undefined {
  if (entry.status === 'available') return questTarget(definition.giverId)
  if (entry.status === 'ready') return questTarget(definition.turnInId)
  const objective = entry.nextObjective
  if (!objective) return undefined
  const visited = new Set(state.accepted[entry.id]?.objectiveTargets[objective.id] ?? [])
  return objective.targetIds.map(questTarget).find((target) => target && !visited.has(target.id))
}
