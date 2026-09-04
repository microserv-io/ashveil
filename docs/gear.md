# Ashveil gear: pieces generated on the canonical body

How a gear piece gets from a concept to a skinned mesh on a body, and why the
approach changed. Read this before touching `scripts/art/gear/` or
`src/render/gear.ts`. The motion side is in [motion.md](motion.md); the body side
is in [pipeline.md](pipeline.md).

## Why this document exists

The first gear pipeline (PR 28) fitted pieces that Tripo generated standalone, from
concept images of the piece alone, onto the body after the fact. Every standard tool
for garment rigging assumes the opposite: the garment is authored on the body, in its
space and roughly its shape, and the tools only correct and skin it. Epic's own skin
weight transfer paper states the precondition in four words, "we assume that two
meshes are aligned". Working without it, the fitter grew about 7,000 lines of
bespoke geometry (alignment, limb straightening, roll search, tube fit, hug bands,
layer seating, a pendulum drape solver) around three Blender modifiers, and its gates
could not see the defects that matter:

| Piece | Report says | What it means |
|---|---|---|
| Belt | `regionEnclosed 0`; measured live, closest vertex 2.1 cm off the skin, median 4.3 cm; the band is 34.7 cm deep against a 24.9 cm torso | A ring parked around the waist, an open horseshoe from above. The whole-piece shrinkwrap only pushes outward; the one inward operator (hug) reaches 2 cm and nothing was within reach. |
| Belt | 47 islands found, 10 kept | The 2% debris rule deleted the buckle and rivets (issue 34). |
| Proxy cape fixture | `aheadOfRegionMetres 0.15`, `regionEnclosed 0`, `gatesPass true` | The cape hangs down the front of the body. The `back` slot anchors the piece's bounding-box max Z to the chest's, so a sheet lands in front. The byte-for-byte fixture test pins this. |
| Warden cloak | fails closed: 76% of the cape starts inside the torso, eight outward passes never converge, 42% of vertices get no transferred weight, the result is 67% wider and 120% deeper than the aligned source; 11% motion clipping against a 0.5% limit | A bell, not a cape. At a run three of the six chain angles sit welded to their cone limits every frame, and at rest the chain never settles. The drape solver disables capsule collision whenever surface supports exist and repairs the pose afterwards. |
| Pauldrons | shrinkwrap moved every vertex 2.9 times on average, `regionEnclosed` 0.29 left and 0.10 right, 1,152 triangles of 24 islands dropped | Torn shards over the shoulder at 3 m. Same failure as the belt. |
| All | every gate green | Every geometric gate measures penetration only. A piece floating off the body has none. |

The gates were the definition of done, so the agents fitting pieces optimised for
green gates, and green gates said nothing about a floating belt. That is the lesson:
**measurements are advisories that make review faster; Rocco's eye on the review
page is the acceptance test, and no fitted asset is done because a script says so.**

**A trap the spikes hit.** Blender's glTF importer leaves a stray 1 m `Icosphere`
behind on every skinned import, in no file and no scene node. The old fitter's
under-target code welded it into the surface it fitted against, so every piece
fitted `--under` another was seated and measured against a sphere centred on the
feet. Filter imported meshes to the ones the file's armature skins, as the body
loader always did.

## What FF14 and WoW do about races

Neither game refits gear per race with geometry, and neither authors gear per race.
Every race shares one skeleton family with identical bone names. A piece is authored
once on a base body and other races get it through a per-bone deformation, carried
by the piece's own skin weights; a per-item table says which races have a dedicated
model instead; body parts under gear are hidden by authored flags on the item. Heads
are the exception in both, because a human helmet cannot be deformed onto a lion's
head. The "Many bodies" section below is that pattern with Blender built-ins.

- FF14 stores equipment models under a race code, `chara/equipment/e0000/model/
  c0101e0000_top.mdl`, and a per-race EQDP bit says whether the race has its own
  model; otherwise "the game will use the midlander model/material"
  ([Penumbra wiki](https://github.com/xivdev/Penumbra/wiki/Advanced-Editing)).
- The racial deformer is one file, `chara/xls/boneDeformer/human.pbd`, holding per
  body code a 4x3 matrix per bone name: "various races use pre-bone deformers to
  create their unique body shapes"
  ([Physis](https://github.com/redstrate/Physis/blob/master/src/pbd.rs)).
- Part hiding is the EQP flag set per item: hide scalp, hair, neck, waist, elbow,
  forearm, knees, calves, ankles, with per-race exceptions such as "Show on
  Hrothgar" ([Penumbra wiki](https://github.com/xivdev/Penumbra/wiki/Advanced-Editing)).
- Hrothgar and Viera launched with most headgear hidden; "more than five hundred and
  forty such items were carefully modified by our designers"
  ([Yoshida, 2019](https://www.siliconera.com/naoki-yoshida-on-viera-and-hrothgar-gender-lock-lack-of-new-healer-in-ffxiv-shadowbringers/)),
  and "a large number of headgear items will now display when worn by Viera and
  Hrothgar" only arrived in patch 7.3
  ([patch notes](https://na.finalfantasyxiv.com/lodestone/topics/detail/c04405c6cbe8519a0b6c8aa5e4d88a5d447419c9)).
- WoW paints body armour as textures onto a layout every race shares ("build up
  character models from multiple source textures instead of baking textures for each
  model/race/variation") and switches on geosets already in each race's mesh for
  sleeves, boots, belts, tabards, capes and robes
  ([wowdev.wiki](https://wowdev.wiki/Character_Customization)). Helms and shoulders
  are attached models; helm files are keyed by race and gender and
  `HelmetGeosetVisData` is a race bitmask "for hiding certain elements of the face on
  certain races for certain helmets" ([wowdev.wiki](https://wowdev.wiki/DB/HelmetGeosetVisData)).

## Decided

- **Gear is generated on the canonical body, on the mannequin for its layer.** The
  concept for a piece is the canonical body's own render wearing it, over the
  reference pieces of the layers beneath, so Tripo returns a dressed body in the
  body's proportions and pose with the piece already where it belongs. Tripo works
  from the image, not from measurements, so the dressed body is close and never
  exact; the fitter measures the difference and closes it, it does not assume it
  away.
- **Ring pieces are placed by their ring.** A belt strap, a collar or a cuff is a loop
  around a bone, and a loop has exactly one correct placement: the body's cross
  section at that height plus the strap's clearance. The fitter places such a piece
  by that rule, with its buckle, pouches and hanging cloth riding along, so an
  existing standalone belt needs no regeneration. This is the only per-shape rule.
- **The fitter corrects, it never reshapes.** After registration or ring placement
  the only geometry change is a push-out to a 3 mm safety clearance off the
  mannequin and a Corrective Smooth on what moved. A piece that needs more is a
  rejected generation.
- **Belt, shoulders and back carry hanging attachments.** A sash below the strap,
  feathers or cloth below a pauldron cap, a cape's panels below its yoke. The fixed
  part is placed and skinned like any piece; every hanging panel gets its own spring
  chain. A slot is never reduced to its fixed part to make a gate pass.
- **Skin weights are transferred from the body** with Blender's Data Transfer
  modifier, nearest face interpolated, the closest-point method Maya, Unreal and
  every production pipeline start from.
- **Layers are authored, not computed.** The layer order and the mannequin per
  layer live in the family contract; runtime constants are generated from it. A piece
  may hide whole lower slots (a robe over a belt), by declaration.
- **The body hides per region, authored.** A piece declares which body regions it
  hides, with the region rule parameters it needs (a knee boot hides more shin than
  an ankle boot). Regions resolve per body through `fit/masks.py`. Coverage is never
  computed from the piece.
- **Hanging cloth is spring bones.** Capes, sashes and pauldron drapes get short bone
  chains driven at runtime by `@pixiv/three-vrm-springbone`, colliding with capsules
  on the body's bones. It peers only on `three`, runs without a VRM file, and its
  update is a function of the step and the bone matrices alone. Stepped at the sim's
  fixed `DT` from sim time; presentation only, never sim.
- **One authored piece, many bodies, by conforming the canonical body.** A second
  body gets the piece by deforming a copy of the canonical body onto it (bone-length
  retarget, then body-to-body Shrinkwrap) with the piece bound to that copy through
  Surface Deform. Nothing is generated per body below the neck.
- **Gates fail closed only on what a script can judge**: contract identity, budgets,
  registration, a contact-ring standoff that a floating piece cannot pass, clipping
  through gameplay motion for fixed geometry. Everything else is reported on the
  review sheet and judged by eye.
- **Full source detail is the default.** The runtime GLB keeps every triangle and
  every island Tripo produced; buckles, rivets, straps and fringes are the premium
  look at 1.5 m and in screenshots. Reduced variants are LOD levels a graphics
  setting or distance selects, generated by Decimate as separate files, never baked
  into the default. The frame budget is measured at full detail with a full set worn.
- **Fixture tests never pin fitted output byte for byte.** They pin pure functions.
  A stable wrong answer is still wrong.

## The pipeline

Six stages, each one script, matching the body pipeline in [pipeline.md](pipeline.md).

### 1. Concept on the mannequin

`npm run art:mannequin` renders the canonical body (masculine-v3) in bind pose,
front, left, back and right, orthographic, 1024 square, neutral undersuit, once per
layer, and commits them under `docs/art-pipeline/mannequin/<layer>/`. The layers and
their reference pieces come from the contract:

| Layer | Mannequin wears | Slots generated on it |
|---|---|---|
| 0 | nothing | legs, hands, chest, head |
| 1 | the reference trousers and tunic | feet, waist, shoulders, back |

The reference pieces are the accepted Warden trousers and tunic. A belt generated
over the reference tunic sits right over any chest piece of similar thickness, which
is the assumption every game with layered gear makes. Codex paints one piece onto the
front and back renders (left and right when the silhouette needs them). Rules for the
concept: the body, its pose, the undersuit and the reference pieces stay untouched;
the piece is drawn worn, nothing else added; hardware (buckles, rivets, straps) drawn
large enough to survive the gameplay camera. Rocco approves the dressed concept, as
the GDD requires.

### 2. Generate

Tripo multiview-to-model with `[front, left, back, right]`, omitting the views not
drawn, `orientation = align_image`, texture on, `model_seed` recorded in the
manifest. The raw dressed body is committed under
`docs/art-pipeline/sources/gear/<piece>-tripo.glb`, immutable.

### 3. Register and extract

```
npm run art:gear -- --input <dressed.glb> --slot <slot> --piece <name> \
  --hides <region[:from-to],...> [--hides-slots <slot,...>] \
  [--drape name:bone:from:to[:segments]] [--weights transfer|stiff|rigid] \
  [--ring | --prefitted]
```

- **Register.** Uniform scale plus a proper rotation and translation that best match
  the dressed body to the layer's mannequin. Initialised from the normalise stage's
  orientation, ground plane and height, so ICP starts near identity and never has
  to find the front or the scale on its own; the rotation is constrained to a
  positive determinant and the scale to [0.9, 1.1]. Correspondences are trimmed and
  taken only on dressed vertices whose nearest mannequin region is not one the piece
  hides or stands over. Blender's Python ships numpy and `mathutils.kdtree` and
  nothing else, so ICP is a short numpy loop, not a dependency. The gate
  `dressed_body_matches_the_mannequin` fails closed when any uncovered region's 95th
  percentile residual exceeds 1 cm or a region has fewer than 50 samples; one global
  RMS would let a moved arm hide behind an unchanged torso.
- **Extract.** Each dressed vertex takes the region of its nearest mannequin vertex.
  The piece is every dressed face with a vertex more than 6 mm off the mannequin
  surface, plus every face inside a hidden region. Inside a hidden region, a face
  within 3 mm of the mannequin that another kept face occludes along the outward
  normal is dropped, so a garment Tripo modelled as a separate layer does not bring
  the skin under it. The rest is the dressed body's skin, which the game already
  has. Islands and triangles are all kept. LOD variants, when a slot asks for them,
  are made by Decimate with the cut boundary ring and every island under 300
  triangles protected, into `<piece>.lod1.glb` beside the full one. Pieces with open
  shells get a double-sided material.
- **Regions.** `--hides` names contract regions, optionally with an `along` range:
  `--hides foot,shin:0.4-1.0` for a knee boot, `--hides foot,shin:0.85-1.0` for an
  ankle boot. The `back` slot gets a real region, the posterior half of the chest
  region by its `forward` bound, so a cape flush against the back is neither
  registration skin nor discarded. Region boundaries fall inside the hidden region,
  and the piece carries the dressed body's own skin there, so the staircase a
  dominant-bone boundary leaves on the body is covered by the piece.
- **Ring placement** (`--ring`) replaces register and extract for a ring piece. The
  strap is the largest island that leaves a hole (its smallest inner radius at least
  half its median outer radius, measured about its own ring centre); azimuth
  coverage alone does not identify it, every blob covers every bin about its
  centroid. The ring centre is re-fitted from one point per azimuth bin, not the
  vertex mean, because Tripo spends triangles on the buckle and the mean sits in
  front of the loop. The strap's inner ellipse is fitted to the target surface's
  cross section at the strap's height plus 3 mm by a scale per horizontal axis and
  a vertical placement, the target ellipse centred the same way, and every other
  island moves rigidly with the strap. Then only the strap is seated; each other
  island follows the mean displacement of the strap vertices it attaches to, so a
  buckle or a pouch is never deformed. Hardware that still sits inside the target
  after that (a pouch hanging into a lower layer) is cleared as a cluster: islands
  within 5 mm of each other move together, radially out from the ring centre by
  the cluster's worst depth plus 3 mm, at most three passes, and the pass count is
  reported because the rule has no convergence guard of its own. The contact-ring
  gate reads the strap's inner face. The Warden belt goes on this way from its existing Tripo source, every one
  of its 47 islands and 9,988 triangles kept; the old fitter had scaled one axis and
  let the other follow, kept 10 islands, and left the strap 35% deeper than the
  torso.
- **Full-detail refit** (`--full-detail`) is how the accepted Warden pieces (boots,
  trousers, gloves, tunic, hood) enter the new path without regeneration and get
  their hardware back. The old fitter's placement, which Rocco accepted, is kept as
  a frozen tool for these pieces only: its similarity steps apply to every island,
  its non-rigid stages run on the shell islands alone (the ones it used to keep),
  nothing is decimated, and every hardware island rides rigidly by the residual
  displacement of the shell vertices it attaches to, clustered at 5 mm. The spike
  restored all six pieces at the raw triangle count with 0.0 mm hardware distortion
  and shells within a millimetre of the accepted fits, the tunic's chest star
  included. The tunic and hood need `--weld-under`, because the fitter at PR 28's
  head cannot reproduce them otherwise (a later commit split the fit target and the
  committed pieces predate it). The refit regenerates the manifest with authored
  regions, reruns every gate, and goes back to Rocco side by side with the shipped
  fit.

### 4. Seat and skin

- **Seat.** One Shrinkwrap in `Outside` mode against the layer's mannequin with a
  3 mm offset: it moves only vertices that sit inside the mannequin plus the safety
  margin and leaves everything else where Tripo put it, so a buckle or a dome is
  never pulled onto the skin. Then the cut boundary ring is snapped onto the
  mannequin surface with a 3 cm falloff into the piece (a vertex-group weighted
  Shrinkwrap, `On Surface`), so the seam between the piece's skin and the body's
  closes whatever residual registration left. Corrective Smooth on the moved
  vertices. The fraction
  moved and the mean move are reported. Nearest-point projection is wrong at concave
  folds (armpit, crotch); vertices there are excluded by the region's `forward` and
  `along` bounds and any residual is what the review sheet is for.
- **Skin.** Data Transfer of vertex groups from the canonical body, nearest face
  interpolated, then limit to four influences and normalise. `stiff` keeps the top
  two influences for leather and plate, `rigid` binds to one bone. Slots that replace
  a region (hands, feet) keep the source shape and take the region's weights.

### 5. Hanging cloth

`--drape sash:pelvis:0.0:0.58:2` declares a band (fractions of the piece's height)
that hangs from a bone in chains of `segments` bones. A chain is built per hanging
panel: the connected components of the band that stand off the mannequin, one chain
each, so a sash is one chain, a pauldron's feathers are one per side, and a cape's
three panels are three. The band must lie below the fixed part (the strap, the cap,
the yoke); a declaration that takes the whole strap is refused, because a chain
through the pelvis is not a panel, and the fitter names the panels it found in the
report so a missing one is visible.
Each bone's tail is the centroid of the next slice down its panel, so the chain hangs
where the cloth is. A band vertex is held by the two joints it lies between along
its panel, faded into the transferred body weights over 3 cm at the top; this is a
pure function with a unit test. Blender's automatic weights are not used here
because they ignore the vertex selection and solve the whole mesh.

The exported skin lists the body's joints first, in the body's order, then the chain
bones in declaration order, each parented as declared, with inverse binds from the
rest pose; `matchDrapeJoints` in `src/render/drapebones.ts` keeps guarding exactly
that. The last joint's tail is a plain object, never a skin joint. The manifest
carries per-chain spring settings (stiffness, gravity, drag, hit radius) and the
body's capsule colliders, measured off the fitted body per bone.

At runtime `src/render/springbones.ts` is a thin adapter: one manager per actor,
joints built from the manifest, colliders from the body profile. The order per frame
is contractual: procedural pose, world matrices, spring steps at fixed `DT` from sim
time with at most four catch-up steps (a stall drops time rather than exploding),
skeleton update, render. At bind the chain is pre-rolled thirty steps in the bind
pose so the first drawn frame is the settled one, not a snap out of the fitter's
rest. Beyond the cosmetic distance or off screen the manager is not updated; on
re-entry it is reset and pre-rolled, with hysteresis so a chain at the boundary does
not pop. Two clients may see different cloth, which is fine for presentation.

Collider capsules belong to the body, never to the piece: they are measured off the
body's skin per bone by the body fitter and shipped in the body profile, with a
piece allowed only to add capsules for its own fixed geometry (a pauldron cap for
the cloth under it). The spike found the pendulum's per-piece table carried a 16 cm
capsule on the upper arm that pulled both pauldron caps inward at rest. The spike's
settings, stiffness 4, gravity 1, drag 0.4, hit radius 2 cm, settled the sash in a
quarter second to within microns and hold there, where the pendulum never stopped
wobbling; thirty cloaked actors at the four-step cap cost 0.22 ms a frame.

### 6. Bind, hide, verify

- **Bind.** Unchanged in principle from PR 28: the piece binds to the body's own
  `THREE.Skeleton` plus its chain bones, sharing geometry, cloning only the material.
- **Hide.** The manifest carries the resolved region rules; the runtime resolves them
  against the worn body's `<body>.masks.json` and drops body triangles whose three
  corners are hidden. `hidesSlots` hides whole lower pieces. No burial or coverage
  computation at runtime; `SLOT_LAYERS` is generated from the contract.
- **Verify.** The gate fails closed on: the registration gate above; joints and
  inverse binds match the body; influences at most four, summing to one, on allowed
  bones; the source's triangle and island counts survive into the default GLB; UVs
  and textures survive; no vertex inside the mannequin by more
  than 2 mm; the contact ring (the extracted shell's boundary vertices) has its 75th
  percentile within 10 mm of the mannequin, which a floating ring cannot pass and a
  raised buckle does not affect; fixed geometry clears the body through the gameplay
  motion cycles within the slot's clip limit, sampled at vertices and edge midpoints.
  Reported, never gated: the registration residuals when they pass, seat movement,
  clip through stress poses, drape clip, weight band, island counts.
- **Review sheet.** The fitter renders the raw dressed body beside the fitted piece
  on the body, at 15 m and 1.5 m, in bind, mid-stride walk and run, front, back and
  side, and for a layer-1 piece with the reference pieces worn. The sheet is
  attached to every PR that adds or changes a piece. Rocco's approval on the sheet
  and on the live review page is the acceptance.

### If Tripo drifts further than the gate allows

The registration gate is the first thing the pauldron generation tests, and it is
a real risk: Tripo generates from the image, so a dressed body can come back with
a thicker arm or a lower shoulder than the render. Under 1 cm the seat closes it.
Past that, the fix is the same conform step the many-bodies flow uses, applied at
fit time: bind the extracted piece to the dressed body's visible shell with Surface
Deform, shrinkwrap that shell onto the mannequin body to body, and the piece
follows. It is a fallback because it reshapes, and it is the standard reshaping
(a wrap deformer), not a new rule. If even that fails the generation is rejected
and the concept revised, never the fitter.

## Many bodies

A second humanoid body B is rigged to the same contract by the body fitter. To carry
the Warden set onto it:

1. Copy the canonical body and its armature. Scale each bone of the copy to B's bone
   length from B's landmarks; the copy's own skinning moves its skin with them, so a
   long-limbed body gets a long-limbed mannequin without any per-limb code. This is
   FF14's racial deformer with Blender's armature modifier.
2. Shrinkwrap the copy onto B, nearest surface point, with correspondences confined
   to the same region and side, so a thigh never snaps to the other thigh and a
   finger to its neighbour.
3. Every piece was bound to the canonical body through Surface Deform at fit time;
   applying the copy's deformation carries the piece with it. Surface Deform refuses
   doubles, concave faces and edges with more than two faces, so the body fitter
   gains a gate: its triangulated bind proxy must bind, and the proxy is what pieces
   bind to.
4. Transfer weights from B, run the same gate, write `public/gear/<piece>/<body>/`.
   The piece's manifest lists which bodies have a fitted output; the runtime refuses
   a body with no entry rather than guessing, as FF14's per-item race table does.

If a body's head is not a human head, its hoods and helms are generated on that
body's own mannequin, as both games author helmets per race. If a whole family
drifts too far from the canonical proportions for one mannequin (an ogre), that
family gets its own canonical body and authored pieces, which is what Epic's
parametric outfits do with several source sizes.

## What is kept from PR 28 and what is dropped

| Old file | Disposition |
|---|---|
| `scripts/art/contracts/humanoid.v1.json` slots, `scripts/art/fit/masks.py`, `<body>.masks.json` | keep; add the `back` region, parameterised hide rules, the layer table |
| Wrist landmark fix, body refit, concept images, Tripo sources, the toon look (`src/render/look.ts`) | keep |
| `src/render/gear.ts` (bind, index-edit hides) | keep; hides from region rules, layers from the contract |
| `src/render/gearcover.ts` | drop the burial hiding; the grid moves next to the clip gate under `scripts/art/gear/` |
| `scripts/art/gear/weights.py`, `review.py`, `gate.py`, `clip.ts`, `penetration.ts` | keep; add the registration and contact-ring gates, sample edge midpoints |
| `scripts/art/gear/geometry.py` (align, yaw, limb, roll, tube, enclose, dilate, hug, layer seat) | delete |
| `scripts/art/gear/drape.py` chain builder, supports, partition | replace with the panel chain builder |
| `src/render/drape.ts`, `drapestep.ts`, `drapecollide.ts`, `drapesurface.ts` | delete; `drapebones.ts` keeps `matchDrapeJoints` |
| `--covers`, `--span`, `--yaw`, `--thumb`, `--under`, the 2% debris rule, computed coverage, the rim rule | delete |
| byte-for-byte fixture tests of fitted output, the one-sided standoff gate | delete |

The five accepted Warden pieces are refit at full detail from their raw sources and
the belt keeps its Tripo source through ring placement, so the first slices spend no
Tripo credits. Pauldrons and cloak are regenerated on the layer-1 mannequin: the
pauldrons prove registration, extraction, a pair and a drape per side (the shipped
pauldrons are torn shards and full detail only adds studs to a broken shell); the
cloak proves three panels and collision.

## Slices, one PR each

1. **Salvage.** Split PR 28 along the table above: merge the kept parts, close the
   rest. Lift the ring rule, the full-detail refit, the under-target fix and the
   spring-bone adapter from the spike branches. The five pieces ship at full detail
   and the belt by ring placement, both already approved on the review page.
2. **Belt on the body.** Proven by the spike: ring placement from the existing
   Tripo source, rigid hardware, cluster clearance, every island kept. What remains
   is the contact-ring gate and the review sheet in the shipped path.
3. **Spring bones.** The panel chain builder, the manifest settings, the runtime
   adapter with the contractual update order, the belt's sash as the first chain.
   Done when the sash swings at a run and settles at idle on the review page.
4. **Mannequin and pauldrons.** `art:mannequin` for both layers, the dressed
   pauldron concept and generation, register, extract, the registration gate, a
   drape per side. Done when both caps sit on the shoulders with their cloth
   swinging and Rocco approves the sheet.
5. **Cloak.** Three panels, capsule colliders, the cosmetic distance cut-off with
   hysteresis, the frame budget measured with thirty cloaked actors. Done when Rocco
   approves the GIF and the perf gate passes.
6. **Game wiring.** Equip from the sim's gear state through `actorview.ts`, hides
   resolved per body, perf gate with a full set worn.
7. **Second body.** The conform flow above, when the second humanoid body exists.

## Non-goals

Weapons and hand sockets (their own slice), finger bones (issue 33), self-colliding
cloth, a cloth simulation on vertices, per-body regeneration below the neck, any
paid add-on.
