# Chapter One: A Fire Worth Keeping

**Authored story draft · First Early Access chapter · Not implemented content**

This script brings together the opening cinematic, ten main scenario quests,
twenty side quests and the first four-player dungeon. Names, geography, dialogue,
encounter details and reward descriptions are proposed creative content for review.
They do not establish a finished race roster, combat kit or economic balance.

The intended experience is complete but small: escape, reunite, establish a refuge,
rescue those still missing, and discover a reason to investigate further. The
chapter should resolve its immediate rescue story without pretending to explain
the whole ash threat.

The [first-zone terrain build slice](https://github.com/microserv-io/ashveil/blob/main/docs/first-zone-terrain.md)
is implementing this travel contract as connected Three.js terrain for review. It does
not implement these quests or settle their encounters, production engine, playable
scale or staging.

## The story

You travelled with a close-knit group through Bracken Hollow. Whether it was your
home, a temporary home or simply somewhere you had begun to belong is left to the
player. When the ash advances, the group escapes toward Alderbank, a small
settlement across the river. The landscape does not burn: familiar things lose
colour and movement. The crossing fails, and the group becomes separated.

On the safer bank, people need help before they need a hero. You find survivors,
tend the wounded, choose a salvaged weapon and recover the supplies that will let
them stay. Alderbank already has inhabitants and concerns of its own. Learning
their names is part of making a place here; not every errand is secretly about the
ash.

A scout discovers that the missing survivors reached a waystation beneath the old
crossing. Its damaged protective machinery makes rescue dangerous. Inside, your
party finds signs that a repair was deliberately altered before the disaster.
The evidence suggests interference; it does not prove that someone created the
ash or explain how it works.

You bring the survivors back. The chapter ends with a meal, a reunion and a
maintenance record bearing an unfamiliar split-ring seal. A lead toward the next
region offers a practical question to pursue: who authorised the work, and why?

## Cast and voice

| Character | Role | Voice and relationship |
| --- | --- | --- |
| The player | A member of the displaced travelling group | Any supported race or gender; no class, fixed ancestry, romance or chosen-one destiny imposed by this script. `{player}` is the display-name token. |
| Mara | Organises the scattered group | Practical and warm. Uses tasks to steady herself but remembers whom each task helps. |
| Iven | Healer among the survivors | Gentle, dry humour, precise about care. Wounded people remain people rather than objective counters. |
| Tavi | Scout | Observant and candid. Describes what was actually seen and distinguishes it from a guess. |
| Edda | Alderbank's refuge keeper | Blunt, generous and busy. The settlement has a life that predates the player's arrival. |
| Len | Missing adult companion | Steadfast and familiar with the group. The rescue has personal weight without prescribing a family relationship. |
| Hessa | Craftsperson associated with the wagon | Values tools for the work and independence they provide. Introduces practical crafting without making it compulsory. |
| Orren | Local farmer | Grounds one optional story in the work of keeping a smallholding running. |
| Nella | Orchard keeper | Grounds another optional story in local knowledge, small surprises and life beyond the disaster. |

Dialogue should convey those voices without requiring a particular accent. Player
responses below are selectable lines or a neutral continue response as indicated;
they do not imply an unbuilt morality, romance or branching-campaign system.

## Quest bundles and travel contract

| Outing | Main quests | Side quests | Availability and return rules |
| --- | --- | --- | --- |
| Safe riverbank and refuge | M01–M03 | S01–S05 | Rescue and care are safe before weapon selection. Related tasks are offered together. M03 introduces the first weapon before required combat. |
| Wagon road and nearby fields | M04–M05 | S06–S10 | Both main objectives and the five side offers are available before departure. Clearing the approach and recovering supplies happen on the same visit. |
| Optional farmstead and grove | None | S11–S16 | Two three-part local stories, available after the weapon introduction. Their follow-ups continue on location; this area never blocks the main story. |
| Waystation approach | M06–M07 | S17–S18 | Scout and ward investigation share an outing. Discovered records and landmarks receive appropriate early credit. |
| The Broken Waystation dungeon | M08 | S19–S20 | Both optional dungeon quests are offered before first entry. The main rescue and essential evidence never depend on them. |
| Refuge conclusion | M09–M10 | Existing unfinished quests remain | Reunion, a local resolution and a next-chapter lead. No required journey into an unreleased region. |
| **Total** | **10** | **20** | **One first-chapter dungeon. Side quests comprise fourteen standalone quests and two three-quest chains.** |

Quest counts are a content budget, not a reason to split one interaction into
multiple turn-ins. MSQ-only progression must supply the experience, basic equipment
and instruction needed for the story dungeon. Finishing every side quest should
not make the rest of the chapter meaningless. Exact quest durations, level gates,
XP and item numbers require playtesting; thirty authored quests plus a dungeon are
not promised to fit into one hour.

Availability means an offer is discoverable before an outing, not that twenty
markers appear immediately or that the journal silently accepts every quest.
If an objective is not yet revealed for narrative reasons, the follow-up must
recognise the relevant persistent discovery or introduce a genuinely new action
on location. It must not ask for another pass through the same enemies.

## Shared quest and reward rules

- **Personal progress, shared outings.** Eligible party members receive objective
  credit together when participating. One person's dialogue choice or turn-in
  cannot skip another person's scene or complete an unmet prerequisite.
- **Recognise early discoveries.** Named keepsakes, letters and investigated
  landmarks can retain character-local discovery flags. Offer and completion
  dialogue acknowledge those flags. Ordinary kills before quest acceptance do not
  require an unlimited historical kill ledger.
- **Avoid competition for story objects.** Quest pickups and rescue interactions
  remain available to other eligible players. Cosmetic or gathering rewards follow
  their eventual resource rules rather than duplicating an unlimited tradable item.
- **No story-item inventory tax.** Temporary quest objects are tracked in the quest
  interface. They are not vendor trash, currency drops or ingredients that players
  must buy from the market to complete the MSQ.
- **Optional really means optional.** Side quests provide local stories, useful
  experience and reward variety. They do not hide the core sabotage evidence,
  essential class equipment or a prerequisite for the chapter's ending.
- **Choose a class for equipment rewards.** Where appropriate, rewards support the
  selected unlocked class. Equipment still has its level requirements. Quest XP
  earned before M03 is reserved and assigned once to the first selected class in
  this draft; early equipment is class-neutral. Later quest XP goes to the active
  eligible class at completion. Switching class cannot duplicate a one-time reward
  or reset completed quests. Exact level eligibility and XP amounts remain tuning.
- **Separate story from repeat rewards.** First-clear quest rewards are granted
  once per character. Dungeon replays are acknowledged as retellings, with the
  separately balanced repeatable loot/material/token rules. Survivors are not
  narratively kidnapped again every run.
- **Respect first-time scenes.** The party can remain together for story gameplay.
  Dungeon-start and completion staging must allow first-time dialogue without
  another player starting required combat out of reach.

Reward entries in the script describe intent. They do not mint exact currency
amounts, fix rarity or introduce premium appearances into trivial errands. Currency
is awarded for completed participation, not found in ordinary beasts' pockets.
Simple crafted goods, supplies, modest keepsakes and introductory appearance
rewards must preserve the GDD's harder-content visual prestige.

## How this grows into Season One

Early Access adds regions, main-quest chapters and level-cap progression toward a
complete first season. Those releases extend this same character's story; they are
not Season One, Two and Three in miniature. Each release needs its own satisfying
local resolution and useful repeatable activities.

The complete first-season arc is investigation leading to a main antagonist, with
the resolution exposing a larger scheme for later seasons or expansions. This
chapter plants evidence but does not settle the antagonist, their motives or the
ultimate origin of the ash. Returning to the border, entering ash regions and
reclaiming selected places are future directions. Their world-state and replay
models remain open, particularly when friends have different story progress.

Beyond the chapter's first completion, the initial playable scope should support
dungeon replays, unfinished side stories, another class, gathering/crafting goals,
exploration and a small cooperative world activity. These are retention loops to
test, not additional one-time quests counted among the twenty side quests below.

## Player-feedback lessons applied

- FF14 players have repeatedly questioned the reward value of optional quests;
  others value them primarily for local stories. Side quests here should serve both
  interests without becoming compulsory campaign progression.
  [Side-quest XP discussion](https://forum.square-enix.com/ffxiv/threads/508033-Side-Quests-XP-is-a-joke)
- WoW players describe frustration with returning to the same enemies for newly
  disclosed objectives. This script groups offers by outing and preserves early
  discoveries rather than relying on extra travel for length.
  [Quest-routing discussion](https://www.reddit.com/r/wow/comments/k4eznm)
- FF14 quest-design criticism motivates varied playable actions, while praise for
  WoW's quiet conversations reminds us that a good quest need not contain a fight.
  [FF14 quest-design feedback](https://forum.square-enix.com/ffxiv/threads/509395)
  and [WoW quiet-story responses](https://eu.forums.blizzard.com/en/wow/t/stay-a-while/406116)
- Story-length preferences differ. The main route must tell its own complete local
  story, while optional conversations and local quests offer more time with people.
  [WoW campaign-length discussion](https://us.forums.blizzard.com/en/wow/t/shorter-msq-in-the-war-within/1895183)

These are qualitative examples, not representative surveys or proof of an ideal
quest count. Existing precedents include FF14's main-story content unlocks and
WoW's quest replay through Party Sync; Ashveil retains its own unlock and
full-rotation level-sync decisions.
[FF14 support guide](https://support.na.square-enix.com/faqarticle.php?id=5382&kid=72691),
[WoW Party Sync explanation](https://news.blizzard.com/en-us/article/23451087/explore-azeroth-with-friends-using-party-sync)

## Script notation

Each quest supplies its offer, journal text, objectives, contextual lines,
in-progress reminder and completion. Designer notes cover prerequisites, group
credit, early discoveries and reward intent; they are not player-facing dialogue.
Scenes are scripts for implementation and performance review, not a commitment to
full voice acting. Named NPCs are adults unless a later approved character brief
states otherwise.
