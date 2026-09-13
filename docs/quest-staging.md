# Opening quest staging

The first playable quest cluster uses the stable target IDs from the versioned quest
catalogue. `src/world/quest-world-data.ts` projects those IDs from explicit named-landmark
offsets. Positions are authoritative world staging data, but never enter the saved character aggregate.
Moving a target therefore preserves accepted objectives, completion and reward receipts.

Only M01, M02 and S01–S05 are staged for play. The remaining opening catalogue stays
planned content. Approved-character copies remain temporary NPC and patient placeholders.

## Safe Landing

The default player start is 86 metres west of the Safe Landing map anchor on the dry
living bank. Mara stands five metres inland, beyond her 3.2-metre interaction radius and
in the initial southeast-facing view. The authored landing road still terminates at the
landmark anchor, giving the shore shelf a continuous inland exit.

| Local context | Stable targets |
| --- | --- |
| Arrival camp | `npc_mara`, `npc_tavi`, `rescue_ties`, `scuffed_plank` |
| Willow rescue | `willow_branch_1`, `willow_branch_2`, `survivor_willow` |
| Ferry footing | `rescue_line_footing`, `survivor_ferry_post`, `npc_seli`, `seli_continue`, `npc_ferryman` |
| Downriver reeds | `survivor_driftwood`, `satchel_reeds_1`–`3`, `reed_flash_1`–`3`, `tin_thrush` |

The living-bank targets span 46 metres north to south. Their centres remain on dry ground
roughly 14–25 metres inland of the compiled water edge, so the water is visible without
placing interactions in the river.

## Alderbank Refuge

| Local context | Stable targets |
| --- | --- |
| Treatment and supply awning | `npc_iven`, `warm_cup`, `patient_wrap_1`–`3`, `meal_recipient_1`–`2`, `npc_family`, `family_name_1`–`2`, `blue_cloth_roll_1`–`2` |
| Baggage and drying yard | `damp_bedding_1`–`3`, `drying_line_1`–`3` |
| Common cookfire | `npc_edda`, `covered_water_barrel`, `root_cutter_1`–`4` |
| Commons fixtures | `water_pump`, `notice_board_title`, `notice_board_hooks` |

M01 begins and ends with static Mara at the landing. M02 starts with the bank search and
continues with Iven, the treatment awning and the refuge pump. S05 intentionally returns
from the notice board down the landing road to Mara. No NPC phasing or M03 staging is
introduced by this layout.

Automated acceptance walks from the shore spawn to the landing-road endpoint, follows
the authored road through the bluff notch to the refuge, and checks a reachable
interaction approach for every target. NPC and patient centres must themselves clear
water and scenery solids. The same tests exercise representative M01 and M02 host
transactions while the existing host and persistence regression suites protect all seven
playable quests.
