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
- **Surface language.** Combine hand-painted-looking colour with restrained PBR
  lighting. Prefer broad material reads over photoreal micro-detail or hard outlines.
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

- **Tripo is an asset-generation tool, not an animation source.** Ashveil will
  evaluate Tripo Studio with Smart Mesh/Smart Topology for model generation and
  topology preparation. Character animation is generated, authored or retargeted
  separately against the accepted skeleton contract.
- **Game animation stays local.** Idle, walk and sprint production experiments use
  local Blender and Auto-Rig Pro tooling plus locally executed or downloaded motion
  sources. Hosted animation services, video-mocap services and film-oriented motion
  pipelines are out of scope for these simple game loops.
- **Concept approval precedes production generation.** Text-to-3D is useful for
  disposable exploration. Assets intended for the game should normally begin with
  an approved image or multi-view concept so silhouette and art direction are
  controlled.
- **Codex image role.** Codex with image generation can create and refine the 2D
  concepts that feed the 3D pipeline. The GDD and art bible constrain those concepts;
  generation does not invent the rules.
- **Generated does not mean accepted.** Every asset must pass visual, technical,
  licensing and runtime validation before entering the game.
- **Preserve the asset lineage.** Retain the immutable generated raw, an editable
  source derivative and a separately validated runtime derivative.
- **Judge topology at its use boundary.** Source topology is reviewed as editable,
  quad-dominant geometry; runtime GLBs are reviewed using their triangulated metrics.
- **Humanoid rigging has an entry gate.** A generated humanoid cannot enter rigging
  until it has an explicit scale, applied transforms, validated semantic components
  and a recorded topology report.
- **Acceptance is a controlled handoff.** A provider proposes an asset, Blender
  normalises and validates it, a human approves the visual evidence, and Ashveil
  freezes the accepted source/runtime identities and contract. Generated output is
  never canonical merely because automation completed.

### Direction

The leading production flow is:

1. write an asset brief tied to a GDD rule and approved visual language;
2. generate and approve a concept or consistent multi-view reference;
3. generate the high-detail 3D source in Tripo;
4. segment, retopologise with Smart Mesh, and finish textures;
5. rig once against an approved skeleton family;
6. retarget and validate animations after all mesh-changing operations;
7. export a source package and a runtime GLB for Three.js; and
8. validate it in the actual gameplay camera and performance target.

Use one approved humanoid proportion and canonical skeleton rather than independently
generating a new anatomy and rig for every outfit. Treat clothing, hair and equipment
as modular pieces within that standard. Static assets may use a simpler topology
path; deforming characters need joint-friendly topology and animation stress tests.

Define a versioned skeleton contract per approved archetype rather than silently
reusing one rest pose. Each contract should freeze semantic bone names, hierarchy,
rest axes and transforms, sockets, root-motion policy, influence limits and runtime
mapping. The current geometry-fitted `humanoid.v1` implementation is diagnostic
evidence for one masculine mannequin only, not approval of the feminine fit or a
production rig architecture. Rigify may support authoring, but cannot substitute for
measured landmarks or an Ashveil-owned deform/export contract.

Each approved chain contract should also freeze its rest orientation frame, explicit
bend reference and non-collinear pole rule. Blender authoring controls solve and
expose that intent, then their evaluated matrices are baked onto the versioned,
constraint-free Ashveil deform rig. Uncommanded long-axis rotation, a changed bend
plane or a disconnected parent-tail/child-head pair fails validation even when limb
endpoints still match. Full humeral, forearm and palm frames must be independently
measured in Blender and the runtime export, including handedness and bilateral mirror
checks; endpoint-only orientation is insufficient. Nonhumanoid chains require
separate contracts and evidence.

Attach rigid modular equipment and transfer deforming wearables only after the
target archetype's skeleton contract passes technical and human review.

Auto-Rig Pro is being evaluated as a rigging and animation-authoring benchmark, not
as an automatic production acceptance path. The first masculine ARP 3.78.47 / Smart
AI 1.21 run preserves bind geometry and accurately places the skeleton, but it does
not provide the required deforming scapula chain and fails unchanged shoulder/elbow
deformation gates even after weights are normalized and capped to four influences
under runtime-equivalent linear-blend skinning. The isolated animation exporter now
produces a 30-joint runtime skin rather than the full 211-joint authoring graph. One
static, unweighted `c_traj` helper remains in the diagnostic skin; a 29-joint export
without it has been proven separately but is not production acceptance. This keeps
the current mannequin and ARP output diagnostic while preserving ARP as a candidate
for a better-topology retest and for control-authoring comparison.

Walk and sprint remain separate, loop-closed in-place diagnostic clips at one second
and 0.6 seconds respectively, but human review rejected both clips and almost all
hand-authored stress poses as twisted or otherwise unsuitable. This revokes the
earlier conclusion that the walk was a useful motion prototype. The clips prove only
the intended timing and browser-review contract; they do not establish production
motion quality.

A bounded clean-room weighting and hand-authored-motion attempt improved measured
upper-arm axial twist, off-hinge rotation, reciprocal arm swing and knee flexion, but
still failed palm orientation, shoulder/elbow deformation and experimental GLB
parity. Its 15 genuine non-bind Blender renders and negative report are retained in a
separate NO-SHIP archive; no experimental GLB is retained and canonical ARP review
artifacts are unchanged.

The resulting decision separates the accepted and rejected parts: ARP's fitted
skeleton placement is accepted as the rigging benchmark; the original hand-authored
motion, the current Tripo mesh and the current weights are rejected. The next
production body must have authored joint-loop retopology and a deforming scapular
chain before skinning, motion or modular-armor acceptance is revisited.

The local motion spike established further animation rules:

- MoMask may propose local, noncommercial diagnostic joint-position motion, but its
  BasicIK BVH is not rotation truth. Terminal hand roll is unobservable, its bundled
  foot locking is rejected, and model/dataset rights require separate commercial
  clearance.
- Retarget import bases, root offsets and complete source-to-target rest frames are
  contractual. A `+Z`/`-Z` mismatch, direction-only rest alignment and absolute hip
  height layering caused the earlier reversed limbs, axial twist and floating body;
  mesh quality must not be blamed until those transfer gates pass.
- ARP's native FK-to-IK leg snap is rejected for this rig. It preserved endpoints
  while changing evaluated twist matrices and skinned vertices by hundreds of
  millimetres. Endpoint parity cannot substitute for deform-matrix and skinned-mesh
  parity.
- Direct procedural ARP-control authoring is the leading bounded path for idle,
  walk and sprint. Idle now passes grounding, non-static motion, knee-plane and
  decomposed loop gates. Walk passes support grounding, virtual-trajectory slide,
  knee direction/flexion, reciprocal arms and stretch gates, but still fails global
  penetration and swing-clearance gates. Sprint has not entered acceptance.
- The CMU Motion Capture Database is the leading local authoritative-rotation
  fallback for walk/run experiments because its grant permits inclusion in a sold
  product with attribution and without reselling the source data. Its tested idle
  capture did not contain a clean four-second loop and is rejected as a drop-in idle.

No animation reaches gameplay or the canonical viewer unless source intent,
skeletal transfer or authored-control motion, mesh deformation, runtime export
parity and human review pass independently. The review app may expose explicitly
selected WIP diagnostics without promoting them to canonical assets.

The masculine spike now separates diagnostic rig intent from mesh suitability. Its
humeral-head, overhead, cross-body and deep-elbow measurements record test directions
and thresholds only. Human visual review rejected the motion, so no anatomical
credibility is claimed. The current Tripo mesh also fails fixed shoulder and elbow
volume/triangle deformation thresholds. Wrist
deformation is stable, but the hand remains a separate shell with a measurable gap
and unapproved tangent continuity. Therefore this source topology is rejected for
production animation and armor fitting; Smart Topology or an equivalent authored
joint-loop pass and deforming scapular support are required before freezing the next
runtime skeleton contract. Character
acceptance requires both deformation and wrist-continuity contracts to pass; neither
can compensate for a failure in the other.

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
  mannequins and shared hairstyle fits: topology, UVs, textures, materials, modular
  seams, rig deformation, animation quality and exports.
- Feminine parity against a reviewed humanoid contract, including independently
  measured landmarks, shared hair/socket compatibility and deformation stress poses.
- Skeleton contracts and validation methods for quadrupeds and other nonhumanoid
  archetypes; `humanoid.v1` does not supply placeholders or evidence for them.
- The production body-mask and armor-cage fitting method. The axis-cropped proxy
  failed its boundary-quality review, so it cannot stand in for authored slot
  boundaries or representative pose and clipping tests.
- How later body archetypes receive equipment fits: separately authored meshes,
  corrective shapes or a controlled deformation system. This is deliberately not
  required while Ashveil targets its two canonical launch bodies.
- Commercial licensing and provenance controls across the image and 3D pipeline.

## Not defined by this document yet

Detailed narrative, classes, skill systems, crafting, trade, endgame structure,
specific Web3 implementation, equipment slot counts, numeric content budgets and
final art-bible specifications remain outside the decided design. They should enter
the GDD only when their decisions are actively being made.
