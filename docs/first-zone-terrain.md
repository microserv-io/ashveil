# First-zone terrain build slice

**Proposed production slice · Engine choice pending · Runtime not yet changed**

## Objective

Build the first explorable terrain for the opening chapter as one coherent river-valley
route. The slice should let the team inspect the decided freely controlled third-person
camera against useful ground, slopes and landmarks while expressing the chapter's
existing journey from safety toward danger.

This work starts a replacement zone because the current action-RPG demo is deprecated.
Its code remains available as historical evidence until a replacement route exists, but
its procedural dungeon, portal progression, elevated camera and demo entry point are not
the foundation for this zone. No runtime route changes as part of this documentation
slice.

Whether the replacement is a fresh Three.js route or a switch to another engine remains
pending. Terrain implementation must wait for that choice rather than allowing a tool or
existing entry point to settle it implicitly.

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

## Implementation boundaries

- Establish a separate replacement route and asset registry after the engine decision.
  Do not import the deprecated demo's scene, terrain generator, model preload or main
  entry point to bootstrap the zone.
- Ground rendering and movement collision must derive from an agreed world-space terrain
  representation. Visual slopes, traversable surfaces and movement height must match.
- Preserve clear seams between authored terrain data, rendering and movement queries so
  later authoritative simulation and networking work can adopt the zone without making
  presentation the source of gameplay truth.
- Use placeholder landmark massing where needed. This slice does not approve final
  buildings, vegetation, lighting, materials or environment assets.

## Non-goals

- Quest state, dialogue, objective markers, rewards or encounter scripting.
- Combat, enemy placement, dungeon gameplay or the Broken Waystation interior.
- Networking, persistence, authoritative zone handoff or multiplayer population rules.
- Fog-of-war behaviour, ash restoration, final world scale or boundaries beyond this
  opening route.
- Final camera tuning, controls, performance budgets, art bible or engine selection.
- Removing the deprecated demo before the replacement route is available.

## Acceptance checks for the implementation

- The refuge, wagon road, fields, each optional branch, Lower Road rally and waystation
  descent form contiguous walkable routes, and each optional branch reconnects without
  blocking the main path.
- A representative player controller remains grounded on flats, gentle slopes, terraces
  and transitions. Before implementation, record the selected runtime's maximum walkable
  slope and ground-clearance tolerance, then prove with automated movement tests that the
  controller stays within those limits rather than hovering or sinking.
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
- The replacement route loads in the selected engine's actual runtime through its own
  entry path with no dependency on the deprecated demo scene, terrain generator, model
  preload or portal flow.
- Captured runtime verification records the traversed route, visible/collision agreement
  and runtime errors. Use an actual browser when the selected runtime targets the browser;
  otherwise use the native editor or an exported native build. Performance evidence
  measures the replacement route itself; results from the deprecated demo harness do not
  satisfy this check.
