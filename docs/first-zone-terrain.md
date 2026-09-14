# First-zone terrain build slice

**Three.js idea-validation slice · Playable Blender environment pass**

This document records the terrain build. The subsequent
[quest-system slice](quest-system.md) adds local quest state, dialogue, interactions
and placeholder NPCs for M01/M02 and S01–S05; those additions have their own scope
and validation and do not implement combat or the waystation interior.

## Objective

Build the first explorable terrain for the opening chapter as one coherent river-valley
route. The slice should let the team inspect the decided freely controlled third-person
camera against useful ground, slopes and landmarks while expressing the chapter's
existing journey from safety toward danger.

This work starts a replacement zone because the current action-RPG demo is deprecated.
Its code remains available at `/legacy.html` as historical evidence, but its procedural
dungeon, portal progression, elevated camera and runtime modules are not the foundation
for this zone. The new Three.js terrain slice is the default route.

Three.js was selected for this idea-validation slice so the team can test the authored
terrain, movement and camera in the existing browser toolchain. That choice does not
commit the final production MMORPG to a browser runtime or settle a later engine review.

## Source contracts

- The [game design document](game-design-document.md) decides normal MMORPG play uses a
  freely controlled third-person camera. Pitch, distance, field of view, zoom, camera
  collision and recentering remain open.
- The [opening chapter](story/opening-chapter.md) supplies the travel order and outing
  boundaries. This terrain slice gives those places spatial continuity; it does not add
  quests, encounters or rewards.
- The [terrain overview](art-pipeline/concepts/opening-chapter/terrain-overview.png) is an
  atmospheric composition study. It suggests the river-valley contrast, material family
  and readable connections, but it is not an exact map, scale reference or record of
  implemented content. In particular, it compresses the waystation close to the refuge.
- Ash remains visible across the river as desaturated, still countryside. This slice does
  not decide whether exploration reveals land or restores its colour and life.

## Scoped terrain

The first pass contains a connected ground surface and enough landmark massing to read
the chapter's route:

1. **Safe bank and Alderbank Refuge.** A riverbank arrival area connects directly to the
   refuge and its communal space. The safe opening area provides room for rescue and care
   before the story's weapon introduction; hostile staging is outside this slice.
2. **Wagon road and nearby fields.** A broad, legible road leaves the refuge, reaches the
   stranded wagon and continues through lived-in fields. It supports the chapter's bundled
   road outing without requiring duplicate travel.
3. **Optional local branches.** Short forks reach the orchard, farmstead and grove. Each
   branch reconnects to the main route so optional stories can continue on location
   without becoming gates on the main journey. Field edges, an irrigation path, orchard
   rows and changing roadside landmarks may help distinguish the branches without fixing
   quest-object placement.
4. **Lower Road and waystation approach.** The main route continues within the opening
   region to a sheltered rally landing, then descends on broad traversable ground to the
   Broken Waystation service entrance below the surviving abutment. The entrance and
   refuge remain on the same safe bank; reaching the approach never requires crossing the
   river.
5. **Broken crossing and distant ash.** The crossing ends visibly over the river with a
   missing span. Across the water, Bracken Hollow fades from living countryside into
   desaturated stillness, establishing the threat without fire, lava or a smoke wall.

Terrain should use varied elevation, riverbank terraces, gentle hills and limestone
outcrops to create a place rather than a flat diagram. Required routes must remain
comfortably traversable; cliffs, vegetation and structures can frame them without
silently narrowing the travel contract.

Ground materials should meet through soft, rounded brush transitions rather than hard
geometric cuts. This visual blending does not change the authored route, the current
connected wet footprint or movement collision. Terrain edits below the water level can
change that footprint when they connect to the river seed.

## Implementation boundaries

- Keep the replacement route and its environment assets separate. Do not
  import the deprecated demo's scene, terrain generator, model preload or main entry
  point to bootstrap the zone.
- Ground rendering and movement collision must derive from an agreed world-space terrain
  representation. Visual slopes, traversable surfaces and movement height must match.
- Preserve clear seams between authored terrain data, rendering and movement queries so
  later authoritative simulation and networking work can adopt the zone without making
  presentation the source of gameplay truth.
- The authored `world-data.ts`, terrain geometry/query code and movement rules remain
  host-agnostic. The Three.js renderer, browser controls and HUD may depend on the browser
  and presentation libraries; dependencies do not point back from world truth to them.
- Use placeholder landmark massing where needed alongside the Blender building and tree
  kit. This slice does not approve final buildings, vegetation, lighting or materials.

The current authored map spans 2,485 by 1,385 world units on a five-unit height grid,
replacing the original 220 by 180-unit validation layout. The user-selected main-road
run from refuge to waystation is five minutes. The [zone authoring guide](zone-authoring.md)
records the compiler, natural boundaries, animated water and editor workflow. Rendering and
grounding share the grid's explicit triangle split and barycentric interpolation. The
representative controller has a 0.72-unit radius, rejects movement above 35 degrees,
advances in 1/60-second substeps and caps one rendered frame's movement time at 0.1
seconds. Grounding must agree with the rendered triangles within 0.001 world units.
These are slice tolerances for testing. The controllable explorer uses the approved
[`masculine-clean-v1` character](approved-character-game.md) at its authored scale; the
world units preserve that character scale; production engine and world-scale decisions
remain separate from this selected route-time target.

The runtime's default terrain material blends the approved painterly meadow-grass,
worn-earth and ivory-limestone albedos. Its paint-weight map targets one
world unit per texel, capped at 4,096 pixels per axis and 16 million total pixels.
Road strokes have
rounded caps and feathered edges; bank earth softens the shoreline and ash fades in over
the far bank. The paint affects presentation only and the terrain mesh remains the
collision source. The albedos load as sRGB colour textures with mirrored wrapping.
Decorrelated world-space samples, broad colour variation and distance quieting prevent
one tile from dominating large hillsides.

Ash uses the same composed grass, earth and limestone surfaces with colour drained and
contrast softened by the existing far-bank influence. The pure world-space influence
also generates the renderer's paint map, so later enemy or NPC presentation can share
the same boundary without duplicating it. Sparse deterministic ash motes stay anchored
to world cells populated within a bounded window around the camera over ash-affected dry
ground; they do not change global fog, the sky or UI. This pass does not change actor materials.
Provenance, prompts and the limitations of these colour-only maps are recorded in
[`public/textures/first-zone/README.md`](../public/textures/first-zone/README.md).

An opt-in `?hillsideReview=1` route compares the baseline against Painterly terrain on
the real Alderbank zone. It forces the committed zone instead of loading a saved terrain
draft, pauses the existing world clock at noon and swaps separate baseline and painterly
material variants on the same terrain mesh, so geometry, character, sky, camera and time
stay fixed. Painterly is the ordinary whole-zone material; only the review route loads
the legacy grass, earth, ash and limestone maps. A baseline load failure leaves Painterly
active and offers a review-only retry. Paint weights, vertex truth and collision remain
unchanged.

The [painterly environment runtime review](art-pipeline/reviews/painterly-environment/README.md)
records the final ground, overview and noon/dusk/night river evidence with its explicit
visual, automated and performance-proof boundaries.

The earlier grass-only trial on 14 September 2026 captured the
[baseline](art-pipeline/reviews/painterly-hillside/baseline.jpg) and
[painterly](art-pipeline/reviews/painterly-hillside/painterly.jpg) states at the same
1,200 by 800 viewport. The [captured diagnostic state](art-pipeline/reviews/painterly-hillside/comparison-state.json)
records identical explorer position, camera position and yaw, noon paused time, 44 draw
calls and 1,668,550 submitted triangles for both looks, with the candidate ready and no
captured runtime errors. The first live attempt exposed a terrain shader compile error
from treating Three.js's colour varying as three-component; the reviewed capture follows
the `vColor.rgb` correction. The already-open developer console retained those earlier
compile messages, so the diagnostic error array is the recorded post-fix runtime signal.
These historical hillside captures establish the approved grass comparison only; they
do not validate the later earth, limestone, regional ash or connected-water rollout.

Desktop exploration uses W/S or the up/down arrows to move forward and backward, A/D or
the left/right arrows to turn, Q/E to strafe, Alt to walk, Shift to sprint and Space to
jump. Left mouse drag orbits independently. Right mouse drag steers camera and character
together, changes A/D into strafing while held, and keeps S as a backpedal. Holding both
mouse buttons moves forward without stacking speed with W; releasing either stops that
mouse-forward movement. The wheel zooms. Keyboard turning retains the camera's orbit offset
except during left-only free-look. Coarse-pointer devices retain camera-relative movement
through a joystick, a hold-to-sprint control and a jump button while the canvas remains available
for camera orbit. The explorer runs at 5 units per second, walks at 2 units per second
with Alt, and sprints at 7 units per second with Shift.
The approved prototype uses seven authored clips: its forward-only locomotion fallback
reuses the selected forward gait for reverse, strafe and diagonal movement without changing
the character's facing. A grounded jump plays its 0.18-second anticipation while preparing,
then physics starts the jump; the character continues through start, air and landing clips.
The temporary camera uses a 48-degree field of view and a 4.8–18-unit zoom range. Its
physical orbit remains at least roughly 9 degrees above the explorer so terrain and
scenery collision stay ground-safe, while upward drag can lift the view almost to the
zenith without reversing the horizontal movement bearing. A ray from the player toward
the desired camera keeps it in front of terrain and scenery. Overview and return-to-start controls support review;
the reset label follows the active zone's authored spawn landmark. These bindings and
values remain validation settings rather than final design decisions.

The mouse scheme adopts the character-relative Standard model documented by the
[FFXIV game manual](https://na.finalfantasyxiv.com/game_manual/operation/): left drag
free-looks, right drag couples facing to camera direction, and both buttons move forward.
It also retains WoW's longstanding A/D turn and Q/E strafe defaults, with A/D becoming
strafe during right-button steering, as recorded in the official historical
[WoW Classic manual](https://us.media.blizzard.com/manuals/wow/wow-classic-manual-enUS.pdf).
Standard versus camera-relative Legacy control is a player preference rather than a
quality ranking; this slice currently offers Standard only.
Sensitivity, inversion, rebinding, autorun, recenter settings and first-zone gamepad input
remain deferred. Touch and pen keep independent orbit behavior.

FFXIV's current [camera-pivot setting guide](https://na.finalfantasyxiv.com/uiguide/faq/faq-other/setting_legacy.html)
and player reports about [free-look fighting camera intent](https://forum.square-enix.com/ffxiv/threads/497225-Legacy-control-left-click-panning?p=6442683&viewfull=1)
and [sticky mouse steering](https://us.forums.blizzard.com/en/wow/t/right-clickcamera-sticking/1586905)
motivated deliberate free-look ownership, complete input cleanup and no forced recentering.
Those reports are anecdotes about player concerns, not evidence of current defects in either game.

In development, the browser exposes `globalThis.ashveilWorld` for repeatable validation.
Its controls can move, stop, reset or toggle overview, while its state reports position,
explorer facing, nearest landmark, overview mode, camera position and facing, average frame time, the last
240 raw frame times, draw calls, triangles, time of day and captured runtime errors.
The development-only time controls can set the hour, cycle duration and paused state. This diagnostic
surface is review tooling, not a gameplay or networking API, and production preview
builds do not expose it.

## Painterly sky and local time

The default route renders `public/textures/sky/ashveil-sky-day-v2.png` on a
camera-centred inward sphere. The generated 1,774 by 887 panorama uses softly brushed
azure and turquoise, warm horizon haze, and large cream-edged cloud banks to match the
sculpted character and storybook countryside. The source image and its seam-corrected
edit are copied without pixel edits. [`public/textures/sky/README.md`](../public/textures/sky/README.md)
records both hashes and links both exact 14 September 2026 prompts, including the
style-reference role, source dimensions and equirectangular corrections. It is project asset data covered by
[`LICENSE-ASSETS`](../LICENSE-ASSETS), including that license's limits around rights in
output made with generative tools.

`DEFAULT_DAY_DURATION_SECONDS` in `src/world/world-clock.ts` is the documented local
cycle setting: 600 real seconds represents 24 visual hours, beginning at 08:00 on each
load. The host supplies monotonic elapsed time, so a suspended page advances when it
returns unless the clock was explicitly paused. Movement keeps its independent
0.1-second frame clamp. Explorer reset does not reset the clock. Development builds add
the collapsible Time of day panel below the left header with dawn, noon, dusk and
midnight presets, a phase scrubber, pause/resume, and a 1–604,800-second duration field.
Production builds retain the cycle without exposing this panel or the diagnostic global.

The environment allocates one sun, one shadowless moon and one hemisphere light for the
life of the world. Their directions, colours and intensities change continuously, while
the sun's shadow target follows the explorer. Midnight keeps a cool hemisphere fill and
moon key so the dark character, terrain and paths remain readable. The water shader
receives the same key direction, colour, intensity and ambient colour; its waves,
shoreline and collision stay unchanged. The panorama shader blends mismatched wrap
edges, softens its pole and fades the lower hemisphere into the current fog colour.
Celestial discs and deterministic sparse stars are depth-tested behind world geometry;
stars also fade behind bright low-chroma cloud areas.

The final browser checks and their explicit limits are recorded in
[`sky-day-night-verification.md`](sky-day-night-verification.md).

## Blender environment pass

This environment pass replaces the six building and 33 tree placeholders with four
Blender-authored templates: a refuge hall, cottage, mature alder and orchard tree.
The [environment reference](art-pipeline/concepts/opening-chapter/environment-kit.png)
combines a Blender render of the actual `masculine-v3` character with the existing village
concept art. It establishes human scale, softened stonework, structural timber,
terracotta tile courses, teal cloth and irregular branching foliage. It is an art target,
not an in-game screenshot. The character remains a scale reference for this pass.

Export the templates as one GLB with exactly four identity-transform direct mesh roots
and one joined mesh per template for instanced rendering. All vertices carry finite
atlas UVs in the zero-to-one range and mild `COLOR_0` tint, which multiplies the shared
material's textures. The material uses embedded 2,048-pixel PNG atlases for sRGB base
colour, tangent-space normal data and linear ORM data (R occlusion, G roughness and B
metallic). Retain a reproducible Blender generator and an editable local `.blend` source
under `scripts/art/scenery/.output/first-zone/`, which survives application builds.
Building footprints, including porches, must fit the existing collision disks; alder
roots must fit the smallest shared radius of 1.1 metres, and orchard roots the 1.15-metre
disk, while crowns may overhang. Tree footprint measurement includes geometry through
1.0 metre above the ground datum and excludes the overhanging crown above that cutoff.
Each tree placement derives a repeatable yaw, restrained colour tint, and independent
height and horizontal scale from its stable solid ID. Horizontal X/Z scale remains
uniform and is capped against the actual transformed geometry within that one-metre
ground zone, so the authored collision disk remains conservative even when a shorter
tree brings more source geometry into the measured zone. Preserve authored positions,
building yaw, route clearance and all movement truth. Foundations extend below the
placement plane to meet slopes; tree camera proxies exclude foliage. Secondary props
remain procedural.

Load and validate the kit before starting exploration, with visible loading and retry
states. The loaded templates own the cached atlas textures and treat them as immutable;
each instance batch clones its material while sharing those maps, and scenery teardown
disposes batch geometry and materials without disposing the cached sources. Missing or
malformed texture bindings fail validation and clear the pending load so retry performs
a fresh request. Check real exported geometry, embedded PNG pixels, placement, resource
ownership and failed-load recovery. Review the Blender render and actual browser scene
for scale, grounding, silhouette, camera obstruction and material quality. Repeat
route/touch validation and record frame timing and draw calls after integration. These
remain prototype assets.

## Non-goals

- Quest state, dialogue, objective markers, rewards or encounter scripting.
- Combat, enemy placement, dungeon gameplay or the Broken Waystation interior.
- Networking, persistence, authoritative zone handoff or multiplayer population rules.
- Fog-of-war behaviour, ash restoration, final world scale or boundaries beyond this
  opening route.
- Final camera tuning, control bindings, performance budgets, art bible or production
  engine selection.
- Removing the deprecated demo as part of this validation slice.

## Acceptance checks

- The refuge, wagon road, fields, each optional branch, Lower Road rally and waystation
  descent form contiguous walkable routes, and each optional branch reconnects without
  blocking the main path.
- A representative player controller remains grounded on flats, gentle slopes, terraces
  and transitions. Automated movement tests prove it stays within the recorded 35-degree
  slope and 0.001-unit ground-clearance tolerances rather than hovering or sinking.
- Rendered ground and movement collision agree at sampled points along every required
  route, including slope changes and the waystation descent, within the recorded
  ground-clearance tolerance.
- Movement collision prevents the player from entering the exact connected
  below-water-level footprint or walking onto the broken bridge's missing span. Automated
  tests prove rendered water and collision share that footprint, connected low ground can
  expand it beyond nominal river half-width, disconnected low basins remain dry, and angled
  approaches cannot enter it.
- From the decided third-person camera, a reviewer can walk the whole slice, rotate around
  the character, inspect near-ground transitions and recognise the next route landmark.
  Exact camera tuning remains open.
- An overview inspection confirms the refuge and service entrance occupy the same bank,
  the broken crossing does not span the river, optional branches reconnect, and ash is
  visible across the water. The concept panorama is not used as a pixel-exact map.
- The replacement route loads in Three.js through its own browser entry path with no
  dependency on the deprecated demo scene, terrain generator, model preload or portal
  flow.
- Captured runtime verification records the traversed route, visible/collision agreement
  and runtime errors in an actual browser. Performance evidence measures the replacement
  route itself; results from the deprecated demo harness do not satisfy this check.

Automated terrain and movement checks may land before the visual review is complete.
Do not treat this document or a successful legacy performance run as evidence that the
new route has passed browser, camera, touch or performance validation.

## Recorded verification — 7 September 2026

The final Blender kit exports four templates: hall 49,218 triangles,
cottage 37,912, alder 39,509 and orchard tree 27,877. Its 17,647,420-byte GLB embeds
2,048-pixel base-colour, ORM and normal PNGs measuring 2,062,867, 1,258,943 and
2,656,924 encoded bytes. The manifest records their byte hashes, channel semantics,
colour spaces, atlas regions, frame and footprint metadata. Tests decode the real pixels
and check all 39 instance transforms, including the six building yaws, against the
authored layout.

The post-fix gate passed with `npm run typecheck && npm test -- --maxWorkers=1 && npm run build`:
56 test files, 918 passing tests and one existing skipped test; both browser entries built.
After correcting the manifest's exported UV convention, the 11 focused scenery tests
and typecheck passed again. Independent review checked the complete diff, exported UV
occupancy, texture hashes, source ownership and the final Blender comparison renders.

Chrome loaded the revised kit and the zone overview. A controlled corrupt embedded PNG
produced the visible error state; retry fetched the valid GLB and restored one canvas and
one HUD with no captured runtime errors. The final GLB SHA-256 is
`920939b85334e415efef1c1a3950472f3607eb03726d2c02f950bba151099eeb`.
A warmed sample with DevTools open recorded 25 draw calls, 2,838,966 submitted triangles
and 2.1 ms p95 CPU frame work. This excludes GPU completion and is not an FPS guarantee.
The Computer Use connection subsequently lost its Chrome window, so fresh mobile
interaction and full-route traversal were not repeated for this asset revision.

The preceding terrain release's Chrome checks on Apple M4/ANGLE Metal traversed the main route and all 17 optional-loop
control points without runtime errors. Loading failure and retry recovered one canvas
and HUD. The iPhone 13 emulation exposed a high-DPI canvas sizing bug; the corrected
390×664 logical viewport keeps the player, joystick and Run button visible. In-viewport
movement, simultaneous orbit and touch cancellation passed after that correction.

The canopy camera retained the full 4.8–18-metre zoom range. Exported foundation skirts
cover the measured downhill relief at all six building placements. Production preview
loaded the world and legacy entries without page errors or development diagnostics;
the editable `.blend` remained present after the application build.

A baseline desktop sample from that preceding release recorded 26 draw calls and 356,420 submitted triangles; CPU frame
durations had a 1.9 ms median, 5.2 ms p95 and 42.4 ms p99, with a 193.9 ms maximum. These
are measurements from this machine, not a production frame-rate guarantee or budget.
