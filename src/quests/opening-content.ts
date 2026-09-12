import type { DialogueLine, DialogueScene, QuestDefinition, QuestDefinitionResolver, QuestId, QuestObjectiveDefinition, QuestTargetId } from './types'

const CHAPTER = 'A Fire Worth Keeping'
const SAFE_BANK = 'Safe riverbank and refuge'
const MSQ_SOURCE = 'docs/story/opening-msq.md'
const SIDE_SOURCE = 'docs/story/opening-side-quests.md'
const plannedReason = 'This chapter step is catalogued but is not playable in the current safe-bank slice.'

const line = (speaker: string, text: string, choiceId?: string): DialogueLine => ({ speaker, text, ...(choiceId ? { choiceId } : {}) })
const scene = (id: string, kind: DialogueScene['kind'], lines: readonly DialogueLine[]): DialogueScene => ({ id, kind, lines })
const objective = (
  id: string, label: string, targetIds: readonly QuestTargetId[], count = targetIds.length,
  credit: QuestObjectiveDefinition['credit'] = 'personal', extra: Pick<QuestObjectiveDefinition, 'earlyPrefix' | 'choiceIds'> = {},
): QuestObjectiveDefinition => ({ id, label, targetIds, count, credit, ...extra })

const PLAYABLE: readonly QuestDefinition[] = [
  {
    id: 'M01', version: 1, category: 'main', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'Who Made It Across?', giverId: 'npc_mara', turnInId: 'npc_mara', location: 'Alderbank river landing',
    summary: 'Help Mara find everyone who made it across before the river carries away signs of them.', source: `${MSQ_SOURCE}#m01--who-made-it-across`,
    prerequisites: [], gates: ['arrived_alderbank'],
    objectives: [
      objective('take_rescue_ties', "Take Mara's bundle of blue rescue ties.", ['rescue_ties'], 1, 'personal', { earlyPrefix: true }),
      objective('clear_willow_branches', 'Clear two branches beneath the willow shelf.', ['willow_branch_1', 'willow_branch_2'], 2, 'shared', { earlyPrefix: true }),
      objective('rescue_willow', 'Assist the survivor beneath the willow shelf.', ['survivor_willow'], 1, 'shared', { earlyPrefix: true }),
      objective('throw_rescue_line', 'Throw the rescue line from the marked footing.', ['rescue_line_footing'], 1, 'shared', { earlyPrefix: true }),
      objective('rescue_ferry_post', 'Assist the survivor at the ferry post.', ['survivor_ferry_post'], 1, 'shared', { earlyPrefix: true }),
      objective('rescue_driftwood', 'Speak to the dazed survivor and place a blue tie.', ['survivor_driftwood'], 1, 'shared', { earlyPrefix: true }),
    ],
    scenes: [
      scene('offer', 'offer', [line('Mara', 'Three people were swept below the landing. Check the willow shelf, ferry post and driftwood. Call before you touch anyone. Frightened people wake fighting.')]),
      scene('reply', 'reply', [line('Player', 'I’ll search the bank and bring back whoever I find.')]),
      scene('followup', 'followup', [line('Mara', "Good. Point them toward Edda's bell. If they cannot walk, mark the place with one of these blue ties and Iven will come.")]),
      scene('context:rescue_willow', 'context', [line('Willow survivor', 'I can stand. Just—give me a moment where the ground stays put.')]),
      scene('context:rescue_ferry_post', 'context', [line('Ferry-post survivor', 'Len kept the rope up until the last boat. Did you see Len cross?'), line('Player', 'Not yet. Go to the bell. We’re still counting.')]),
      scene('context:rescue_driftwood', 'context', [line('Dazed survivor', 'Safe bank?'), line('Player', 'Safe bank. Help is coming.'), line('Mara', 'That is everyone below the bend. Bring me the count.')]),
      scene('reminder', 'reminder', [line('Mara', 'Three missing below the landing: willow shelf, ferry post, driftwood. Blue ties for anyone who cannot walk.')]),
      scene('completion', 'completion', [line('Player', 'All three are alive. One needs carrying. No sign of Len.'), line('Mara', 'Alive is a good count. We keep it. Len chose the lower road and knows how to hold a frightened group together. That buys us time, not certainty.')]),
    ],
    reward: { pendingXp: 120, currency: 4, items: [], unlocks: ['basic_social_access'] },
  },
  {
    id: 'M02', version: 1, category: 'main', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'A Place to Breathe', giverId: 'npc_iven', turnInId: 'npc_iven', location: 'Alderbank river landing and refuge awning',
    summary: "Recover Iven's satchel, then help settle the wounded under Alderbank's awning.", source: `${MSQ_SOURCE}#m02--a-place-to-breathe`,
    prerequisites: [], gates: ['arrived_alderbank'],
    objectives: [
      objective('search_reeds', "Search up to three reed clumps and find Iven's satchel by the third.", ['satchel_reeds_1', 'satchel_reeds_2', 'satchel_reeds_3'], 3, 'shared', { earlyPrefix: true }),
      objective('return_satchel', 'Bring the closed satchel to Iven under the refuge awning.', ['npc_iven'], 1, 'personal'),
      objective('distribute_wraps', 'Distribute dry wraps to three wounded adults.', ['patient_wrap_1', 'patient_wrap_2', 'patient_wrap_3'], 3, 'personal'),
      objective('refill_basin', "Refill the painted water basin from Alderbank's hand pump.", ['water_pump'], 1, 'shared'),
      objective('report_to_iven', 'Speak with Iven.', ['npc_iven'], 1, 'personal'),
    ],
    scenes: [
      scene('offer', 'offer', [line('Iven', 'I have six hands’ worth of work and, inconveniently, two hands. My brown satchel went into the river. It has red stitching and dislikes water almost as much as I do.')]),
      scene('reply', 'reply', [line('Player', 'Where should I look?')]),
      scene('followup', 'followup', [line('Iven', 'Reeds below the ferry post. Bring it closed. Then I’ll show you what can be trusted after a soaking.')]),
      scene('context:search_reeds:complete', 'context', [line('Iven', 'Hold it above the mud, please. The mud already has everything it needs.')]),
      scene('context:distribute_wraps:patient_wrap_1', 'context', [line('First patient', 'Save the wrap for someone worse.'), line('Iven', 'A generous infection is still an infection. Take the wrap.')]),
      scene('context:refill_basin', 'context', [line('Iven', 'Slowly. Breathing first, drinking second. Panic makes poor medicine.')]),
      scene('context:report_to_iven', 'context', [line('Iven', 'There. No miracles. Just fewer things getting worse.')]),
      scene('reminder', 'reminder', [line('Iven', 'Red stitching, downriver reeds. If you have the satchel, bring it here; if you have the wraps, three people still need them.')]),
      scene('completion', 'completion', [line('Player', 'The basin is full and everyone has a dry wrap.'), line('Iven', 'Then they have a place to breathe. That sounds small until breathing is the whole day. Thank you, `{player}`. Mara wants you by the store shed when your hands are free.')]),
    ],
    reward: { pendingXp: 120, currency: 4, items: [{ id: 'field_dressing_supplies', label: 'Field dressing supplies', quantity: 1 }] },
  },
  {
    id: 'S01', version: 1, category: 'side', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'The Tin Thrush', giverId: 'npc_mara', turnInId: 'npc_mara', location: 'Alderbank refuge, lower landing',
    summary: "Search the bank for Mara's small tin bird before more feet churn the mud.", source: `${SIDE_SOURCE}#s01--the-tin-thrush`,
    prerequisites: [], gates: ['arrived_alderbank'],
    objectives: [
      objective('inspect_plank', 'Inspect the scuffed plank.', ['scuffed_plank'], 1, 'shared', { earlyPrefix: true }),
      objective('follow_flashes', 'Follow three small flashes in the reeds.', ['reed_flash_1', 'reed_flash_2', 'reed_flash_3'], 3, 'shared', { earlyPrefix: true }),
      objective('recover_thrush', 'Lift the tin thrush without snapping its wire wing.', ['tin_thrush'], 1, 'shared', { earlyPrefix: true }),
    ],
    scenes: [
      scene('offer', 'offer', [line('Mara', 'I count people first, baggage second. That is the right order, but a little tin thrush slipped from my coat while we crossed. Len made it from a tea tin on a rainy afternoon. If it reached the current, let it go. If it is still on this bank, I would like it back.')]),
      scene('reply', 'reply', [line('Player', 'I’ll search the landing. You keep counting people.')]),
      scene('context:inspect_plank', 'context', [line('World', 'A narrow mark runs toward the water, too straight for a boot heel.')]),
      scene('context:follow_flashes:reed_flash_2', 'context', [line('Tavi', 'Not there. That is mica. The next glint is duller.')]),
      scene('context:recover_thrush', 'context', [line('World', 'The tin is dented, but the tiny wing still turns.')]),
      scene('reminder', 'reminder', [line('Mara', 'Check where the reeds lean downstream. Please don’t wade for it; one missing person is already too many.')]),
      scene('completion', 'completion', [line('Mara', 'There you are. One wing crooked and still determined to fly. Len would say that makes it accurate.'), line('Player', 'Keep it close. We’ll bring its maker back to see it.')]),
    ],
    reward: { pendingXp: 55, currency: 2, items: [{ id: 'class_neutral_accessory', label: 'Simple class-neutral accessory', quantity: 1 }] },
  },
  {
    id: 'S02', version: 1, category: 'side', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'Dry Cloth, Dry Tempers', giverId: 'npc_iven', turnInId: 'npc_iven', location: 'Alderbank refuge, covered bank shelter',
    summary: 'Sort damp bedding from clean sealed cloth.', source: `${SIDE_SOURCE}#s02--dry-cloth-dry-tempers`,
    prerequisites: [], gates: ['arrived_alderbank'],
    objectives: [
      objective('collect_bedding', 'Collect three damp bedding rolls.', ['damp_bedding_1', 'damp_bedding_2', 'damp_bedding_3'], 3, 'shared', { earlyPrefix: true }),
      objective('hang_bedding', 'Hang the rolls on marked lines.', ['drying_line_1', 'drying_line_2', 'drying_line_3'], 3, 'shared', { earlyPrefix: true }),
      objective('carry_cloth', 'Carry two blue-cord rolls to Iven.', ['blue_cloth_roll_1', 'blue_cloth_roll_2'], 2, 'personal'),
      objective('report_dry_stores', 'Tell Iven the dry stores are separated.', ['npc_iven'], 1, 'personal'),
    ],
    scenes: [
      scene('offer', 'offer', [line('Iven', 'Someone packed wet blankets on top of clean cloth. A triumph of urgency over geometry. I need the bedding hung and the sealed rolls brought here. No healer’s training required. If a bundle is tied with blue cord, do not improve it.')]),
      scene('reply', 'reply', [line('Player', 'Blue cord stays closed. I’ll sort the rest.')]),
      scene('context:hang_bedding', 'context', [line('Hessa', 'Leave a hand’s width. Cloth dries; heaps sulk.')]),
      scene('context:carry_cloth', 'context', [line('Iven', 'Good. Still tied. My faith in labels survives.')]),
      scene('context:hang_bedding:complete', 'context', [line('Child', 'That red one is ours. It scratches, so we know it.')]),
      scene('reminder', 'reminder', [line('Iven', 'Bedding to the lines, blue cords to me. If the knots remain shut, I may even be pleasant.')]),
      scene('completion', 'completion', [line('Iven', 'Clean, dry, and no one decided to diagnose a blanket. Excellent work. People will sleep warmer, which is half of healing on a night like this.'), line('Player', 'Then I’ll count the scratching blanket as medicine too.')]),
    ],
    reward: { pendingXp: 55, currency: 2, items: [{ id: 'general_cloth_materials', label: 'General cloth materials', quantity: 3 }] },
  },
  {
    id: 'S03', version: 1, category: 'side', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'A Pot for Everyone', giverId: 'npc_edda', turnInId: 'npc_edda', location: 'Alderbank refuge, common cookfire',
    summary: 'Fetch water, portion roots and carry meals for people who cannot walk over.', source: `${SIDE_SOURCE}#s03--a-pot-for-everyone`,
    prerequisites: [], gates: ['arrived_alderbank'],
    objectives: [
      objective('fill_jug', 'Fill the cooking jug.', ['covered_water_barrel'], 1, 'shared', { earlyPrefix: true }),
      objective('portion_roots', 'Portion four washed roots.', ['root_cutter_1', 'root_cutter_2', 'root_cutter_3', 'root_cutter_4'], 4, 'shared', { earlyPrefix: true }),
      objective('ask_iven_meals', 'Ask Iven who needs meals delivered.', ['npc_iven'], 1, 'personal'),
      objective('deliver_bowls', 'Carry both covered bowls to their recipients.', ['meal_recipient_1', 'meal_recipient_2'], 2, 'personal'),
      objective('return_tray', 'Return the empty tray to Edda.', ['npc_edda'], 1, 'personal'),
    ],
    scenes: [
      scene('offer', 'offer', [line('Edda', 'I can feed frightened people or answer the same six questions about blankets. I cannot do both while stirring. Bring water from the covered barrel, pass these roots through the cutter, then ask Iven who cannot walk over. That is kitchen work, not a profession. Confidence will only make the knife notice you.')]),
      scene('reply', 'reply', [line('Player', 'Water, roots, and a headcount. I’ll keep my confidence modest.')]),
      scene('context:portion_roots', 'context', [line('Edda', 'Flat side down. I prefer supper without fingertips.')]),
      scene('context:deliver_bowls:meal_recipient_1', 'context', [line('First recipient', 'Put it here, please. The smell reached me before my appetite did.')]),
      scene('context:deliver_bowls:meal_recipient_2', 'context', [line('Second recipient', 'Half a bowl is enough. Give the rest to whoever says it isn’t.')]),
      scene('reminder', 'reminder', [line('Edda', 'The pot is patient. The people waiting for it are trying to be.')]),
      scene('completion', 'completion', [line('Edda', 'Every bowl returned empty. That is the closest a cook gets to applause. You made this bank feel inhabited instead of occupied.'), line('Player', 'Save me a bowl if there’s one left.')]),
    ],
    reward: { pendingXp: 55, currency: 2, items: [{ id: 'travel_food_supplies', label: 'Travel food supplies', quantity: 2 }] },
  },
  {
    id: 'S04', version: 1, category: 'side', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'Room for Quiet', giverId: 'npc_iven', turnInId: 'npc_iven', location: 'Alderbank refuge, old ferry bench',
    summary: 'Bring Seli a warm cup and offer company without interrogation.', source: `${SIDE_SOURCE}#s04--room-for-quiet`,
    prerequisites: [], gates: ['arrived_alderbank', 'iven_introduction_heard'],
    objectives: [
      objective('take_warm_cup', 'Take the warm cup from Iven.', ['warm_cup'], 1, 'personal'),
      objective('offer_cup', 'Offer the cup to Seli.', ['npc_seli'], 1, 'personal'),
      objective('choose_company', 'Choose to sit nearby or give Seli space.', ['npc_seli'], 1, 'personal', { choiceIds: ['sit_nearby', 'give_space'] }),
      objective('wait_for_seli', 'Wait until Seli is ready to speak.', ['seli_continue'], 1, 'personal'),
      objective('report_seli', 'Report that Seli accepted the cup.', ['npc_iven'], 1, 'personal'),
    ],
    scenes: [
      scene('offer', 'offer', [line('Iven', 'Seli is sitting by the old ferry post. They are not injured, and they do not owe us a tidy account of today. Take this warm cup over. Sit if invited. Silence is allowed to do some of the work.')]),
      scene('reply', 'reply', [line('Player', 'I can bring the cup and let Seli choose the rest.')]),
      scene('context:offer_cup', 'context', [line('Seli', 'You can sit. Just don’t ask what I left.')]),
      scene('choice:sit_nearby', 'choice', [line('Player', 'I won’t ask. I can watch the river with you.', 'sit_nearby'), line('Seli', 'All right. Tell me when the cup stops steaming.', 'sit_nearby')]),
      scene('choice:give_space', 'choice', [line('Player', 'I’ll be by the post if you want someone near.', 'give_space'), line('Seli', 'Near is good. Thank you for knowing the difference.', 'give_space')]),
      scene('context:wait_for_seli', 'context', [line('Seli', 'I can eat later. Tell the healer I said later, not never.')]),
      scene('reminder', 'reminder', [line('Iven', 'The cup goes to Seli. Your task is presence, not extraction.')]),
      scene('completion', 'completion', [line('Iven', 'Later is a useful word. It leaves a door open without pushing anyone through.'), line('Player', 'Seli chose the distance. I only kept it company.')]),
    ],
    reward: { pendingXp: 55, currency: 2, items: [{ id: 'restorative_supplies', label: 'Restorative supplies', quantity: 1 }] },
  },
  {
    id: 'S05', version: 1, category: 'side', status: 'playable', chapter: CHAPTER, outing: SAFE_BANK,
    title: 'Names on Waiting Wood', giverId: 'npc_mara', turnInId: 'npc_mara', location: 'Alderbank refuge, notice rail beneath the alders',
    summary: 'Confirm spellings and consent before posting a careful list of people awaiting word.', source: `${SIDE_SOURCE}#s05--names-on-waiting-wood`,
    prerequisites: [], gates: ['arrived_alderbank', 'initial_survivor_count_known'],
    objectives: [
      objective('confirm_family_names', 'Confirm two names with the family beside the supply awning.', ['family_name_1', 'family_name_2'], 2, 'shared', { earlyPrefix: true }),
      objective('confirm_ferryman_name', 'Confirm one name with the ferryman.', ['npc_ferryman'], 1, 'shared', { earlyPrefix: true }),
      objective('ask_seli_consent', 'Ask Seli whether they want a name included.', ['npc_seli'], 1, 'personal', { choiceIds: ['include_parn', 'leave_space'] }),
      objective('title_board', 'Title the board “Awaiting Word.”', ['notice_board_title'], 1, 'shared'),
      objective('hang_board', 'Hang the board on the low hooks.', ['notice_board_hooks'], 1, 'shared'),
    ],
    scenes: [
      scene('offer', 'offer', [line('Mara', 'People keep asking whether I have a list of the missing. I do, but a list can turn uncertainty into a verdict if it is written carelessly. Ask three groups how their people spell their names. Write ‘awaiting word’ at the top. Then hang it low enough that anyone can add to it.')]),
      scene('reply', 'reply', [line('Player', 'I’ll record what they give me and nothing more.')]),
      scene('context:confirm_family_names', 'context', [line('Family member', 'Yara, with one r. She always corrects people herself.')]),
      scene('context:confirm_ferryman_name', 'context', [line('Ferryman', 'Deme. Put ‘last seen upriver,’ not ‘lost.’ I saw him choosing the ridge.')]),
      scene('choice:include_parn', 'choice', [line('Seli', 'Write Parn. Large letters, please.', 'include_parn'), line('Player', 'I’ll write it as you asked.', 'include_parn')]),
      scene('choice:leave_space', 'choice', [line('Seli', 'Not yet. I’ll tell you if that changes.', 'leave_space'), line('Player', 'Then I’ll leave the space open.', 'leave_space')]),
      scene('reminder', 'reminder', [line('Mara', 'Spellings, consent, and ‘awaiting word.’ Hope deserves accurate records.')]),
      scene('completion', 'completion', [line('Mara', 'Good. It leaves room beneath every name. For a sighting, a message, a line through the worry when someone walks in.'), line('Player', 'Then we’ll keep the charcoal beside it.')]),
    ],
    reward: { pendingXp: 55, currency: 2, items: [{ id: 'general_leveling_materials', label: 'General leveling materials', quantity: 2 }] },
  },
] as const

type PlannedRow = readonly [QuestId, QuestDefinition['category'], string, QuestTargetId, QuestTargetId, string, readonly QuestId[], string]
const PLANNED_ROWS: readonly PlannedRow[] = [
  ['M03', 'main', 'Something to Carry', 'npc_mara', 'npc_mara', 'Alderbank store shed and fenced practice yard', ['M01', 'M02'], 'Choose a first class weapon and learn its basic action.'],
  ['M04', 'main', 'Driven Before the Ash', 'npc_mara', 'npc_mara', 'Wagon recovery loop', ['M03'], 'Clear the wagon approach and guide three pack beasts home.'],
  ['M05', 'main', 'What We Could Save', 'npc_hessa', 'npc_hessa', 'Stranded wagon', ['M03'], 'Recover wagon supplies for a first useful gear set.'],
  ['M06', 'main', 'Names on the Board', 'npc_tavi', 'npc_tavi', 'Lower Road waystation rally', ['M04', 'M05'], 'Follow signs left by the missing group to the waystation.'],
  ['M07', 'main', 'The Road Below', 'npc_edda', 'npc_edda', 'Lower Road waystation rally', ['M04', 'M05'], 'Investigate why the repaired waystation ward failed.'],
  ['M08', 'main', 'Those Still Missing', 'npc_tavi', 'npc_len', 'The Broken Waystation', ['M06', 'M07'], 'Enter the Broken Waystation, rescue the missing adults and recover evidence.'],
  ['M09', 'main', 'A Fire Worth Keeping', 'npc_mara', 'npc_mara', 'Alderbank refuge yard', ['M08'], 'Gather the returned group around the refuge fire.'],
  ['M10', 'main', 'A Mark We Do Not Know', 'npc_edda', 'npc_edda', 'Alderbank refuge table and noticeboard', ['M09'], 'Compare the damaged ring with the ward records and establish the next lead.'],
  ['S06', 'side', 'Hessa’s Wandering Tools', 'npc_hessa', 'npc_hessa', 'Lower road', ['M03'], 'Recover Hessa’s three red-cord tools.'],
  ['S07', 'side', 'Pella Has Other Plans', 'npc_hessa', 'npc_hessa', 'Fern meadow and wagon', ['M03'], 'Tempt Pella back without frightening her.'],
  ['S08', 'side', 'The Fence Remembers', 'npc_orren', 'npc_orren', 'First field boundary', ['M03'], 'Repair a field fence while preserving the route marker.'],
  ['S09', 'side', 'Marks That Move', 'npc_tavi', 'npc_tavi', 'Lower road', ['M03'], 'Place and verify three temporary route markers.'],
  ['S10', 'side', 'Apples for the Upper Room', 'npc_nella', 'npc_nella', 'Orchard edge and refuge loft', ['M03'], 'Gather sound windfalls and carry a message home.'],
  ['S11', 'side', 'Where the Water Went', 'npc_orren', 'npc_orren', 'First field irrigation line', ['M03'], 'Trace and mark three faults in an irrigation channel.'],
  ['S12', 'side', 'Three Small Repairs', 'npc_orren', 'npc_orren', 'First field irrigation line', ['S11'], 'Repair the three marked irrigation faults.'],
  ['S13', 'side', 'The Fair Share', 'npc_orren', 'npc_orren', 'Far-field water divider', ['S12'], 'Balance the field flow and choose where today’s reserve goes.'],
  ['S14', 'side', 'A Hive Out of Tune', 'npc_nella', 'npc_nella', 'Orchard bee row', ['M03'], 'Observe why bees are avoiding one hive.'],
  ['S15', 'side', 'Better Neighbors for Bees', 'npc_nella', 'npc_nella', 'Orchard bee row', ['S14'], 'Quiet and steady the hive’s surroundings.'],
  ['S16', 'side', 'The Little Orchard Fair', 'npc_nella', 'npc_nella', 'Orchard and Alderbank', ['S15'], 'Prepare a small tasting and name the tartest apple.'],
  ['S17', 'side', 'Letters at the Rain Frame', 'npc_edda', 'npc_edda', 'Waystation approach', ['M04', 'M05'], 'Recover a sealed courier satchel.'],
  ['S18', 'side', 'Notes from a Moving Edge', 'npc_tavi', 'npc_tavi', 'Waystation approach', ['M04', 'M05'], 'Recover three pages from living landmarks.'],
  ['S19', 'side', 'A Red Scarf for Len', 'npc_mara', 'npc_len', 'The Broken Waystation', ['M06', 'M07'], 'Recover Len’s patched red scarf if it is safe.'],
  ['S20', 'side', 'The Room Beneath the Bell', 'npc_tavi', 'npc_tavi', 'The Broken Waystation', ['M06', 'M07'], 'Record workers’ marks in the optional records room.'],
] as const

const PLANNED = PLANNED_ROWS.map(([id, category, title, giverId, turnInId, location, prerequisites, summary]): QuestDefinition => ({
  id, version: 1, category, status: 'planned', chapter: CHAPTER,
  outing: id === 'M03' ? SAFE_BANK : location, title, giverId, turnInId, location, summary,
  source: `${category === 'main' ? MSQ_SOURCE : SIDE_SOURCE}#${id.toLowerCase()}--${headingSlug(title)}`, prerequisites,
  gates: id === 'M10' ? ['altered_ward_evidence'] : [], objectives: [], scenes: [],
  reward: { pendingXp: 0, currency: 0, items: [], ...(id === 'M07' ? { unlocks: ['altered_ward_evidence'] as const } : {}) },
  unavailableReason: plannedReason,
}))

export const OPENING_QUESTS: readonly QuestDefinition[] = deepFreeze([...PLAYABLE, ...PLANNED])

const byVersion = new Map(OPENING_QUESTS.map((definition) => [`${definition.id}@${definition.version}`, definition]))
const latest = new Map<QuestId, QuestDefinition>()
for (const definition of OPENING_QUESTS) {
  const current = latest.get(definition.id)
  if (!current || current.version < definition.version) latest.set(definition.id, definition)
}

export const openingQuestResolver: QuestDefinitionResolver = {
  get: (id, version) => version === undefined ? latest.get(id) : byVersion.get(`${id}@${version}`),
  all: () => [...latest.values()],
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function headingSlug(title: string): string {
  return title.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
