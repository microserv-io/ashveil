# First-zone terrain build slice

**Three.js idea-validation slice · Runtime validation in progress**

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
geometric cuts. This is a visual treatment only: blending the road, living grass and ash
does not change the authored route, river boundary or movement collision topology.

## Implementation boundaries

- Keep the replacement route and its procedural placeholder scenery separate. Do not
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
- Use placeholder landmark massing where needed. This slice does not approve final
  buildings, vegetation, lighting, materials or environment assets.

The validation map spans 220 by 180 world units on a five-unit height grid. Rendering and
grounding share the grid's explicit triangle split and barycentric interpolation. The
representative controller has a 0.72-unit radius, rejects movement above 35 degrees,
advances in 1/60-second substeps and caps one rendered frame's movement time at 0.1
seconds. Grounding must agree with the rendered triangles within 0.001 world units.
These are slice tolerances for testing, not final character or world scale.

The runtime's single terrain material blends the existing meadow-grass, worn-earth and
ash-ground albedo candidates through a 512-pixel paint-weight map. Road strokes have
rounded caps and feathered edges; bank earth softens the shoreline and ash fades in over
the far bank. The paint affects presentation only and the terrain mesh remains the
collision source. The albedos load as sRGB colour textures with mirrored wrapping at
their review scales of 2, 2.5 and 2 metres per repeat.

These generated candidates make material scale and colour contrast reviewable; their
visible source seams still require retouching before production use. Provenance, prompts
and the limitations of these colour-only maps are recorded in
[`public/textures/first-zone/README.md`](../public/textures/first-zone/README.md).

Desktop exploration uses camera-relative WASD or arrow-key movement, Shift to run,
pointer drag to orbit and the wheel to zoom. Coarse-pointer devices receive a movement
joystick and hold-to-run control while the canvas remains available for camera orbit.
The temporary camera uses a 48-degree field of view, a 4.8–18-unit zoom range and a
roughly 9–60-degree pitch range. A ray from the player toward the desired camera keeps it
in front of terrain and scenery. Overview and return-to-refuge controls support review;
these bindings and values remain validation settings rather than final design decisions.

In development, the browser exposes `globalThis.ashveilWorld` for repeatable validation.
Its controls can move, stop, reset or toggle overview, while its state reports position,
nearest landmark, overview mode, camera position and facing, average frame time, the last
240 raw frame times, draw calls, triangles and captured runtime errors. This diagnostic
surface is review tooling, not a gameplay or networking API, and production preview
builds do not expose it.

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
- Movement collision prevents the player from entering the river or walking onto the
  broken bridge's missing span. Automated tests cover both boundaries, including approach
  at an angle rather than only head-on.
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
