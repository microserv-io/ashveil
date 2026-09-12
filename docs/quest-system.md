# Quest system design and implementation

## Objective and scope

Make Alderbank's authored quests a playable, persistent system with an unmistakable
distinction between main scenario quests and optional side stories. Follow
`story/opening-chapter.md`, `story/opening-msq.md`, and `story/opening-side-quests.md`.
Keep the current first-zone route independent from the deprecated action-RPG demo.

The first delivery implements the safe-bank outing: M01 and M02, plus S01–S05.
Catalogue all ten MSQs and twenty side quests with stable IDs, dependencies, outing,
giver, summary, source reference and implementation status. M03 onwards remain
planned until class selection, practice, combat and dungeon systems exist. A planned
quest cannot be accepted or rewarded. The journal explains the next unavailable
chapter step. This pass uses local persistence and the playable opening scope;
the remaining authored content is tracked in the catalogue.

The prototype starts after the crossing with a short arrival context, not a newly
implemented cinematic. It uses one explicitly offline character save per browser
origin; character creation and save-slot management are separate work. NPCs are
nonblocking placeholders with validated interaction radii, so no player can trap
another behind a quest giver. Every target must be reachable using current collision
rules. S04 becomes available after personally speaking to Iven; S05 after M01's
initial survivor count. Full later-quest text stays in authoring docs rather than
spoiling the chapter through the live journal.
New saves seed an `arrived_alderbank` gate. Offers, world markers and tracking show
implemented content only; after M01/M02, a non-actionable M03 notice explains the
current boundary. Reference catalogue browsing may show all thirty entries.
Personally opening Iven's introduction records `iven_introduction_heard`; completing
the three M01 rescue interactions records `initial_survivor_count_known`. These
typed gates control S04 and S05 respectively, independently of turn-in ordering.

## Player experience

- Main story has a gold diamond marker and an explicit Main Story label. Side
  stories have a teal circular marker and an explicit Optional Side Quest label.
  Available, active and ready-to-turn-in states differ by symbol and text, not color alone.
- Keep separate journal sections and tracker groups. Track the next objective and
  location; never silently accept quests. A giver can offer several quests at once.
- Walk to a named NPC, interact using F, touch or a visible button, read the offer,
  accept, perform nearby world interactions, then personally turn in for the shown reward.
  E remains strafe. Journal/dialogue supports keyboard focus, Escape and touch;
  movement input is cleared and suppressed while modal UI owns input.
  Give WorldInput an explicit enabled/input-context seam covering keyboard, pointer,
  wheel and touch, with neutral reads while disabled and focus restored on close.
- Preserve authored objective order where causal: obtain supplies before applying
  them, ask before delivering, make personal choices explicitly. Count unique rescue,
  patient and pickup targets, not repeated clicks on one object. Dialogue choices
  for S04/S05 preserve equal outcomes and rewards.
- Recognize only explicitly allowed persistent early discoveries, with availability
  gates. Ordinary actions require acceptance. Returning to refuge changes position,
  never quest progress. Refresh restores accepted quests, choices and rewards.
- NPCs and patients reuse independent skeleton clones of the approved main character
  through ApprovedWorldCharacter. No newly authored character art is claimed. Place
  named people and readable interaction markers on walkable ground near the refuge.
  Props may use labeled interaction affordances while their bespoke art is absent.
- Show reward balances and completion history in the journal. XP before M03 remains reserved
  for the first class. Reward quantities are prototype tuning, currency remains
  neutrally labeled Currency until the GDD names it. Temporary quest objects occupy
  quest state, never the reward inventory. Unimplemented recovery/food effects are
  described as supplies rather than advertised as working combat effects.
- Carry the authored offer, player reply, follow-up, contextual lines, reminder,
  completion and personal choice branches in structured scenes. Source-complete
  dialogue must be available in play; do not substitute summaries for the script.

M01's supply acquisition can happen before acceptance while the quest is available;
rescues still require acquiring ties and clearing the appropriate branches first.
Early credit materializes only the causally valid sequence, never an unmet prerequisite.
S04's quiet pause is a separate, personal dialogue beat acknowledged with Continue;
it has no real-time timer or reward difference and survives reload as a scene step.
Stationary NPCs need no per-frame animation updates; their source idle clip is static.
Use a bounded NPC set, limit shadows and record full-scene runtime costs.

## Runtime architecture

`src/quests/` owns JSON-safe types, the versioned content catalogue, validation,
eligibility, progress transitions, reward resolution and journal projections. It is
host-agnostic: no DOM, Three.js, storage, clock or network dependencies. The world
adapter owns target positions and validates proximity against authoritative local
explorer state. Rendering only projects quest state. The current host is explicitly
an offline prototype; an online server must validate movement and event provenance.

Browser storage lives in `src/persistence/`, outside the pure quest core. Do not
import the legacy `src/session/` or `src/sim/` into the world route: the existing
`tests/world_terrain.test.ts` guard enforces that isolation.

Player input is an intent (accept, interact, choose, turn in, track), never an award
or arbitrary objective-complete command. Host-produced events identify stable targets.
Personal interactions identify the selected quest and objective, so talking to one
NPC cannot silently advance unrelated dialogue. Unselected ambiguous interactions
are rejected; deliberate shared events use their separate eligibility path.
Commands cannot supply reward amounts, arbitrary classes, prerequisite completion or
unchecked interaction outcomes. No public UI debug button completes quests remotely.

Definitions are immutable published versions, authored in source now and exportable
as JSON. Each contains stable quest ID, revision, category, chapter, prerequisites,
giver/turn-in IDs, objectives, dialogue, reward specification and status. Validate
duplicate IDs, broken references, cycles, invalid counts and main-story dependencies
on optional content. In-progress saves pin definition versions. Unknown future save
schemas/definitions fail visibly without silently overwriting progress.

Character quest state stores accepted definition versions, objective target sets,
choices, persistent discovery flags, tracked IDs, completed IDs, feature unlocks,
reserved XP, per-class XP, reward inventory and immutable completion receipts.
Completing a one-time quest is keyed by character ID + quest ID, not by definition
version, class, attempt or request. The reward transaction validates readiness and
choice, resolves catalogued rewards, records provenance and completion, and adds
balances in one state replacement. Retry yields no second grant. Invalid operations
leave the prior state unchanged. Overflow and malformed numeric rewards fail closed.

Store the complete character snapshot atomically through a repository interface.
The browser adapter uses IndexedDB transactions (or an equally strong tested atomic
store) with revision comparison. Two stale tabs cannot both grant rewards; reload
current state on conflict and tell the player to retry. Failed writes preserve the
last committed state and report a recoverable save error. Persist mutations rather
than relying on page unload. Corrupt/future saves are preserved, never auto-reset.
Provide a memory repository for deterministic tests.
The repository contract is `load(characterId)` and
`commit(characterId, expectedRevision, nextSnapshot)`, returning committed or conflict.
The revision read/check/write happens in one IndexedDB readwrite transaction. Save
schema version is distinct from quest definition version; v1 starts a new namespace
and needs no migration from the legacy demo. Unknown or corrupt raw records stay intact.
The first-zone aggregate is the sole save for this route, not a second store for
legacy sim characters. Its XP and supply rewards are prototype progression records;
they do not alter the disconnected legacy combat demo. Future combat must consume
this aggregate or explicitly migrate it before connection. Retain supported historical
definition versions in the shipped library; changing the current release must not
remove a pinned definition. Unsupported older data requires an explicit migration.

No live multiplayer is introduced. Define and test shared-event eligibility at the
pure boundary: only host-qualified nearby participants with accepted quests, prerequisites and matching
objectives receive shareable credit. Personal dialogue, choices and turn-ins never
share; persistent early discoveries remain character-local. Completed quests remain
completed across class changes. Future first-class assignment transfers pending XP
exactly once and selects that class. Subsequent quest XP credits the active unlocked
class; a receipt records which class received it, or null for pre-class rewards.
Class assignment and switching are trusted integration functions, not player quest
commands or a new class-selection UI. No reward command can unlock an arbitrary class.

## Production database design

Use a quest library in the database, separate from player progress. Source-authored
content is validated and published as immutable versions; database edits do not
silently change an accepted quest. Recommended logical records:

| Record | Identity and responsibility |
| --- | --- |
| quest_definitions | quest_id + version; immutable JSON definition, category, chapter, publication state |
| quest_catalog_releases | release_id; exact published version selection and content checksum |
| character_quests | character_id + quest_id; pinned version, status, objective state, choices, revision |
| character_discoveries | character_id + discovery_id; bounded named persistent discoveries |
| quest_reward_grants | character_id + quest_id unique; completion receipt, resolved rewards, class, provenance |
| character_progression | character_id; pending XP, class XP, feature unlocks, revision |
| character_inventory / wallet | character-owned reward assets and currency; item provenance references grant |

The future authenticated server derives character ownership from the session,
loads the pinned definition, and validates intents/world events. Turn-in locks the
character progression row, checks readiness, inserts the unique grant, updates
inventory/wallet/XP and completion in one DB transaction. Publish versions rather
than overwriting rows; explicit content migrations handle removed objectives or
retired quests. A definition update never resets the one-time grant key. Replays
will use a separate activity reward policy and cannot reopen story grants.

This delivery documents that production schema and implements the repository
contract locally; it does not deploy a service, accounts or production database.

## Acceptance checks

- Headless end-to-end M01/M02 completion in either order, plus each S01–S05, through
  real intents and world targets; side quests are never required for M03 eligibility.
- Full 30-entry catalogue graph validation, planned-content rejection and correct
  bundle prerequisites. Red-before-green tests demonstrate new behavior.
- Out-of-range, wrong NPC, premature, duplicate target, repeated turn-in, wrong
  choice, wrong character, stale revision and malformed save/reward rejection.
- Validate actual target positions against bounds, river, solids and a traversable
  route from spawn. Pin implemented objective ordering and required scene slots.
- Save/reload preserves all progress; concurrent stale turns and failed writes do
  not duplicate or partially grant rewards. Pre-class XP transfers once in pure tests.
- Shared eligible objective credit and personal-choice isolation in headless tests.
- Typecheck, complete Vitest suite and production build; independent full-diff review.
- Chrome visual/runtime verification: clones visible, both categories readable,
  accept/objective/turn-in/reload loop, narrow and desktop layout, no runtime errors.
- Durable private Tailnet preview and PR with exact validation boundaries. No public
  playable deployment, combat rebalance, new final class roster or dungeon fiction.

## Delivery verification

On 2026-09-12, independent review found no unresolved findings after correction.
`npm run typecheck && npm test -- --maxWorkers=1 && npm run build` passed:
68 test files, 1001 tests passed and one existing test skipped. All seven playable
quests complete through headless intents; the remaining catalogue entries reject
acceptance. `npm run site:test && npm run site:build` also passed (19 site checks).

Chrome walkthroughs completed M01, M02, S01 and S04 through movement, visible
interactions, dialogue and reward claims. Reload preserved completion rewards and
S04's personal choice. Desktop (1200 × 744) and narrow (390 × 844) views showed
separate quest categories; tracking/untracking and reverse keyboard focus were
checked. S02, S03 and S05 were covered headlessly, not by a full Chrome walkthrough.

At the fresh refuge spawn, the 1200 × 744 scene reported 51 draw calls and 3,334,286
triangles, versus the terrain-only baseline's 22 and 2,887,972. A 240-frame diagnostic
sample averaged 3.70 ms of CPU frame work, with a 5.40 ms p95 and no runtime errors.
These timings are local CPU diagnostics, not GPU time or a device FPS guarantee.
Placeholder character clones add visible render cost; final NPC art and production
performance tuning remain separate work.

## Research lessons

Both games' official UI documentation distinguishes campaign/main quests from other
quests: [FFXIV game manual](https://na.finalfantasyxiv.com/game_manual/view/) and
[WoW quest UI update](https://worldofwarcraft.blizzard.com/en-us/news/24117139).
Ashveil uses category labels and shapes consistently across giver, journal and tracker.

[FFXIV side-reward feedback](https://forum.square-enix.com/ffxiv/threads/508033-Side-Quests-XP-is-a-joke)
shows disagreement over optional reward value, while
[WoW routing feedback](https://www.reddit.com/r/wow/comments/k4eznm/)
describes repeated-travel friction. These are qualitative anecdotes, not consensus
or evidence of current bugs. Preserve the authored outing bundles, early-discovery
credit and optional reward usefulness; exact XP and economy balance remain open.
The cost is more explicit objective policy and content validation. Do not import
WoW's historical Party Sync reward/reset rules: Ashveil's character-once story grants
and personal dialogue remain the decided contract.
