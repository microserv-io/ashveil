# Ashveil gear: pieces fitted to the canonical body

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
| Belt | `regionEnclosed 0`, closest vertex exactly at the 2 cm clearance, 98% of vertices more than 3 cm off the skin | A ring parked around the waist. The whole-piece shrinkwrap only pushes outward; the one inward operator (hug) reaches 2 cm and nothing was within reach. |
| Belt | 47 islands found, 10 kept | The 2% debris rule deleted the buckle and rivets (issue 34). |
| Proxy cape fixture | `aheadOfRegionMetres 0.15`, `regionEnclosed 0`, `gatesPass true` | The cape hangs down the front of the body. The `back` slot anchors the piece's bounding-box max Z to the chest's, so a sheet lands in front. The byte-for-byte fixture test pins this. |
| Warden cloak | not published; 2.35% motion clipping against a 0.5% limit | The drape solver disables capsule collision whenever surface supports exist and fixes the pose afterwards, killing velocity on every contact. |
| All | every gate green | Every geometric gate measures penetration only. A piece floating off the body has none. |

The gates were the definition of done, so the agents fitting pieces optimised for
green gates, and green gates said nothing about a floating belt. That is the lesson:
**measurements are advisories that make review faster; Rocco's eye on the review
page is the acceptance test, and no fitted asset is done because a script says so.**

## Decided

- **Gear is generated on the canonical body.** The concept for a piece is the
  canonical body's own render wearing the piece, so Tripo returns a dressed body in
  the body's proportions and pose. The fitter extracts the piece from it. Nothing
  guesses where a standalone piece goes.
- **The fitter corrects, it never reshapes.** After registration the only deformation
  is one Shrinkwrap pass with an offset on the worn band and a Corrective Smooth.
  A piece that needs more than that is a rejected generation, not a fitting problem.
- **Skin weights are transferred from the body** with Blender's Data Transfer
  modifier, nearest face interpolated, the same closest-point method Maya, Unreal and
  every production pipeline start from.
- **The body hides per region, authored.** A piece declares which body regions it
  hides. Regions live in the family contract and are resolved per body by
  `fit/masks.py`. Coverage is never computed from the piece.
- **Hanging cloth is spring bones.** Capes, sashes and pauldron drapes get short bone
  chains driven at runtime by `@pixiv/three-vrm-springbone`, colliding with capsules
  on the body's bones. It peers only on `three`, runs without a VRM file, and its
  update is a function of the step and the bone matrices alone. Stepped at the sim's
  fixed `DT` from sim time; presentation only, never sim.
- **One authored piece, many bodies, by conforming the canonical body.** A second
  body gets the piece by deforming a copy of the canonical body onto it (bone-length
  retarget, then body-to-body Shrinkwrap) with the piece bound to that copy through
  Surface Deform. Nothing is generated per body.
- **Gates fail closed only on what a script can judge**: contract identity, budgets,
  a two-sided standoff on the worn band, clipping through gameplay motion for fixed
  geometry. Everything else is reported on the review sheet and judged by eye.
- **Fixture tests never pin fitted output byte for byte.** They pin pure functions.
  A stable wrong answer is still wrong.

## The pipeline

Six stages, each one script, matching the body pipeline in [pipeline.md](pipeline.md).

### 1. Concept on the mannequin

`npm run art:mannequin` renders the canonical body (masculine-v3) in bind pose,
front, left, back and right, orthographic, 1024 square, neutral undersuit, and
commits them under `docs/art-pipeline/mannequin/`. Codex paints one piece onto the
front and back renders (left and right when the silhouette needs them). Rules for
the concept: the body, its pose and the undersuit stay untouched; the piece is drawn
worn, nothing else equipped; hardware (buckles, rivets, straps) drawn large enough to
survive the gameplay camera. Rocco approves the dressed concept, as the GDD requires.

### 2. Generate

Tripo multiview-to-model with `[front, left, back, right]`, omitting the views not
drawn, `orientation = align_image`, texture on, `model_seed` recorded in the
manifest. The raw dressed body is committed under
`docs/art-pipeline/sources/gear/<piece>-tripo.glb`, immutable.

### 3. Register and extract

```
npm run art:gear -- --input <dressed.glb> --slot <slot> --piece <name> \
  --hides <region,region> [--drape name:bone:from:to[:columns[:segments]]] \
  [--weights transfer|stiff|rigid] [--prefitted]
```

- **Register.** Uniform scale plus rigid transform that best matches the dressed
  body to the canonical body, fitted by ICP on the dressed vertices whose nearest
  canonical region is not one the piece hides or stands over. Blender's Python ships
  numpy and `mathutils.kdtree` and nothing else, so ICP is a short numpy loop, not a
  dependency. The RMS residual on
  that skin is the first number in the report and the first gate: over 1 cm and Tripo
  changed the anatomy, so the generation is rejected
  (`dressed_body_matches_the_canonical_body`).
- **Extract.** Each dressed vertex takes the region of its nearest canonical vertex.
  The piece is every dressed face with a vertex more than 6 mm off the canonical
  surface, plus every face inside a hidden region; the rest is the dressed body's
  skin, which the game already has. Islands are all kept; the triangle budget is met
  by Decimate, never by deleting small parts.
- `--prefitted` skips both for a piece already in body space, which is how the five
  accepted Warden pieces (boots, trousers, gloves, tunic, hood) enter the new path
  without regeneration.

### 4. Seat and skin

- **Seat.** One Shrinkwrap, nearest surface point, above surface, offset the slot's
  clearance, restricted to the worn band (piece vertices whose region is hidden),
  then Corrective Smooth on the same band. The fraction moved and the mean move are
  reported. Per-slot clearances order the layers: trousers under belt under tunic by
  construction, with no seating search.
- **Skin.** Data Transfer of vertex groups from the canonical body, nearest face
  interpolated, then limit to four influences and normalise. `stiff` keeps the top
  two influences for leather and plate, `rigid` binds to one bone. Slots that replace
  a region (hands, feet) keep the source shape and take the region's weights.

### 5. Hanging cloth

`--drape sash:pelvis:0.0:0.58:1:2` declares a band (fractions of the piece's height)
that hangs from a bone in `columns` chains of `segments` bones. Chains follow the
band's own surface: each bone's tail is the centroid of the next slice down its
column, so a cape's three columns (left, centre, right) hang where the cloth is.
A band vertex is held by the two joints it lies between along its column, faded into
the transferred body weights over 3 cm at the top; this is a pure function with a
unit test. Blender's automatic weights are not used here because they ignore the
vertex selection and solve the whole mesh. The manifest carries per-chain spring
settings (stiffness, gravity, drag, hit radius) and the body's capsule colliders,
measured off the fitted body per bone.

At runtime `src/render/drape.ts` is a thin adapter: one spring-bone manager per
actor, joints built from the manifest, colliders from the body profile, advanced in
fixed `DT` substeps from sim time. Beyond the cosmetic distance the manager is not
updated and the chain holds its rest pose.

### 6. Bind, hide, verify

- **Bind.** Unchanged in principle from PR 28: the piece binds to the body's own
  `THREE.Skeleton` plus its chain bones, sharing geometry, cloning only the material.
- **Hide.** The manifest says `hides: ["legs", "waist"]`; the runtime resolves it
  against the worn body's `<body>.masks.json` and drops body triangles whose three
  corners are hidden. A piece may also hide whole slots (`hidesSlots: ["waist"]` for
  a robe over a belt). No burial or coverage computation at runtime.
- **Verify.** The gate fails closed on: joints and inverse binds match the body;
  influences at most four, summing to one, on allowed bones; budgets, UVs and
  textures survive; the worn band sits between clearance minus 2 mm and clearance
  plus 10 mm from the skin (two-sided, so a floating ring fails); fixed geometry
  clears the body through the gameplay motion cycles within the slot's clip limit.
  Reported, never gated: registration residual below the limit, seat movement,
  clip through stress poses, drape clip, weight band, island counts.
- **Review sheet.** The fitter renders the raw dressed body beside the fitted piece
  on the body, at 15 m and 1.5 m, in bind, mid-stride walk and run, front, back and
  side. The sheet is attached to every PR that adds or changes a piece. Rocco's
  approval on the sheet and on the live review page is the acceptance.

## Many bodies

A second humanoid body B is rigged to the same contract by the body fitter. To carry
the Warden set onto it:

1. Copy the canonical body and its armature. Scale each bone of the copy to B's bone
   length from B's landmarks; the copy's own skinning moves its skin with them, so a
   long-fingered body gets a long-fingered mannequin without any per-limb code.
2. Shrinkwrap the copy onto B, nearest surface point, body to body.
3. Every piece was bound to the canonical body through Surface Deform at fit time;
   applying the copy's deformation carries the piece with it.
4. Transfer weights from B, run the same gate, write `public/gear/<piece>/<body>/`.

This is the conform-to-reference flow of BodySlide and 3ds Max Skin Wrap, with
Blender built-ins. If a body family drifts too far from the canonical proportions for
one mannequin (an ogre), that family gets its own canonical body and its own
authored pieces, which is what Epic's parametric outfits do with several source sizes.

## What is kept from PR 28 and what is dropped

Kept: the eight-slot contract and per-body `masks.json`; the wrist landmark fix and
body refit; the concept images and Tripo sources; the runtime binding to a shared
skeleton and index-edit hiding; the review page's gear panel; weight transfer;
`review.py`; the toon look.

Dropped: the standalone-piece fitting in `geometry.py` (alignment by bounding boxes,
yaw, limb straightening, roll search, tube fit, enclose, dilate, hug, layer seat);
`--covers`, `--span`, `--yaw`, `--thumb`, `--under`; the 2% debris rule; computed
coverage and the rim rule; runtime burial hiding; the pendulum drape solver and its
surface supports; byte-for-byte fixture tests of fitted output; the one-sided
standoff gate.

The five accepted Warden pieces stay as pre-fitted inputs. Belt, pauldrons and cloak
are regenerated on the mannequin, in that order: the belt proves registration and
extraction on the simplest shape, the pauldrons prove a drape, the cloak proves three
columns and collision.

## Slices, one PR each

1. **Salvage.** Split PR 28: merge the kept parts on their own, close the rest.
2. **Mannequin and belt.** `art:mannequin`, the dressed-belt concept and generation,
   register, extract, seat, skin, the two-sided standoff gate, the review sheet. Done
   when the belt sits on the waist with its buckle and Rocco approves the sheet.
3. **Spring bones.** The chain builder, the manifest settings, the runtime adapter,
   the pauldron drape. Done when the pauldron cloth swings at a run and settles at
   idle on the review page.
4. **Cloak.** Three columns, capsule colliders, the cosmetic distance cut-off, the
   frame budget measured with a cloak worn. Done when Rocco approves the GIF.
5. **Game wiring.** Equip from the sim's gear state through `actorview.ts`, hides
   resolved per body, perf gate with a full set worn.
6. **Second body.** The conform flow above, when the second humanoid body exists.

## Non-goals

Weapons and hand sockets (their own slice), finger bones (issue 33), self-colliding
cloth, a cloth simulation on vertices, per-body regeneration, any paid add-on.
