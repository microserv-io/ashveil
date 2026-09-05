# Ashveil game design document

Ashveil is a social MMORPG set in a vivid, painterly mythic-fantasy world being
slowly consumed by ash. This public document is the first complete pass over that
direction. It records current decisions, leading directions and open questions; it
is not a promise that every described system has entered production.

Final Fantasy XIV, World of Warcraft and recurring player requests around those
games are research inputs. Ashveil can learn from their durable group play,
approachable matchmaking, expressive characters and long-lived communities without
copying their worlds or adopting every familiar feature.

Architecture and implementation details live in
[architecture.md](https://github.com/microserv-io/ashveil/blob/main/docs/architecture.md).
This document owns the intended player experience.

## How to read and maintain this document

| Status | Meaning | Implementation rule |
| --- | --- | --- |
| **Decided** | The current design. | Features must match it. Change the GDD when the design changes. |
| **Direction** | The leading hypothesis, still requiring validation. | Explore it without treating it as final. |
| **Open** | A material choice has not been made. | Do not silently turn a convenient default into a commitment. |

The headings cover the whole game at planning depth. Detail is added as decisions
are made. Git retains history; this page describes the current truth.

Before proposing or settling an Ashveil design decision, research both World of
Warcraft and Final Fantasy XIV player feedback and long-standing requests, then
verify each game's current official behaviour because an older request may already
have shipped. Cite the evidence; distinguish recurring concerns supported across
sources from anecdotal requests; and record the lesson adopted, its tradeoff and any
conflict that remains open. This process informs decisions rather than overruling a
settled Ashveil choice without a concrete reason.

The Design references section records the evidence gathered so far; it does not show a completed
two-game review for every linked topic. Each decision still requires research into
both games' player feedback and current official behaviour before dependent details
are settled. Earlier decisions remain current while that review is pending.

## Product foundation

### Decided

- **Genre.** Ashveil is an MMORPG: a persistent shared world built around character
  growth, cooperative adventure and communities that make people want to stay.
- **Social staying power.** Social play includes the quiet time between objectives.
  Systems should help players meet, recognise one another, form lasting groups and
  enjoy simply inhabiting the world together.
- **One hero, every class.** One character can learn and play multiple classes. The
  equipped weapon determines the active class, so changing combat roles does not
  require an alternate character.
- **Alts are different lives.** Alternate characters are for another identity,
  race, story perspective or social life. They are expressive choices, not the
  required route to another class.
- **A social foundation.** Housing, neighbourhoods, crafting and player markets are
  parts of the intended game, not optional ideas outside its core.

### Direction

- Combine the comfort of a long-lived social home with clear adventures that work
  for established groups and matchmade players.
- The player promise is a beautiful world worth belonging to and defending as the
  Veil drains colour, motion and life from familiar places.
- Learn from World of Warcraft's breadth and continuity and Final Fantasy XIV's
  character continuity, story-led unlocks and welcoming group structure.

### Open

- Primary audience, session-length targets, launch scope and the single message
  that should lead public positioning.
- The balance among authored journeys, repeatable activities and player-created
  reasons to remain in the world.

## Design references

These are precedents for research, not blanket adoption.

- Final Fantasy XIV's official manual documents weapon- or tool-defined classes and
  enhanced rewards for random unlocked duties. Ashveil uses these as precedents,
  with the first weapon chosen through its introduction rather than at character
  creation: [classes](https://na.finalfantasyxiv.com/game_manual/start/)
  and [Duty Roulette](https://na.finalfantasyxiv.com/game_manual/pp/).
- World of Warcraft's
  [Warbands](https://worldofwarcraft.blizzard.com/en-us/news/24107633) are a useful
  precedent when studying convenience across alternate characters. They do not
  decide which Ashveil unlocks become account-wide.
- A Final Fantasy XIV player request asks for useful non-experience rewards when
  capped players run roulettes. It is an anecdotal example supporting research into
  max-level incentives, not evidence of prevalence:
  [forum request](https://forum.square-enix.com/ffxiv/threads/517396-Better-New-Rewards-in-Dungeon-Roulettes-for-people-with-maxed-out-Jobs).
- Official housing differs: World of Warcraft describes broad access without a
  lottery or onerous upkeep, while Final Fantasy XIV documents limited plots and
  lottery purchase. These frame Ashveil's availability decision rather than choosing
  it: [WoW housing](https://worldofwarcraft.blizzard.com/en-us/news/24230692) and
  [FFXIV land purchase](https://na.finalfantasyxiv.com/lodestone/playguide/contentsguide/housing_land/).
- Two anecdotal discussions expose the housing-economy tradeoff: an FFXIV player
  asks for more reasons to craft and earn after major purchases, while WoW players
  debate exclusionary costs against cheap basics with costly long-term projects.
  They support accessible participation plus aspirational system-paid upgrades as a
  direction, not a claim of consensus or a substitute for Ashveil's economic data:
  [FFXIV example](https://forum.square-enix.com/ffxiv/threads/479602) and
  [WoW example](https://us.forums.blizzard.com/en/wow/t/why-make-housing-so-costly/2207426).

## World, story and exploration

### Decided

- **Emotional register.** Ashveil is vivid, painterly mythic fantasy with warmth,
  nature and wonder under threat, rather than a uniformly grey or gory world.
- **The contrast is the identity.** Life is colourful, tactile and moving. Ash
  drains colour, stills the environment and makes familiar forms unnatural.
- **Ash fog of war.** Unexplored space becomes ash-grey rather than receiving a
  generic black mask.
- **Story unlocks the game.** Features open through quests across the main story,
  giving new systems a place in the world and teaching them as the journey expands.

### Direction

- Regions should feel lived in before they feel like content maps: settlements,
  routes, local concerns and recurring people provide context for adventure.
- Exploration reveals places, stories and shared activity while making the boundary
  between life and ash visually meaningful.
- Classic hand-painted animated fantasy is an emotional reference for wonder,
  melancholy and expressive movement. Ashveil retains its own cultures and forms.

### Open

- History, cultures, factions, player role, central conflict, main-story structure
  and treatment of branching or replayable narrative.
- Whether revealing ash only exposes the world or restores its colour and life; how
  unexplored, previously explored and currently visible territory differ.
- World topology, region count, zone boundaries, density, environmental interaction,
  secrets and exploration rewards.
- How story-gated features preserve a new player's ability to join friends early.
  Individual skills are not assumed to require story unlocks.

## Characters, races and classes

### Decided

- **Multiple playable races.** Character creation offers more than one race.
- **No class selection at creation.** The introduction leads to a first class choice
  by letting the player choose a weapon. Follow-up quests award the first useful
  gear set for that class.
- **Weapon switches class.** A character's equipped class weapon selects their
  active class. One character can progress multiple classes.
- **Separate class levels.** Each class has its own level progression. Completed
  quests stay completed when the character switches class; leveling another class
  uses its class quests, dungeons and optional quests that character skipped.

### Direction

- Name, relationships, appearance, history and reputation stay with the hero while
  combat tools and class progression change with the weapon.
- The first weapon choice should be informed and reversible, with enough context to
  understand its class fantasy before investing substantial time.

### Open

- Race roster, count, traits, cultures, starts and whether race affects gameplay.
- Character-creation depth, body options, identity settings and later appearance
  changes.
- Class roster, class-quest structure, switching restrictions, loadouts and
  equipment behaviour across classes.
- Which story, cosmetic and system unlocks belong to a character or account, and how
  they behave on optional alts.

## Combat, camera and controls

### Decided

- **Group roles.** Cooperative combat uses tank, healer and damage roles. Exact
  party composition and sizes remain open.
- **Hybrid combat.** Combat combines targeted MMORPG structure with active aiming or
  action elements. The exact targeting model is not yet decided.
- **Freely controlled third-person camera.** Normal MMORPG play uses a third-person
  camera that the player can rotate freely.
- **Readability before spectacle.** Effects can be striking but cannot obscure
  actors, hazards, targets or telegraphs.

### Direction

- Combat should be immediately readable and responsive, with depth that rewards
  mastery without requiring outside tools for basic competence.
- Encounters should reward coordination and recovery together rather than making
  other players feel like interchangeable damage sources.
- Bold ground shapes, restrained effect layers and strong silhouettes carry combat
  information.

### Open

- Exact camera pitch, distance, field of view, zoom range, collision and recentering.
  The prototype's elevated three-quarter camera is historical only.
- The boundary between target selection and active aim; action cadence, resources,
  ability counts, movement during actions, interrupts and crowd control.
- Party composition, role flexibility, class balance and switching around queued or
  active content.
- Keyboard, mouse, controller, handheld and accessibility controls; rebinding and
  assistance for each.
- Occlusion, effect-density settings, telegraphs and handling large cosmetics in
  combat.

## Progression, equipment and appearance

### Decided

- **Early gear starts simple.** Early leveling equipment has restrained shapes and
  materials. Each rarity step becomes more visually appealing: blue looks cooler
  than green, while purple and higher rarities begin to feel distinctly unique.
- **Looks grow with achievement.** Equipment becomes more impressive over time. The
  most premium-looking gear comes from harder content, making accomplishments
  visible in the world.
- **Transmog and recolouring.** Players preserve earned appearances separately from
  current equipment and can recolour supported appearances.
- **Readable modular gear.** Distinct pieces form a coherent character. Cosmetic
  value cannot depend on becoming progressively larger, brighter or obstructive.

### Direction

- Power and visual status should grow together often enough that upgrades feel
  tangible, while transmog preserves personal identity.
- Headwear, hair, shoulders, back pieces, torso layers, weapons and off-hands are
  promising zones because they change silhouette or colour blocking.
- Present appearances at gameplay distance, in social spaces and in a close
  character view.

### Open

- Level cap, pace, horizontal versus vertical growth, account-wide progression,
  attributes, talents and catch-up systems.
- Item statistics, slots, final rarity names, set bonuses, upgrading, durability,
  binding, storage and bad-luck protection.
- Transmog collection, recolour acquisition and consumption, outfit storage and
  restrictions; whether cosmetic unlocks are character- or account-wide.
- How hard-content visual prestige coexists with a worthwhile identity for expert
  crafters.

## Quests, groups and PvE

### Decided

- **Level-sync dungeon finder.** The finder scales higher-level players down to the
  selected dungeon so they can meaningfully play with progressing players.
- **Keep early queues alive.** Max-level players receive useful rewards for using
  the finder, keeping lower-level queues healthy for newcomers.
- **Content creates currency.** Quests and activities such as world events and
  dungeons introduce currency into the economy.

### Direction

- Matchmaking should reduce waiting and social friction while preserving room for
  conversation, cooperation, appreciation and continued groups.
- Old group content should remain worth revisiting where practical, helping friends
  play together across progression gaps.
- Main, regional and class quests teach systems in context instead of opening a wall
  of menus at creation.

### Open

- Quest types, sharing, presentation, density and repeatable or daily tasks.
- Dungeon structure, party size, difficulty modes, checkpoints, rewards, exact
  level-sync math and max-level incentives.
- Which skills remain available when synced down, how class progression is treated
  and how item statistics scale.
- Trials, raids, world bosses and public events, including group sizes and schedules.
- Loot allocation, role shortages, premade versus matched rewards, replacement
  players, mentoring and protections against disruption.

## PvP

### Open

- Whether Ashveil includes PvP; if so, its formats, access, rewards, ranking, class
  balance and separation from PvE progression.
- Whether world PvP exists and which consent, population and anti-griefing rules it
  would require.

## Crafting, gathering and the economy

### Decided

- **A world-specific currency.** Ashveil uses its own named money rather than
  generic gold, silver and bronze. Its name and denominations remain open.
- **No pocket money or trash loot.** Mobs drop neither currency nor items whose only
  purpose is sale to a vendor.
- **Currency enters through participation.** Quest rewards and completed content,
  including world events and dungeons, create new currency.
- **Crafting drives player income.** Players make money through crafting and trade
  around useful crafted output. Crafting transfers currency between players; it
  does not create currency by itself.
- **Player markets.** Players have a market through which crafted goods and other
  allowed items can be exchanged.
- **Long-term economy health.** Keeping the custom currency useful and the player
  economy healthy over the game's lifetime is a core design requirement.

### Direction

- Gathering, production and trade create interdependence and respected social roles
  outside combat.
- Removing trash drops should clarify rewards rather than make combat unrewarding.
- Currency sources and sinks should be legible enough to understand how content and
  trade sustain the economy.
- Track currency created and removed, representative prices and wealth distribution
  over time so economic changes respond to evidence rather than guesswork.

### Open

- Currency name, denominations, wallets, caps, account sharing and additional
  currencies, if any.
- Crafting and gathering professions, recipes, quality, specialisation, work orders,
  progression, materials and crafted endgame equipment.
- Direct trade and market shape, taxes, listing limits, price history, regional
  markets and protection against manipulation, bots and real-money trade.
- Vendor roles, repair or other sinks, scarcity, salvage and exactly which
  meaningful items or materials enemies drop.
- Sustainable currency-flow ranges, intervention thresholds and which additional
  sinks are appropriate as player wealth and the world mature.

## Travel and the physical world

### Decided

- **Paid fast travel.** Quick travel or teleportation costs the standard currency,
  providing convenience and a recurring currency sink.

### Direction

- Travel should preserve distance while making it practical to join friends and
  scheduled activities.

### Open

- Fast-travel discovery, destinations, prices, cooldowns, group travel and returns;
  how it stays affordable before a player has meaningful crafting income.
- Mounts, movement abilities, transit, mount collection and whether flight or an
  equivalent ever exists.
- World size, loading boundaries, server population model and finding friends across
  copies of a location.

## Social life, housing and community

### Decided

- **A place to belong.** Social systems support organised achievement and
  low-pressure time together, with reasons to remain after an immediate reward.
- **Identity continuity.** One-character, many-class play keeps friendships,
  recognition and reputation attached to the character players inhabit.
- **Housing and neighbourhoods.** Player housing exists within neighbourhoods and is
  part of the social world.
- **Housing removes currency.** Housing must provide meaningful system-paid
  custom-currency sinks. Money paid to another player for crafted furniture changes
  hands instead of leaving the economy.

### Direction

- Help good groups persist through clear presence, easy regrouping, appreciation and
  ways to continue after matched content.
- Social spaces support conversation, appearance, performance, crafting and
  spontaneous activity rather than acting only as menu lobbies.
- Housing and neighbourhoods should make player creativity and nearby community
  visible, with meaningful connections to crafting and markets.
- Use Final Fantasy XIV-style residential neighbourhoods as the current reference
  for visible homes in a shared social district, without adopting its availability
  or acquisition rules by default.
- Give players an obtainable base home, with aspirational paid expansion,
  renovation, neighbourhood improvements and optional services providing reasons
  to spend beyond the first purchase. These are candidate system-paid sinks, not
  approved fee implementations.
- Let players choose a neighbourhood near friends where the population model allows,
  rather than separating housing from established relationships.
- Preserve a player's home and layout across breaks from the game so housing supports
  durable belonging rather than punishing absence.
- Keep crafted furniture and housing upgrades desirable within the player market,
  while system fees provide the part of housing spend that removes currency.

### Open

- Friends, parties, communities, guilds, guild progression, calendars, recruitment,
  alliances and group-finding tools.
- Text, voice, emotes, performance, status, inspect, commendation and privacy.
- House access model, ownership, limits, pricing, availability, decoration,
  permissions and shared or guild housing.
- Exact purchase and upgrade fees, payment cadence, and whether rent or taxes exist.
  No recurring charge, foreclosure rule or fixed price is implied by this draft.
- Whether neighbourhoods are public, private or mixed; their population, persistence
  and relationship to world servers.
- Mentoring, newcomer identity, cross-server relationships and offline contact.
- Moderation, reporting, blocking, chat filtering, naming, anti-harassment and
  community governance.

## Failure, recovery and onboarding

### Direction

- Failure should create stakes and learning without making players regret grouping
  with newcomers.
- Onboarding reveals complexity through story quests and practical use. The first
  weapon and gear quests establish the initial combat path.

### Open

- Death, revival, checkpoints, corpse recovery, repair or other penalties, combat
  resurrection and wipe recovery.
- Tutorial length, returner support, practice, role training, assistance and how a
  player changes a mistaken first weapon choice.
- Accessibility targets for vision, hearing, motor and cognitive needs; interface
  scaling, colour controls, subtitles, reduced motion, remapping and alternatives
  for combat information.

## Endgame and live world

### Direction

- Endgame should keep several play styles relevant: group challenge, collecting,
  crafting, markets, housing, social projects and revisiting the wider world.
- Updates should strengthen the shared world rather than turn each season into a
  disposable replacement.

### Open

- Endgame pillars, difficulty progression, reward resets, catch-up, seasonal or
  expansion structure and protection against required repetitive chores.
- Release cadence, events, maintenance, server lifecycle, legacy-content support and
  how player feedback changes this living GDD.
- Collections, achievements, reputation, completion goals and long-term rewards.

## Business model, platforms and online service

### Decided

- **Traditional access.** Players must be able to discover, install and play Ashveil
  through a traditional game experience without requiring wallet or blockchain
  knowledge.

### Direction

- Web3 was previously intended as part of the commercial model, initially favouring
  cosmetic expression and provenance over gameplay power. That intent is under
  review for the MMORPG and does not approve an implementation or economy.

### Open

- Box price, subscription, trial, expansions, cosmetic store or other funding;
  regional pricing and protection for earned visual prestige.
- Launch platforms, hardware targets, cross-play, cross-progression, input pools,
  distribution and minimum online-service commitments.
- Accounts, authentication, naming, portability, support, security, privacy and
  parental controls.
- Whether Web3 remains part of Ashveil. If retained, ownership, assets, wallets, custody,
  markets, regulation, environmental impact and separation of cosmetics from power
  all need explicit decisions.

## World and art direction

### Decided

- **Original identity.** Ashveil must not imitate another studio's signature
  characters, architecture or visual language.
- **Visibility creates value.** Important appearance rewards are recognisable in
  ordinary play, not only through tiny inventory-screen texture differences.
- **Bald canonical mannequin.** The current humanoid production body has a complete
  bald scalp. Hairstyles are separate cosmetic content.
- **Items outlive body shapes.** Equipment identity and gameplay data remain
  independent from fitted meshes, so another visual fit can represent the same item.

### Direction

- Use deliberate low-poly forms with anime-adjacent clarity: clean planes,
  simplified anatomy, strong silhouettes, expressive poses and readable clothing.
  Avoid chibi proportions and generic anime-gacha presentation.
- Combine hand-painted-looking colour with broad material reads. Cream stone,
  timber, ceramics, cloth, weathered metal, plants and powdery ash form the current
  material family; their cultural use remains undefined.
- Scenes should resemble moving fantasy illustrations at gameplay distance while
  remaining tactile and coherent 3D up close.
- Warm gold is a promising read for player agency and controlled cyan-violet for
  Veil danger. Soften the visible ash boundary with particles and muted motion.

### Open

- Final rendering, palette, environment grammar, race and culture visual languages,
  creature transformations, interface art and final art bible.
- How multiple races and body options fit the canonical rig and equipment pipeline.
  Current body tooling does not limit the playable roster or decide its fit strategy.
- Audio direction, music, ambience, voice, combat and interface sound, accessibility
  alternatives and production scope.

## Open production proposals

These open pull requests are proposals, not approved design. They live here so the
web page and downloadable GDD share one maintained source.

### Open proposal: painterly rendering (PR #32)

[PR #32](https://github.com/microserv-io/ashveil/pull/32) proposes hand-painted
colour under a soft three-step toon ramp, flat hemisphere fill and gentle key light.
It keeps broad material reads and avoids photoreal micro-detail and hard outlines.
The implementation and exact lighting remain open pending MMORPG camera and
performance review.

### Open proposal: canonical-body gear production (PR #35)

[PR #35](https://github.com/microserv-io/ashveil/pull/35) proposes generating gear
on a canonical body, then extracting, seating and transferring skin weights instead
of fitting standalone geometry afterward. It proposes authored regions for hiding
covered skin, plus short spring-bone chains and body colliders for capes, sashes and
pauldron drapes as presentation only. Automated gates remain narrow technical checks;
project-owner visual acceptance is required for every fitted asset.

The proposal does not decide race roster, body count, class gear rules or final fit
strategy. Its detailed production plan remains in the open PR pending review.

## Technical production baseline

This compact baseline preserves production constraints without turning the old
prototype into MMORPG design.

### Decided

- **Tripo is model generation only.** It is the only paid pipeline tool. Its rig and
  Smart Animate output were tried and rejected as broken.
- **Procedural motion.** Gameplay animation is agent-authored from replicated sim
  state and time through semantic joints. No gameplay clips are currently
  downloaded, retargeted or hand-keyed.
- **No hosted motion services or non-commercial training data.** Commercial motion
  models and GPU auto-riggers are optional future upgrades behind the same seam.
- **Versioned skeleton contracts.** Every family has a schema and body manifest. At
  least humanoid and quadruped families must prove the pipeline.
- **Canonical rig baseline.** Compatible humanoid fits share height, joints, bind
  pose and skeleton. This technical reuse baseline does not decide that launch has
  two bodies or constrain playable races.
- The earlier production target was two canonical masculine and feminine humanoid
  launch fits. That target is now under review against the multiple-race decision.
- **Ashveil owns rigging.** A Blender landmark fitter places the skeleton, computes
  weights and fails closed. Auto-Rig Pro is benchmark-only because needed features
  lack a supported headless API.
- **Humanoid entry gate.** A body needs explicit scale, applied transforms, semantic
  components, recorded topology, neutral upright stance and deformation-ready knees
  and elbows before rigging.
- **Committed lineage.** Commit concepts, raw generated output, contracts, manifests
  and runtime GLBs; omit reproducible intermediates. KayKit remains fetched, pinned
  and checksummed.
- **Approval before production.** Game assets normally begin with an approved image
  or multi-view concept. Generated output passes visual, technical, licensing and
  runtime review; completed automation does not make it canonical.
- **Traceable derivatives.** Preserve immutable raw, editable source and validated
  runtime derivatives. Judge source topology as editable geometry and runtime GLBs
  by triangulated metrics.

### Direction

- Pipeline stages are concept, generate, normalise, rig, profile and verify. Human
  review gates concept and final visuals; scripts validate scale, orientation, mesh
  health, skeleton, budgets, textures and pose coverage. See
  [pipeline.md](https://github.com/microserv-io/ashveil/blob/main/docs/pipeline.md).
- Reuse approved proportions and skeletons. Keep gear and hair modular. Rigid pieces
  use sockets; deforming pieces share bind-pose contracts and may need body fits.
- The axis-cropped armour proxy failed. Production body masks and fit cages require
  authored slot boundaries with representative pose and clipping tests.
- Hairstyles remain separate. Compatible fits share a scalp envelope, hairline and
  socket; longer styles need secondary motion and explicit collision behaviour.
- Curate generation before automating paid calls. Record asset identity, GDD link,
  provenance, settings, tool version, licence, derivatives, family and validation.
- Current sequencing validates the motion seam, locomotion, a quadruped proof,
  Ashveil's humanoid and procedural skill poses in that order.

### Open

- Measured polygon, material, texture, animation and LOD budgets for the selected
  camera, platforms and representative MMORPG crowds.
- Source height and renderer scaling; axes, origin, anatomical naming; neck/wrist
  seams; source-object and runtime-mesh consolidation.
- Generation repeatability across body and hairstyle fits: topology, UVs, textures,
  materials and modular seams.
- Body-mask and armour-cage method; whether later fits use authored meshes,
  corrective shapes or controlled deformation.
- Licensing and provenance controls; quadruped semantic mapping; performed hero
  motion; optional GPU upgrades.
- Re-measure the neck gap on the next body. The current body measured up to 14.77 mm
  at rest and about 37 mm in motion, with no second-body confirmation.
- Re-measure knee deformation. The current knee patch reached a minimum
  triangle-area ratio near 0.073, unconfirmed elsewhere.

## Historical action-RPG prototype

The repository contains a playable isometric action-RPG prototype. Its historical
loop was: pull a pack, spend skills, kill enemies, collect loot, grow stronger and go
deeper. It uses an elevated three-quarter camera, direct movement, precise aiming,
procedural areas, item affixes, a passive tree and deterministic combat simulation.

That prototype remains evidence for architecture, controls, rendering, animation
and performance. Its camera, combat cadence, loot volume, progression, skills,
encounters, economy and Diablo/Path of Exile positioning are not MMORPG commitments.
Any reused system must be reviewed against the decisions and questions above.
