import type { CharacterQuestState, QuestDefinition, QuestJournalEntry, QuestTargetId } from '../quests'
import { getActiveZone } from './zone-active'
import { resolveQuestStaging, type QuestStagingContext, type QuestStagingDefinition } from './quest-staging'
import type { WorldQuestTarget } from './quest-host'

export interface WorldQuestNpcPlacement extends WorldQuestTarget {
  readonly name: string
  readonly facing: number
  readonly castsShadow: boolean
}

const zone = getActiveZone()
const staging = (
  id: string, landmarkId: QuestStagingDefinition['landmarkId'], context: QuestStagingContext, x: number, z: number,
): QuestStagingDefinition => ({ id, landmarkId, context, offset: { x, z } })

export const QUEST_STAGING: readonly QuestStagingDefinition[] = [
  staging('npc_mara', 'safe-landing', 'landing-camp', 81, 0),
  staging('npc_tavi', 'safe-landing', 'landing-camp', 77, 4),
  staging('rescue_ties', 'safe-landing', 'landing-camp', 81, -4),
  staging('scuffed_plank', 'safe-landing', 'landing-camp', 88, -4),
  staging('willow_branch_1', 'safe-landing', 'living-bank', 83, 18),
  staging('willow_branch_2', 'safe-landing', 'living-bank', 84, 15),
  staging('survivor_willow', 'safe-landing', 'living-bank', 81, 12),
  staging('rescue_line_footing', 'safe-landing', 'living-bank', 88, 3),
  staging('survivor_ferry_post', 'safe-landing', 'living-bank', 89, -2),
  staging('npc_seli', 'safe-landing', 'living-bank', 79, -3),
  staging('seli_continue', 'safe-landing', 'living-bank', 79, -3),
  staging('npc_ferryman', 'safe-landing', 'living-bank', 80, 4),
  staging('survivor_driftwood', 'safe-landing', 'living-bank', 84, -24),
  staging('satchel_reeds_1', 'safe-landing', 'living-bank', 83, -10),
  staging('satchel_reeds_2', 'safe-landing', 'living-bank', 86, -16),
  staging('satchel_reeds_3', 'safe-landing', 'living-bank', 82, -22),
  staging('reed_flash_1', 'safe-landing', 'living-bank', 77, -10),
  staging('reed_flash_2', 'safe-landing', 'living-bank', 77, -16),
  staging('reed_flash_3', 'safe-landing', 'living-bank', 75, -22),
  staging('tin_thrush', 'safe-landing', 'living-bank', 77, -28),

  staging('npc_iven', 'refuge', 'refuge-awning', -3, -6),
  staging('warm_cup', 'refuge', 'refuge-awning', -1, -5),
  staging('patient_wrap_1', 'refuge', 'refuge-awning', -7, -7),
  staging('patient_wrap_2', 'refuge', 'refuge-awning', -7, -11),
  staging('patient_wrap_3', 'refuge', 'refuge-awning', -3, -11),
  staging('meal_recipient_1', 'refuge', 'refuge-awning', -11, -10),
  staging('meal_recipient_2', 'refuge', 'refuge-awning', -14, -12),
  staging('npc_family', 'refuge', 'refuge-awning', -19, -7),
  staging('family_name_1', 'refuge', 'refuge-awning', -18, -6),
  staging('family_name_2', 'refuge', 'refuge-awning', -20, -8),
  staging('blue_cloth_roll_1', 'refuge', 'refuge-awning', -1, -8),
  staging('blue_cloth_roll_2', 'refuge', 'refuge-awning', 1, -6),

  staging('damp_bedding_1', 'refuge', 'refuge-drying-yard', -20, -16),
  staging('damp_bedding_2', 'refuge', 'refuge-drying-yard', -16, -18),
  staging('damp_bedding_3', 'refuge', 'refuge-drying-yard', -12, -19),
  staging('drying_line_1', 'refuge', 'refuge-drying-yard', -7, -20),
  staging('drying_line_2', 'refuge', 'refuge-drying-yard', -2, -20),
  staging('drying_line_3', 'refuge', 'refuge-drying-yard', 3, -19),

  staging('npc_edda', 'refuge', 'refuge-cookfire', 0, 1),
  staging('covered_water_barrel', 'refuge', 'refuge-cookfire', -3, 5),
  staging('root_cutter_1', 'refuge', 'refuge-cookfire', 3, 0),
  staging('root_cutter_2', 'refuge', 'refuge-cookfire', 4, 0),
  staging('root_cutter_3', 'refuge', 'refuge-cookfire', 3, -1),
  staging('root_cutter_4', 'refuge', 'refuge-cookfire', 4, -1),

  staging('water_pump', 'refuge', 'refuge-commons', -7, 11),
  staging('notice_board_title', 'refuge', 'refuge-commons', -20, 10),
  staging('notice_board_hooks', 'refuge', 'refuge-commons', -20, 10),
] as const

const STAGING_BY_ID = new Map(QUEST_STAGING.map((placement) => [placement.id, resolveQuestStaging(zone, placement)]))
const placed = (id: string) => {
  const placement = STAGING_BY_ID.get(id)
  if (!placement) throw new Error(`Quest target staging is missing: ${id}`)
  return { x: placement.x, z: placement.z }
}
const npc = (id: string, label: string, castsShadow = false): WorldQuestNpcPlacement => ({
  ...placed(id), id, label, name: label, facing: Math.PI, castsShadow, interactionRadius: 3.2, kind: 'npc',
})
const patient = (id: string, label: string): WorldQuestNpcPlacement => ({
  ...placed(id), id, label, name: label, facing: Math.PI * 0.75, castsShadow: false, interactionRadius: 2.7, kind: 'patient',
})
const prop = (id: string, label: string): WorldQuestTarget => ({
  ...placed(id), id, label, interactionRadius: 2.35, kind: 'prop',
})

export const QUEST_NPCS: readonly WorldQuestNpcPlacement[] = [
  npc('npc_mara', 'Mara', true),
  npc('npc_iven', 'Iven', true),
  npc('npc_edda', 'Edda', true),
  npc('npc_tavi', 'Tavi'),
  npc('npc_seli', 'Seli'),
  npc('npc_ferryman', 'Ferryman'),
  patient('npc_family', 'Family by the supply awning'),
  patient('survivor_willow', 'Willow survivor'),
  patient('survivor_ferry_post', 'Ferry-post survivor'),
  patient('survivor_driftwood', 'Dazed survivor'),
  patient('patient_wrap_1', 'Wounded traveler'),
  patient('patient_wrap_2', 'Wounded traveler'),
  patient('patient_wrap_3', 'Wounded traveler'),
  patient('meal_recipient_1', 'Resting traveler'),
  patient('meal_recipient_2', 'Resting traveler'),
] as const

export const QUEST_TARGETS: readonly WorldQuestTarget[] = [
  ...QUEST_NPCS,
  prop('rescue_ties', 'Blue rescue ties'),
  prop('willow_branch_1', 'Fallen willow branch'),
  prop('willow_branch_2', 'Tangled willow branch'),
  prop('rescue_line_footing', 'Marked rescue footing'),
  prop('satchel_reeds_1', 'Downriver reeds'),
  prop('satchel_reeds_2', 'Downriver reeds'),
  prop('satchel_reeds_3', 'Downriver reeds'),
  prop('water_pump', 'Alderbank hand pump'),
  prop('scuffed_plank', 'Scuffed landing plank'),
  prop('reed_flash_1', 'Small flash in the reeds'),
  prop('reed_flash_2', 'Dull flash in the reeds'),
  prop('reed_flash_3', 'Bent reed'),
  prop('tin_thrush', 'Tin thrush'),
  prop('damp_bedding_1', 'Damp bedding roll'),
  prop('damp_bedding_2', 'Damp bedding roll'),
  prop('damp_bedding_3', 'Damp bedding roll'),
  prop('drying_line_1', 'Marked drying line'),
  prop('drying_line_2', 'Marked drying line'),
  prop('drying_line_3', 'Marked drying line'),
  prop('blue_cloth_roll_1', 'Blue-cord cloth roll'),
  prop('blue_cloth_roll_2', 'Blue-cord cloth roll'),
  prop('covered_water_barrel', 'Covered water barrel'),
  prop('root_cutter_1', 'Hand root cutter'),
  prop('root_cutter_2', 'Hand root cutter'),
  prop('root_cutter_3', 'Hand root cutter'),
  prop('root_cutter_4', 'Hand root cutter'),
  prop('warm_cup', 'Warm cup'),
  prop('seli_continue', 'Keep Seli company'),
  prop('family_name_1', 'Ask the family about Yara'),
  prop('family_name_2', 'Confirm the family’s second name'),
  prop('notice_board_title', 'Waiting Wood notice board'),
  prop('notice_board_hooks', 'Low notice-board hooks'),
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
