# Alderbank terrain authoring

## Build contract

The starting zone follows the [Alderbank map reference](art-pipeline/concepts/opening-chapter/starting-zone-map-v3.png).
The artwork supplies relative geography; its legend, labels and pictorial buildings
are not terrain dimensions. North is positive world Z and east is negative world X.
The geography above the legend supplies the map-to-world transform.

The user-selected scale is **five minutes of uninterrupted normal running from
Alderbank Refuge through the wagon road and Lower Road to Broken Waystation**.
At the existing five-world-units-per-second running speed, the authored road is
approximately 1,500 units long. Validation must traverse it with the actual movement
controller, preserving state between waypoints, rather than equating a drawn line
with a playable journey. Combat, dialogue, detours and return visits add time.

Characters, buildings, road widths and interaction radii retain their existing local
scale. Settlements move as groups around named landmarks. The current playable quests
retain their target IDs while their [world staging](quest-staging.md) is split between
Safe Landing and the refuge, so relocating either place does not reset progress or grant
rewards.

## Map feedback revision targets

The [v3 planning map](art-pipeline/concepts/opening-chapter/starting-zone-map-v3.png)
sets a moderate terrain target after v2 made the interior too rocky and enclosed. Its
landforms are now translated into the committed default definition used by both the
editor overlay and runtime geometry.

The Safe Landing remains a low riverside rescue shelf and Alderbank Refuge becomes a
raised, sheltered bench. The shore start sits on the dry lower bank near visible water,
with a continuous shelf back to the landing-road endpoint. A compact, low but steep limestone bluff blocks the direct
diagonal climb; one broad, natural graded approach carries the existing opening path into
the refuge. The low-bank rescue shelf and its route remain continuous. Browser review must
verify at player height that the refuge roof and bell remain visible from the wet shingle;
this top-down map cannot prove that sightline. Where blockers are intended, cliff
faces, ridges, steep escarpments and talus must define them; trees alone do not count.

A few purposeful rocky ridges and outcrops guide routes and define readable pockets. Most
of the interior remains grassland, wooded rolling hills, broad fields and gentle orchard
terraces rather than enclosing every location with cliffs. The named landmarks and route
graph remain intact: the waystation return follows the same main road through the rally and
wagon, while the farm and orchard/grove loops stay optional rather than becoming gates. The
five-minute Refuge-to-Waystation runtime contract remains unchanged. This map revision
adds no plot, quests, quest stages or named locations. It relocates the existing playable
opening interactions to their story locations.

## One authored definition

A versioned, JSON-safe zone definition records bounds, grid spacing, landmarks,
spawn, ordered main-route paths, river controls, mountain ridges and terrain brush
strokes. A deterministic compiler derives the terrain grid and queries used by both
rendering and movement. The visual editor changes that definition; it does not
maintain a second terrain or collision model.

The compiler caches its grid. Grounding interpolates the same triangles rendered by
the scene, with a maximum permitted discrepancy of 0.001 world units. Landmark
pads and graded roads preserve usable slopes. River and mountain restrictions apply
while jumping as well as while grounded, and include the character footprint.
Visible mountains and water close the playable perimeter before the outer world
guard. Bracken Hollow remains visible across the river as desaturated countryside.

The exact water footprint is the connected set of terrain below the authored water
level, seeded from the river controls. That one terrain-derived region drives both the
rendered water geometry and movement collision. Lowering connected ground can therefore
expand water beyond a control point's nominal half-width; an isolated low basin stays dry
because it is not connected to the seeded river. The renderer lays the animated surface
over that wet footprint. Water colour, transparent shallows, ripples, Fresnel brightening,
direct sun specular highlights and foam are presentation. Scene, screen-space and cubemap
reflections are not implemented, and this pass does not add swimming or a fluid simulation.

Terrain presentation uses the approved painterly grass, earth and limestone albedos.
The existing far-bank influence drains colour and softens contrast after those surfaces
are composed; it does not substitute a separate ash texture. Material presentation does
not change the authored definition, terrain mesh or collision queries.

## Editing and drafts

Open `/terrain-editor.html` on the private game server. The focused editor supports
tracing and refining this zone: select
and move landmarks and path, river or ridge controls; raise, lower or smooth ground;
inspect route distance; undo changes; save a browser draft; and import or export its
JSON definition. The reference overlay uses the same transform as the authored map;
its opacity control exposes the underlying terrain. Moving a landmark also moves
its attached road endpoints. Interior road points can be dragged independently.

The normal world uses the committed definition. An explicit draft-play URL loads a
saved editor draft with `?zoneDraft=1` before the world starts. Runtime terrain is immutable for that
visit; playing a later edit reloads the world. Draft storage is separate from quest
progress and reward receipts. Invalid imports retain the preceding valid editor
state. Invalid saved drafts must produce a visible error and a return-to-default
action, never silently overwrite the draft. Reset in the editor restores the committed
v3 definition. Older valid drafts retain their authored spawn landmark; the played
world derives its initial location and reset label from that landmark.

Validation limits input bytes, dimensions, grid size, control-point counts and
brush strokes before allocating terrain. Save and play reject broken required
routes or an unsafe spawn. Terrain clearance covers the authored road width; projected
scene solids must clear the character-radius route centreline. Spawn validation uses
the same landmark-anchored solid projection, including after landmarks move. Editing
may deliberately change the five-minute route;
the editor reports the new distance and estimated time, while the committed default
must pass the five-minute movement check.

The five-minute metric continues to originate at the refuge and follows the ordered
main route even though a new character now starts at Safe Landing. Separate movement
coverage follows the landing road through the intended bluff notch, and bounded probes
along the north end reject a flat shortcut around the escarpment.

## Review boundaries

This is an authored terrain blockout and a private authoring tool. Existing Blender
scenery and approved-character copies provide scale references. Final environment
density, encounter placement, later quests and the waystation dungeon remain separate
content work. The tool does not select a production engine or deploy a multiplayer
backend.

Acceptance includes continuous route traversal, optional-branch and quest-target
reachability, footprint clearance, angled sprint/jump perimeter checks, deterministic
JSON round trips, and matching rendered/queried terrain. Automated checks must prove
water geometry and collision use the same connected below-water-level footprint,
including connected expansion and a disconnected dry basin. Browser review must still
inspect the overview, human scale, water animation and shoreline, editor round trips and
draft play; topology tests alone are not visual evidence. Performance measurements must
use this world route; the deprecated demo's sweep and frame harness are not evidence for it.

The current default remains sparse scenery for layout review. The next asset pass can follow the
[Tripo prop and house brief](art-pipeline/first-zone-prop-brief.md).

## V3 verification — 13 September 2026

The serial gate passed: typecheck, 72 test files with 1,047 passing tests and one
existing skipped test, the production application build, 19/19 website checks and the
website build. The focused quest and persistence run passed 48 tests across eight files.

Chrome moved terrain hill 14 from height 14 to 15, then observed undo at 14 and redo at
15. Saving and playing the draft produced a refuge height of 15.716 versus 14.716 in the
committed default, with no captured runtime errors. Reset and Save then restored the
committed v3 definition. At the shore start, Mara's M01 offer was accepted and the blue
rescue-ties interaction advanced its objective; the resulting quest state survived reload.
The continuous shore-to-refuge walk reached the landing-road endpoint, followed both
authored approach bends and arrived at Iven in 160.115 seconds without a movement stall or
captured runtime error. Iven then presented the M02 offer at the refuge.

At the default refuge view, 240 warmed Chrome development samples measured 3.22 ms mean
and 4.70 ms p95 CPU frame work, with 54 draw calls and 2,639,845 submitted triangles.
This excludes GPU completion and is not an FPS measurement. The production preview on
port 5327 showed the shore start and its labels, did not expose the development diagnostic
global, and recorded no page errors.

## Prior v1 verification — 13 September 2026

The serial gate passed: typecheck, 71 test files with 1,032 passing tests and one
existing skipped test, and a production build. The separate website checks passed
19/19. The continuous main-road trace took 300.0000000000577 seconds over 18,004
integration frames, without resetting the explorer at waypoints. The authored
road length is 1,500 units and its endpoint error was zero. Angled natural-boundary
probes stopped 144.9–203.3 units before the corresponding outer world guard.

Chrome inspected the final overview as a terrain blockout. Drag, undo and redo produced
a saved 1,488-unit draft, which loaded into the played world; M01 was accepted and its
journal objective appeared in the Main Story section, distinct from Optional Side Quests.
The editor remained usable
at 390 by 844 pixels. Reset restored the committed 1,500-unit route and saved that default.
Malformed JSON import was rejected without replacing the valid saved draft. Ground-level
review showed animated water, a visible submerged bank, transparent shallows and shoreline
foam.

Chrome development profiling at the refuge measured world-frame CPU time at 3.49 ms mean
CPU time and 5.10 ms p95 after spatial tree chunks and bounded exact terrain-triangle queries.
This is CPU timing for the inspected refuge view, not a GPU or frames-per-second benchmark.
Render-distance, level-of-detail and fog policy remain separate future work.
