# Ashveil game design document

This is Ashveil's living design contract. It records the rules that product and
implementation must agree on without pretending undecided areas are settled.
Architecture and implementation details belong in
[architecture.md](architecture.md); this document owns the intended player
experience and the design constraints that produce it.

## How to read and maintain this document

Every statement that can constrain a feature has one of three statuses:

| Status | Meaning | Implementation rule |
| --- | --- | --- |
| **Decided** | The current design. | Features must match it. Change the GDD in the same PR if the design changes. |
| **Direction** | The leading hypothesis, still requiring a spike or validation. | Prototype against it, but do not build costly dependencies on it as if it were final. |
| **Open** | A real decision that has not been made. | Do not silently turn it into a default. Resolve it before dependent implementation. |

The GDD is deliberately incomplete. It should gain detail when a decision is being
made, not when somebody wants a template to look full. Git and PRs retain the
history; the document describes the current truth.

When a feature changes a player-facing rule, its PR must:

1. identify the relevant GDD statement;
2. implement and test the feature against that statement; and
3. update this document in the same PR if the rule itself changed.

## Product foundation

### Decided

- **Genre and loop.** Ashveil is an action RPG in the Diablo and Path of Exile
  lineage. Its core loop is: pull a pack, spend skills, kill enemies, collect loot,
  become stronger, and go deeper into harder content. Features that do not improve
  or support that loop are secondary.
- **Traditional access and Web3.** Players must be able to discover, install and
  play Ashveil through a traditional game experience. Web3 is also intended to be
  part of the commercial model; traditional access may not be held hostage by
  wallet knowledge or blockchain interaction.
- **Design before scale.** The combat-and-loot loop must be worth repeating before
  endgame scale, economic complexity or content volume can justify themselves.

### Direction

- **Market position.** Compete through readable depth rather than greater system
  clutter: reactive combat, meaningful loot, approachable presentation and a world
  with an identity outside the genre's usual grimdark range.
- **Player promise.** A vivid world worth caring about is being swallowed by ash;
  the player pushes into the unknown, wins readable action-RPG fights, and becomes
  visibly and mechanically more powerful.
- **Differentiation hypothesis.** The strongest current combination is painterly
  wonder, ash-driven exploration, clear combat and visibly expressive equipment.
  This must be validated against real players rather than treated as a marketing
  claim.

## Camera and combat presentation

### Decided

- **Core camera.** Normal gameplay uses an elevated three-quarter, top-down ARPG
  camera. Close third-person and over-the-shoulder framing are rejected for the core
  game.
- **Tactical readability.** The camera must show enough space to read enemy packs,
  movement routes, attack telegraphs, area skills and loot without sacrificing the
  world's vertical depth.
- **Combat information before spectacle.** Effects may be striking, but may not
  obscure actors, hazards or telegraphs. Enemy silhouettes must remain separated in
  ordinary encounters.
- **Equipment at gameplay distance.** Important outfit pieces and weapons must be
  identifiable through silhouette, colour or material at the normal camera distance.

### Direction

- Keep the camera mostly stable during combat while allowing presentation to become
  closer in safe social spaces or dedicated character views.
- Use bold ground shapes and restrained effect layers so combat remains legible
  against colourful environments.
- Preserve direct movement and precise aiming as meaningful sources of combat skill;
  validate their feel with the elevated camera before expanding the combat system.

## World and art direction

### Decided

- **Emotional register.** Ashveil is a vivid, painterly mythic fantasy with warmth,
  nature and wonder under threat. It is not a uniformly grey or gory grimdark world.
- **Original identity.** Classic hand-painted animated fantasy is useful as an
  emotional reference—natural wonder, melancholy and expressive movement—but the
  game must not imitate another studio's signature characters, architecture or
  visual language.
- **The contrast is the identity.** Life is colourful, tactile and in motion. Ash
  drains colour, stills the environment and makes familiar forms feel unnatural.
  Darkness is created by contrast with remembered beauty.
- **Ash fog of war.** Unexplored space is represented by the world becoming
  ash-grey, not by a generic black mask.

### Direction

- **Model language.** Use deliberate low-poly forms with anime-adjacent clarity:
  clean planes, simplified anatomy, strong silhouettes, expressive poses and large
  readable clothing shapes. Avoid chibi proportions and the presentation language
  of a generic anime gacha game.
- **Surface language.** Hand-painted colour under a three-step toon ramp, a flat
  hemisphere fill and a soft key, so the authored base colour survives lighting.
  Prefer broad material reads over photoreal micro-detail or hard outlines.
- **Production target.** At gameplay distance the scene should resemble a moving
  fantasy illustration; on closer inspection it should remain tactile, coherent 3D.
- **World materials.** Cream stone, timber, ceramics, woven cloth, weathered metal,
  vegetation and powdery ash are the current material family. Their cultural use is
  not yet defined.
- **Effect language.** Warm gold currently reads well for player agency and a
  controlled cyan-violet accent reads well for Veil danger. This is a promising
  readability scheme, not yet a final palette lock.
- Let the ash boundary remain partially visible through softened geometry, drifting
  particles and muted motion so revealing territory feels like colour and life
  returning.

## Equipment, cosmetics and Web3

### Decided

- **Visibility creates value.** Cosmetic and owned equipment must be recognisable in
  ordinary play, not only on an inventory screen. Tiny texture changes cannot carry
  the main value of an item.
- **Modular presentation.** Characters must support visibly distinct outfit and
  equipment pieces while still reading as one coherent character.
- **One rig, two launch fits.** Initial production targets canonical masculine and
  feminine humanoid body models with the same height, joint placement, bind pose and
  skeleton. Every wearable piece must fit and animate on both before additional body
  shapes enter scope.
- **Bald canonical mannequins.** Each canonical body must include a complete bald
  scalp. Hairstyle geometry is separate cosmetic content, not part of either body.
- **Items outlive body shapes.** Equipment identity, ownership and gameplay data
  must remain independent from its fitted mesh. A future brute, slim or other body
  archetype may supply another visual fit without becoming a different item.
- **No readability arms race.** Cosmetic value may not depend on pieces becoming
  progressively larger, brighter or more obstructive. Gameplay silhouettes,
  telegraphs and actor identification take precedence.

### Direction

- Prioritise cosmetic zones that can change silhouette or colour blocking at the
  elevated camera, such as headwear and hair, shoulders, back pieces, torso layers,
  weapons and off-hands.
- Author wearables against both canonical body mannequins. Rigid pieces should use
  shared named skeleton sockets; deforming clothing should share the canonical bind
  pose and skeleton while allowing a fitted mesh per body. Covered body regions
  should be maskable, and every piece should pass clipping checks across
  representative gameplay animations on both bodies.
- Treat the axis-cropped armor proxy as a failed fitting experiment, not a reusable
  production method. Body masks and armor-fit cages need authored slot boundaries
  plus representative pose and clipping tests; the final fitting method remains
  open.
- Treat hairstyles as modular cosmetics rather than permanent body geometry. Both
  canonical bodies should share a compatible scalp-envelope fit, hairline and head
  socket so one hairstyle asset can serve either fit where its silhouette allows.
  Short styles may follow the head rigidly; longer styles need controlled secondary
  bones and explicit compatibility behaviour for helmets, back pieces and weapons.
- Present cosmetics at three useful scales: normal gameplay for recognition, social
  or hub spaces for status, and a character view for appreciation.
- Make Web3 optional in the moment-to-moment user experience and initially favour
  cosmetic expression and provenance over gameplay power. This requires a formal
  economy decision before implementation.

## AI-assisted asset and animation pipeline

### Decided

- **Tripo is model generation only.** It is the pipeline's only paid tool, used to
  generate the source mesh. Its rig and Smart Animate features were tried and
  rejected: both produced broken output.
- **Animation is agent-authored procedural motion.** Gameplay animation is generated
  at runtime from replicated sim state and sim time, targeting semantic joints that
  each skeleton family resolves to its own bones at bind time. No clips are
  downloaded, retargeted or hand-keyed for gameplay, because that is the only path
  that is fully agent-producible and licence-clean by construction.
- **No hosted motion services, no non-commercial training data.** Commercially
  licensed motion models and GPU auto-riggers were evaluated and are acceptable only
  as optional upgrades behind the same seam if a GPU budget ever exists; today the
  constraint is inference-only cost.
- **Every skeleton family has a versioned contract**, split into a family schema
  (semantic roles, hierarchy, axes, limits, sockets) and a per-body manifest (fitted
  rest, inverse binds, hashes). At least two families — humanoid and quadruped — must
  go through the same pipeline before the design counts as achievable, since one
  family proves nothing about the seam.
- **Rigging is Ashveil's own tooling.** A Blender landmark fitter places the contract
  skeleton and computes automatic weights, and it fails closed on the asset gates.
  Auto-Rig Pro is a benchmark only, never in the automated path, because it has no
  supported headless API for the features that would matter.
- **Humanoid rigging has an entry gate.** A generated humanoid cannot enter rigging
  until it has an explicit scale, applied transforms, validated semantic components
  and a recorded topology report.
- **Assets in the repository.** Concept images, raw Tripo output, skeleton contracts
  and manifests, and runtime GLBs are committed; regenerated intermediates are not,
  because anything a script reproduces should not bloat the repo. KayKit stays
  fetched, pinned and checksummed.
- **Concept approval precedes production generation.** Text-to-3D is useful for
  disposable exploration. Assets intended for the game should normally begin with
  an approved image or multi-view concept so silhouette and art direction are
  controlled.
- **Agent image generation.** Agent-driven image generation creates and refines the
  2D concepts that feed the 3D pipeline. The GDD and art bible constrain those
  concepts; generation does not invent the rules.
- **Generated does not mean accepted.** Every asset must pass visual, technical,
  licensing and runtime validation before entering the game.
- **Preserve the asset lineage**: the immutable generated raw, an editable source
  derivative and a separately validated runtime derivative, so a rejection or a
  duplication claim can be traced to its origin.
- **Judge topology at its use boundary.** Source topology is reviewed as editable,
  quad-dominant geometry; runtime GLBs are reviewed using their triangulated metrics,
  because the two representations answer different questions.
- **Acceptance is a controlled handoff.** A provider proposes an asset, the
  pipeline's own scripts normalise and validate it, a human approves the visual
  evidence, and Ashveil freezes the accepted source/runtime identities and contract.
  Generated output is never canonical merely because automation completed.
- **Canonical upright stance.** A base character must have a neutral, upright
  canonical stance plus deformation-ready knee and elbow topology, because a leaning
  or non-deforming rest pose corrupts every animation built on top of it.

### Direction

The pipeline runs six stages, each a script apart from the two that need human
eyes: concept (a human-approved image or multi-view reference), generate (Tripo
image-to-3D with Smart Topology), normalise (a Blender script fixes scale,
orientation and mesh health, and fails closed), rig (the landmark fitter places
the contract skeleton and computes automatic weights, and fails closed), profile
(a per-body driver profile generated from the contract), and verify (the Vitest
gate and the run-ashveil skill check bone count, height, axes, budgets, texture
presence and pose coverage, plus a screenshot at gameplay distance). See
[pipeline.md](pipeline.md) for the full contract.

Production proceeds through five ordered slices: the motion-driver seam refactor,
procedural locomotion on the existing KayKit bodies, the ash wolf as the quadruped
proof, Ashveil's own humanoid body, and procedural skill poses. Each slice gates on
the one before it, so the ash wolf — the design's proof that a second skeleton
family works — runs before skill poses exist to complicate it.

Use one approved humanoid proportion and canonical skeleton rather than independently
generating a new anatomy and rig for every outfit. Treat clothing, hair and equipment
as modular pieces within that standard. Static assets may use a simpler topology
path; deforming characters need joint-friendly topology and animation stress tests.

Begin with visually curated Tripo Studio work. Add API automation only after asset
settings, acceptance criteria and generation reliability are stable enough that
automation will reproduce approved work rather than accelerate rejects.

Each accepted asset should retain an asset identifier, its GDD relationship, concept
and prompt provenance, generation settings and tool version, licence evidence,
source model, runtime derivative, skeleton family and validation result.

## Open design work

These are unresolved decisions, not implied future features.

### Product and competition

- Which single promise should lead Ashveil's positioning: readable depth, the
  ash-reclamation world, skillful combat, visible ownership, or a tested combination?
- Which Diablo and Path of Exile player frustrations are sufficiently widespread to
  build around, rather than loud but narrow community complaints?
- What does Ashveil deliberately do less of so that accessibility does not become
  another layer on top of comparable complexity?

### Camera, controls and combat

- Exact camera pitch, distance, field of view, zoom policy and whether rotation is
  fixed, limited or player-controlled.
- Occlusion rules for walls, roofs, trees and large cosmetic pieces.
- Targeting and control validation across mouse, controller and Steam Deck at the
  chosen camera settings.

### World and exploration

- Whether revealing ash fog merely exposes the world or fictionally restores life
  and colour to it.
- The difference between unexplored, previously explored and currently visible
  territory, including what enemies may do across the boundary.
- Ashveil's own architecture and creature-transformation language; the current
  concepts are still too close to generic fantasy.

### Cosmetics and economy

- Which outfit zones are valuable at gameplay distance and where their silhouette
  limits lie.
- How headgear resolves incompatible hair silhouettes: preserve, compress, swap to
  a fitted variant or hide the hairstyle.
- What Web3 ownership means to the player, which assets participate, and where the
  boundary between cosmetic value and gameplay power lies.
- A wallet and account experience that preserves traditional access, plus a
  distribution plan compatible with blockchain-enabled functionality.

### Art and production

- Measured polygon, material, texture, animation and LOD budgets for browser and
  Steam Deck targets. These must come from representative assets and profiling, not
  invented defaults.
- The canonical source height and how it maps to the renderer's actor-radius scaling.
- The source/runtime coordinate contract: up and forward axes, ground origin and
  anatomical side naming.
- Whether neck and wrist component seams are welded or intentionally retained.
- Whether semantic source objects remain separate or are consolidated into fewer
  runtime meshes and primitives.
- Tripo's real acceptance and repeatability rate across masculine and feminine
  mannequins and shared hairstyle fits: topology, UVs, textures, materials and
  modular seams.
- The production body-mask and armor-cage fitting method. The axis-cropped proxy
  failed its boundary-quality review, so it cannot stand in for authored slot
  boundaries or representative pose and clipping tests.
- How later body archetypes receive equipment fits: separately authored meshes,
  corrective shapes or a controlled deformation system. This is deliberately not
  required while Ashveil targets its two canonical launch bodies.
- Commercial licensing and provenance controls across the image and 3D pipeline.
- The quadruped contract: whether `quadruped.v1`'s foreleg mapping onto the
  `shoulder`/`elbow`/`hand` semantic joints holds. If the ash wolf slice proves it
  wrong, the semantic joint set is redesigned before skill poses exist.
- Hero-moment performed motion, deferred. Procedural motion reads as game-like
  rather than performed, which the elevated ARPG camera tolerates; a code-authored
  clip plugged into the same driver seam remains a possible future addition, not
  committed today.
- Optional GPU upgrades. Commercially licensed motion models and GPU auto-riggers
  are optional upgrades behind the procedural seam once a GPU budget exists; none is
  committed while the constraint is inference-only cost.
- Re-measure the neck-gap between the Body and Head meshes on the next generated
  body; the current mesh measured up to 14.77mm apart at rest, growing to about
  37mm in motion, and this is unconfirmed on any other body.
- Re-measure knee topology deformation on the next generated body; the current
  mesh's knee patch reached a minimum triangle-area ratio of about 0.073, and this
  is unconfirmed on any other body.

## Not defined by this document yet

Detailed narrative, classes, skill systems, crafting, trade, endgame structure,
specific Web3 implementation, equipment slot counts, numeric content budgets and
final art-bible specifications remain outside the decided design. They should enter
the GDD only when their decisions are actively being made.
