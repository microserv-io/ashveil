# Ashveil character and animation pipeline

## Objective

Every step from an approved concept image to a creature that idles, moves, attacks
and dies in the real game camera is run by agents: scripts and code with tests, no
manual web steps, no human animator, no licence that forbids a sold game. The proof
is two skeleton families going through the same path: the masculine humanoid and the
ash wolf.

## Traps already hit

**Symptom: the base mesh read as leaning backward once posed, and the walk cycle
folded the spine up to 140 degrees.** Independent Blender measurement found the raw
mesh nearly vertical (hip to shoulder +2.5 deg) and the Auto-Rig Pro rest pose
vertical (spine_01 0.000 deg). The lean came from a Remap rest-pose mismatch: the
Mixamo bind torso sits at +5.3 deg, so the retarget added a constant +4.7 deg to
spine_02 on every frame, and a later correction rotated spine bones after the
retarget was already baked, compounding the error down the chain. It also flattened
a 24 deg torso swing to 1.9 deg. A "9.798 deg lean" cited elsewhere measured a posed
rig using the upper-arm bone head as the shoulder landmark — a pair that reads +6.5
deg even in the untouched rest pose. None of it was a mesh defect; the earlier
"base model leans, NO-GO" finding is withdrawn.

**Lesson:** a stance defect and a retarget rest-pose mismatch produce the same posed
symptom. Measure the rest pose and the posed pose independently before failing a
mesh on a posed measurement alone.

The neck-gap and knee-topology issues found on the same body are real, unrelated
defects, not measurement artifacts, and stand as open items until the next body is
measured (see the GDD).

**Symptom: a gear piece could align against surface geometry that was not the body.**
`bpy.ops.import_scene.gltf` leaves scene objects the file's own meshes never named (a
stray Icosphere from the importer's default scene), and a shipped body GLB is
seam-split for UV islands, so a straight join of its meshes has thousands of boundary
edges and is not a closed volume a ray can count crossings into. `gear/body.py` keeps
only the meshes both the armature skins and the masks sidecar name, and welds seams
(`normalise._merge_seams`) before building the inside/outside surface a piece aligns
against.

**Symptom: the clip gate read a piece resting cleanly on a masked slot as buried.**
Searching only the body's visible surface signs a vertex by the nearest hole's rim —
an armpit crease centimetres away — instead of the triangle actually underneath it.
`scripts/art/gear/penetration.ts` searches the whole body and discards a hit only when
the nearest triangle is hidden under a worn slot, so resting on a mask reads as clear.

## Design

### Motion is code, not data

Gameplay animation is generated at runtime by a procedural motion system that is a
function of replicated sim state, sim time and per-body memory that itself derives
only from replicated state. No clips are authored, downloaded or retargeted for
gameplay motion.

- It is the only path that is fully agent-producible on this hardware and
  licence-clean by construction. See "AI motion and rigging models" below for what
  the research found and where it fits.
- One system serves every skeleton family. Motion targets semantic joints that a
  per-skeleton profile resolves to bones at bind time.
- It reacts to the sim exactly: stride follows realised velocity so feet never slide;
  anticipation and strike align to the sim's own windup and recovery.
- It is testable headless. The pose generator is `three`-free; only the skeleton
  binding touches Three.js. Foot planting, joint limits, loop closure and allocation
  are asserted in Node like any sim rule.
- It fits the architecture: `docs/architecture.md` lists animation as
  client-predicted, and `views.ts` says meshes are a projection. The rig reads
  state and events and never writes.

Known limit: procedural motion reads as game-like rather than performed. At the
elevated ARPG camera that is acceptable.

### The seam

The instance-level procedural driver writes a bound body.

```
RigInput = {
  state: RigState,           // rigStateOf(actor), unchanged precedence
  speed: number,             // hypot(actor.velocity)
  dashing: boolean,          // actor.dash, which outlives the skill
  facingDelta: number,       // shortest arc from the view's last facing
  phase: { windup: 0..1 } | { recovery: 0..1 } | null,
  hitAge: number | null,     // seconds since hitFlash began, for an additive flinch
  ailments: Ailment[],
  time: number,              // sim.time, never wall-clock
  seed: number,              // actor.id, for per-body gait offset
}

MotionDriver (per body, owned by ActorView)
  bind(body, profile)        // resolve semantic joints to bones once; fail loudly
  reset()                    // on pool acquire: Skeleton.pose(), phase and blend cleared
  update(input, delta)       // writes the skeleton in place; allocates nothing
  dispose()

ProceduralDriver gait generator, two-bone analytic IK, layered flinch, pose tables
```

Rules, each with a test:

- `speed` comes from `Actor.velocity`, never from the view's smoothed position.
- `time` is `sim.time`. Gait phase offset is `actor.id`. No wall-clock, no
  pool-order dependence.
- `facingDelta` needs the previous facing; it lives on the view and is cleared in
  `reset()`.
- `phase` needs durations the actor does not store. The sim gains `windupTotal` and
  `recoveryTotal` on `Actor` (plain numbers, snapshot-safe), set where the timers
  are set. This is a sim change and ships with a byte-identical sweep.
- The pose is never a source of truth. Hits, footsteps and damage timing follow
  sim timers; the pose follows them. No IK raycasts against scene geometry: ground is
  flat at zero or read from the area map.
- `ActorView.group` keeps sim position, absolute facing and the windup tell scale.
  Visual root offset lands on a child of the group, and a gait loop accumulates zero
  root translation.
- Missing joints are skipped, never merged into a parent. Required joints that do
  not resolve fail at bind time with profile and joint named.
- Profiles are immutable data (names, axes, per-joint rest-axis correction, limits,
  optional flags, sockets). Bone handles and scratch state are resolved per clone.
- A body runs one driver.

Semantic joints, 15: `root`, `pelvis`, `spine`, `chest`, `head`, and per side
`shoulder`, `elbow`, `hand`, `hip`, `knee`, `foot`. Optional per family: `neck`,
`clavicle`, `toes`, `wrist`, `tail`. Sockets (weapon, head attachment) are a
separate map. The quadruped family maps forelegs to `shoulder`/`elbow`/`hand` with
its own gait; if that proves wrong, `Pose` is redesigned before skill poses exist.

### States and layers

| Sim signal | Presentation |
|---|---|
| idle, moving, dead, skills | base pose from the driver, precedence as `rigStateOf` |
| `dash` | locomotion stays in a dash pose while the flag is set, not a sprint at 12 m/s |
| `hitFlash` | additive flinch layer over the base pose, plus the existing flash |
| `chilled` | already reads through velocity; no extra work |
| death | pose settles within 0.7 s because the fade starts at 55 percent of 1.6 s |
| stun, knockback, portal | do not exist in the sim; non-goals, not invented in render |

### The asset path (bodies)

One command per body, no judgment in it:

```
npm run art:fit -- --input <tripo.glb|fbx> --family humanoid --body <name> [--helpers]
npm run art:profile -- --body <name>
```

`art:fit` writes `public/bodies/<name>/`: the runtime `<name>.glb`, a per-body
`<name>.manifest.json`, a `<name>.report.json` carrying every measurement, and a
`<name>.review.png` contact sheet. It exits non-zero with a named gate on any
failure, writes the report anyway so the refusal can be acted on, and deletes the
GLB so a body that failed cannot ship. Same input, same bytes out: the end-to-end
test refits the committed body and compares hashes.

| Stage | Module | What it decides |
|---|---|---|
| Normalise | `scripts/art/fit/normalise.py` | import, regions, facing, upright, canonical height, feet on the ground |
| Landmarks | `fit/landmarks.py` | joint positions off the mesh, each with a confidence and a symmetry error |
| Skeleton | `fit/skeleton.py` | the family skeleton on those landmarks, bones oriented by rule, optional helpers |
| Weights | `fit/weights.py` | automatic weights, the region clean, the deformation gates |
| Export | `fit/export.py`, `fit/glb.py` | glTF with dot-free names and identity bone rest, plus the manifest |
| Gate | `fit/gate.py` | the frame, the schema, the budgets, re-measured off the shipped file |
| Review | `fit/review.py` | the contact sheet, rendered from the shipped file |

**Frames and signs.** `scripts/art/fit/frame.py` is the only place a coordinate
frame is converted, and it carries the bone axis rule. Every sign bug this slice
hit was the same mistake in different clothes, so three rules stand:

- **Fit the sagittal plane before measuring anything off it.** The lateral axis
  comes from the bilateral regions, the face picks which way along it is forward,
  and the feet only cross-check. Reading the heading off one foot's long axis puts
  a stance splay into the heading and can land 180 degrees out; fitting the plane
  first drops bilateral landmark error from five centimetres to two millimetres.
- **A gate must be able to fail.** "Toes ahead of heels" cannot: the landmark
  fitter defines the toe and the heel as the front and back of the same sole.
  Where the ankle sits along its own foot can, and does.
- **Measure a lean between two of the same thing, and against what an upright body
  of the family reads.** A hip cluster against an extrapolated shoulder joint reads
  the shoulder ball's own anatomy as five degrees of backward lean, and standing
  that up rakes the legs and pitches the feet — a stance defect introduced by the
  correction meant to remove one.

**Bone orientation.** In Blender a bone points at its child and its roll is set by
rule: limb bones put local +X on the lateral axis so a knee and an elbow hinge
about one axis, spine-chain bones face local +Z forward. The runtime file carries
none of it — `export.py` neutralises the exported rest orientations to identity
without moving a joint, so `semanticskeleton.ts` derives an identity rest-axis
correction for every semantic joint. `art:profile` asserts exactly that and refuses
the body otherwise: a non-identity correction on a body this pipeline built is a
fitter bug, not body data.

Contract structure: a family schema (`scripts/art/contracts/humanoid.v1.json`:
semantic roles, hierarchy, the axis rule, budgets, limits, sockets, an optional
helper block) separate from a per-body manifest (landmarks, footprint, rest and
inverse-bind hashes, measured budgets, gate results). Both have a JSON schema and
both are checked by `tests/art_contracts.test.ts`.

Mesh policy: normalise preserves the source's materials and UVs, joins nothing,
and drops only the regions the family contract excludes (the generator's hair).
Runtime budget per body is set from the masculine body until a profile run says
otherwise.

### Assets in the repository

Committed: concept images, the raw Tripo output (paid and non-deterministic, so
irreplaceable), skeleton contracts and manifests, and runtime GLBs under a few MB.
Every image dragged into Tripo is first committed under `docs/art-pipeline/concepts/`,
and every accepted output under `docs/art-pipeline/sources/`, so a body can be rebuilt
from the exact bytes.
Not committed: Blender files, diagnostic renders, numpy dumps, anything a script
regenerates. Only the KayKit dungeon kit stays fetched, pinned to an immutable commit
with SHA-256 checks, until its Tripo replacement models land. Git LFS is not installed
and not needed at this size; revisit past roughly 50 MB.

## AI motion and rigging models

| Option | Verdict | Fit |
|---|---|---|
| MoMask, MDM, MotionGPT, T2M-GPT, MotionLCM, MotionGPT3, MotionStreamer | blocked: trained on HumanML3D, whose AMASS sources prohibit commercial training and use | out |
| HY-Motion 1.0 (Tencent) | blocked: licence does not apply in the EU | out |
| Kimodo-SOMA-RP v1.1 (NVIDIA, 2026) | clear: model card says ready for commercial use, NVIDIA Open Model License, Notice file on redistribution | optional later source for humanoid hero motion. Text prompt to a 30-joint skeleton at 30 fps, max 10 s. Humanoid only. CUDA GPU only, so a cloud GPU job, and it needs a tested retarget to `humanoid.v1` behind the same seam |
| UniRig, SkinTokens (VAST, MIT) | clear code and weights; training provenance unclear, which does not taint a rig produced for our own mesh | candidate fitter for the ash wolf and later bodies. CUDA GPU, 8 to 14 GB VRAM, so a cloud job. Our landmark fitter stays the fallback |
| RigAnything | blocked: non-commercial research licence | out |
| Auto-Rig Pro | outputs are ours; Smart is humanoid-only; no supported headless API for Smart or Remap | benchmark only, never in the automated path |
| Blender automatic weights, Rigify | clear | automatic weights in the fitter; Rigify metarigs (Wolf, Horse) as a bone-layout reference for `quadruped.v1` |
| Three.js CCDIKSolver, IK-threejs, three-zoo TwoBoneIK | MIT | not needed: the two-bone leg solve is a few lines of analytic maths and stays dependency-free |

Consequence: procedural motion is the backbone for every family. Kimodo and UniRig
are upgrades that plug into the same seam and asset gates when a cloud GPU is worth
paying for, not prerequisites.

## Slices, one PR each

The KayKit bodies were placeholders and are now retired. Masculine-v3 is the only
runtime body for the player and every monster. The KayKit dungeon kit remains while
its Tripo replacement is still concept-only.

0. **Docs and disposition.** Correct the GDD, record the decisions, add this
   document, close the archived spikes.
1. **Seam refactor.** `MotionDriver` and `RigInput` own the lifecycle and replicated
   inputs; `windupTotal`/`recoveryTotal` live in the sim.
2. **Procedural locomotion** supplies idle, walk, run, dash, death settle, flinch and
   skill poses. It was first exercised on the now-retired KayKit knight; masculine-v3
   is the only body and procedural motion is the only runtime driver. Gates remain no
   foot slide, zero root drift per loop, no allocation in the frame path, one perf
   baseline, and the live review page.
3. **Own humanoid body** through the asset path on `humanoid.v1`: the masculine
   Tripo mesh already exists, so this validates the normalise, rig, profile and
   verify steps with the least new risk. Replaces the knight.
4. **Ash wolf** through the asset path on `quadruped.v1` with a four-leg gait. Runs
   in parallel with slice 3 (both are Blender fitter work) and is the proof that a
   second family goes through the same pipeline. If the foreleg mapping onto
   `shoulder`/`elbow`/`hand` fails here, the joint set is redesigned before skills.
5. **Procedural skills**: cleave, firebolt, frost nova, monster bite, bolt, slam,
   authored once against semantic joints with per-profile axis correction, phased to
   windup and recovery. Procedural becomes the default.
6. **Body consolidation**: swarm, ranged and brute use masculine-v3 alongside the
   player. KayKit body fetches and the clip driver are removed; the dungeon kit stays
   until replacement environment models exist.

Every slice attaches its doc updates: `CLAUDE.md`, `docs/architecture.md`,
`docs/quality.md` where gates change, `README.md`, `src/sim/CLAUDE.md` when the
timer totals land.

## Related issues

Tracked separately as issues #21 and #22, not blocking this pipeline's slices.

## Acceptance for the whole pipeline

- Every animation slice ships a live review page (state, speed and body controls at
  the gameplay camera) served for remote viewing, and a recorded GIF on the PR. The
  PR stays unmerged until Rocco has watched it. Measured gates are necessary, not
  sufficient: earlier spikes passed their metrics with motion a human rejected.

- `npm run gate` and `npm run gate:perf` green on every slice.
- The sweep is byte-identical per seed on every slice.
- Slice 4 done means a second family went end to end without a new animation
  system, which is the definition of "achievable" for the GDD.

## Non-goals

No Mixamo lock-in, no Tripo rig or animate, no hosted motion services, no models on
non-commercial data, no modular head socket yet, no hand-authored keyframes in
Blender, no stun or knockback presentation until the sim has them.
## Gear: fitting pieces to a body

Gear is a separate skinned mesh bound to the body's own skeleton, so every piece
moves with the same procedural driver and no piece ever carries animation. The body
can still be shown bare: masking a worn region is a runtime index edit, never a
change to the shipped mesh.

```
npm run art:gear -- --input <piece.glb> --slot <slot> --body <body> --piece <name> \
  [--weights transfer|stiff|rigid] [--covers <slot,slot>] [--span AXIS:FROM:TO[:FACTOR]] \
  [--yaw 0|180] [--under <piece,piece>] [--no-mask] [--outdir <dir>]
```

Writes `public/gear/<piece>/`: `<piece>.glb`, `<piece>.manifest.json`,
`<piece>.report.json` (every measurement), `<piece>.review.png` (not committed). Same
contract as `art:fit`: a failed gate deletes the GLB and exits non-zero named after
it. `--input proxy:<slot>` builds a test piece from the body's own region instead of
importing one (see "Proxy fixtures"). Every flag has a contract default, so a piece
that matches its slot needs none of them: `--covers` overrides the slot's
`defaultCovers` (`legs` spans `legs,waist`, `chest` spans `chest,shoulders`, every
other slot spans itself) and `--span` overrides a slot whose `align.span` names two
landmarks. What `--covers` names is an alignment and fitting reference only — what a
piece hides is measured off the fitted piece (see "Masking").

Eight slots, three of them pairs: `feet`, `hands`, `shoulders` (two islands, one per
side), and `legs`, `waist`, `chest`, `back`, `head` (one). `back` is the outermost
attachment: a shoulder wrap, wings, a backpack or hanging fabric. Its contract region
is empty, so it aligns against the chest's via `referenceSlot`.

A slot's region lives in `humanoid.v1.json`'s `slots` block as `{bone, along}` rules:
a body vertex belongs to the slot when its dominant bone (largest skin weight) is
named and its position along that bone's landmark segment, a 0-1 fraction, falls in
`along` (default the whole bone). An optional `forward: [zMin, zMax]` bounds the rule
in metres along runtime +Z, measured from the bone's head landmark, so a rule can take
the back of a bone's skin without its front — a hood claims the skull behind the ear
line but never the face. `fit/masks.py` resolves this once per body into
`<body>.masks.json` — vertex indices per mesh, per slot — which the gear fitter reads
to align and to fit. Nothing masks by it.

**Masking is computed per piece.** An authored region stops where the anatomy does
and a garment does not: a waistband climbs above the waist, a sleeve stands off an
upper arm no region claims. So after shrinkwrap and weights, at bind, the fitter
measures which body vertices the fitted piece covers — a ray from the vertex along
its own normal reaches the piece within the slot's `coverReach`, or the piece has
swallowed the vertex whole — and writes them into the manifest as `hides`, vertex
indices per body mesh. `--no-mask` writes an empty `hides`.

**The rim rule.** A body triangle is dropped from the drawn body only when all three
of its vertices are hidden. One or two hidden corners makes it a rim triangle: still
drawn, but never counted by the bind gate or the clip gate, because skin the garment
has already eaten is skin nothing can be seen clipping through.

**Alignment.** The reference extents are the union of the regions the piece spans,
per side for pairs, so a trouser that covers `legs,waist` reaches the natural waist
rather than the hip crease; `back` borrows the chest's via `referenceSlot`, and a
proxy is measured against the one region it was carved from. The piece is scaled
uniformly so its extent along the reference's `span.axis` matches the reference's
own extent times `factor`, then translated so each axis's anchor (piece
min/centre/max onto body min/centre/max, plus a metres offset) lines up. A slot whose `align.span` carries `from` and `to`
measures itself against those two landmarks instead, for a garment whose height the
region cannot express: `head` is `Y:neck_base:head` at 1.08, so a hood with a mantle
needs no flag. `--span AXIS:FROM:TO[:FACTOR]` overrides it. A proxy ignores both and
keeps its own region's extent, because it is already that region's shell. Yaw is 0: every source is generated facing
+Z, so a piece that needs turning says `--yaw 180` rather than letting the fitter
guess — it used to vote between the two by counting vertices inside the body, and
that put the boots, the trousers, the tunic and the hood on backwards. Both counts
stay in the report next to `facing`: how far ahead of its region the piece sits, and
for a foot slot how far each island's centroid is ahead of that side's ankle. How much of the piece lands inside the body before any
correction is reported two ways, by parity and by the part of it deeper than 5mm; a
gate that grew the piece until the first number cleared was tried and removed,
because a copy of the body pushed a centimetre and a half outward still reads 15%
inside by parity and 0% deep, so the number does not separate a fitted piece from a
buried one. Shrinkwrap follows: the whole piece is pulled
to `clearance` metres outside the body, repeated up to eight times because one pass
only moves a vertex to the nearest surface, which between a skull and its hair is the
wrong one, and then a `hug` vertex group — the bands of the piece's
own span that should hug (a cuff, a collar, the belt) — is pulled onto the skin
within `hug.reach` of it, smoothstepped at the edges. A slot with nothing to hug
leaves `hug.bands` empty: a hood pulled onto the scalp stops being a hood. The report
carries what shrinkwrap moved as a fraction of the piece, because a pass that moves
most of a piece is a reshaping and the alignment above it is what wants fixing.

**Limb alignment.** A source is modelled standing on its own and a body's limbs are
not axis aligned, so scale and anchors alone leave a boot's vertical shaft 4.8cm off
a shin that leans 5.9 degrees inward, and the outside pass then wraps the shaft onto
the calf instead of correcting it. A slot may declare `align.limb: {bone, band, fade}`:
after the anchors, the band — a fraction of the piece's extent along that bone, 1.0
being the cuff and 0.0 the toe or the fingertip, because a bone points at its child
and so runs tail to head up the limb — is turned onto the bone's own direction about
its lowest cross-section centroid and seated onto the bone's line, smoothstepped to
nothing across `fade` so the anchored end never moves. The turn alone is measurably
worse than doing nothing (the shaft then leans correctly through the wrong place),
which is why the seat goes with it. Only `feet` carries one: `hands` was given the
same rule on the assumption a gauntlet's cuff needed it, and the first fitted pair
said otherwise — a cuff band is where the piece is anchored, so swinging it drags the
glove off its own anchors (12mm and 17mm of residual against none, and half again as
much for the shrinkwrap to correct). A slot earns a `limb` from a measurement, not
from the shape of its name. The report records the correction angle, and a proxy
skips it, being already carved off these bones.

**Roll and enclosure.** Two more alignment steps a slot can ask for, both born of the
same thing: a Tripo source is built from a concept drawn in whatever pose read best on
the page, not in the body's rest pose. `align.roll: {bone, stepDegrees}` turns the
island about the limb through a full circle and keeps the angle that fits best,
scored on the region the piece reaches: mean distance from region vertices to the
piece surface, plus a penalty per region vertex left outside the shell by ray parity,
because a glove is judged by whether the hand is in it rather than by how close it
passes. The gloves' concept was drawn back-of-hand to the viewer, so the fitted pair
was rolled a quarter turn off a hand that hangs palm to thigh and the fingers came out
through the palm; the search moves the score from 76 to 70 and lands on 260 and 100
degrees, mirrored, with the neighbouring step second. **The line is the tube's axis
when the slot has one**, not the named bone: the stations the tube measures have to
survive the roll, and this body's forearm leaves the wrist 11.5 degrees off the hand,
enough to move the fingertip station 3.6cm and stretch the cuff to twice its length.
The bone is still what names the roll in the report. The angle is not searched for blind: a slot's `thumb` says which way a
worn thumb points on this family (`+Z`, forward, for a hand hanging in the A pose) and
`--thumb <+Z|-Z|inward|outward>` says which way the source's own thumbs point in its
frame, so the roll is the turn that maps one onto the other and the seating score only
refines it within 20 degrees. A near-symmetric hand cannot be told from its mirror by
any measurement of shape, which is what an earlier search learned the hard way: it
picked the mirror and scored it best. `align.enclose` grows a piece until a bone's
skin is inside it; it is kept in the code and the schema but no slot uses it, because
`replaces` made it unnecessary for skin and its growth flared the cuff.

**`regionEnclosed`** is the report line these produced and the one to read first on a
new piece: the fraction of the region inside the fitted shell. The set reads boots
0.885, trousers 0.899, tunic 0.877, gloves 0.786, hood 0.505 (a hood is open at the
face). The gloves read 0.40 when the reviewer rejected them and 0.51 once the roll
stopped moving the stations, so it is the number that tracked every fix. No gate
catches this, because every gate asks whether the piece clears the body and a garment
sitting beside a limb clears it perfectly.

**Tube fit: one model, many bodies.** A piece is authored once and has to fit every
body the game grows, and races differ in hand and limb size, so a source cannot be
scaled uniformly onto a body and then have the shrinkwrap argue with what is left: a
glove scaled to reach the wrist has fingers the wrong length, and growing it until
they are covered turns the cuff into a bell. `align.tube` deforms the piece onto the
limb instead. Along the axis it stretches piecewise so the piece's own stations —
fingertip, the narrowest cross section, cuff — land on the body's, which lets fingers
lengthen or shorten without dragging the cuff with them. The narrowest cross section is
measured about each slice's own centroid rather than about the axis, or a roll about
that axis moves the station it finds. Across the axis it slices the piece every 2cm and
**carries the piece onto the body's own cross section** before widening it until it
clears by the slot's clearance. **The widening is a profile, not a factor per slice.**
A factor per slice ripples: neighbouring cross sections of a source differ by more than
the body does, and the piece came out corrugated, faint rings of different girth down
the cuff and worse in motion. A garment changes girth where it changes station, so the
profile is knotted at the stations themselves — fingertip, wrist, cuff for `hands`, the
band's ends for `feet` — each knot the median of the ratios of the three nearest slices,
straight lines between the knots and held flat beyond the ends.

Each slice's reach is measured with its spurs dropped, points further from the section's
own centre than twice its median radius, and the same way on both sides so the ratio
compares palm to palm. Plain min and max let one spur speak for a whole cross section: a
thumb, or the 305 forearm-weighted vertices this body carries 10cm in front of its arm,
which widened the glove's palm to palm-plus-spur. A percentile per lane cannot see that
one — it is a sixth of the section and all of it at one end.

**A piece that replaces the skin under it keeps its own shape.** `slot.shrinkwrap` says
how much of the correction that skin gets: `all` everywhere by default, and `unreplaced`
for `hands`, where the outside pass and the hug fade out over the last 3cm before the
skin the glove stands in for. A glove is not worn over a hand, it replaces it, so
wrapping it onto skin nobody sees only gives the glove the hand's shape — a fat thumb
and a crumpled pinky edge — instead of its own at the hand's size, which the tube fit
already gave it. The cuff is worn over a real forearm and is still corrected onto it,
which is what the fade is for; and `piece_sits_off_the_skin_at_bind` measures against
skin the piece does not hide, so the replaced hand never enters the gate either way.

`tube.radialKnots` says where the girth is measured, in station space: `0` is the first
station, `1` the second, `1.5` half way between the second and third. `hands` measures at
`[0.0, 1.5]` — the cuff and the palm — so its hand is one factor and its cuff another,
with a straight line between them. A factor per station let the fingertips ask for their
own ratio, and the glove's curled source fingers against a flat hand fattened the thumb.
The carry never uses these knots: it is where the piece sits, not what shape it is.

`tube.radial` says what the widening is for: `enclose` never shrinks a knot, so the piece
ends up round whatever it holds, and `match` sizes it to the body's own cross section
within [0.85, 1.35] and may shrink one. A slot whose `replaces` already takes the skin
away wants `match` — the glove has to be the hand's size, not merely fit round it, and
`enclose` plus a 1cm clearance read as mittens. `feet` stays `enclose`; `hands` matches
at 3mm of clearance, because leather is skin-tight and the tunic's sleeves are too short
to layer over a cuff. The report carries the knot factors and the raw ratio per slice,
which is how the source is told from the fit. The carrying is what makes a long
cuff wearable: widening an off-centre slice about the axis only throws it further off,
which stood the gauntlet's cuff 7cm clear of the arm and belled it out to reach back —
the funnel the reviewer saw from the side. **`tube.centre` says how a piece is carried**:
`none` everywhere by default, `limb` for a shaft that has to follow a bone along its
length, and `cuff` for `hands` — one rigid shift for the whole island, measured at the
cuff station, which centres the cuff on the forearm and moves the hand with it. A shift
per slice follows the body's own wandering centroid rather than the limb — 4.2cm of it
down this shin — and the boot's shaft came out kinked and crumpled instead of straight.
Knotting it at the stations fixed that and left a smaller one: a hand's own cross section
is centred toward the thumb of the wrist's, so the glove's hand was carried a few
millimetres to the pinky side of its cuff and the wrist line had a visible kink in it.
A piece whose skin the slot replaces is one object at the body's size; where it sits is a
property of the whole of it, not of each station. A boot bends at the ankle, so its foot and
its shaft are two axes and only the shaft is tubed: `feet` carries the axis and a band
above the ankle and no station stretch, and the foot is left as the source drew it.

**The outside correction runs to a fixed point.** It used to stop as soon as the piece
was clear of the region it covers, and a region is generous: the pauldron was outside the
`shoulders` region after one pass and still 7.3mm inside the trapezius skin it does not
hide, which is the skin `piece_sits_off_the_skin_at_bind` measures against. So the loop
now ends when a pass stops moving the piece, up to eight passes, and the per-pass counts
stay in the report. **A weighted pass is applied once**, because repeating a correction
faded to a fraction converges on the unfaded one and erases the fade.

**Drapes: the cloth that hangs.** A sash below a belt band, the cloth under a pauldron,
everything below a cape's yoke — none of it is skin over a bone, and weighting it to one
makes it a plate. `--drape name:attachBone:from:to[:segments[:restDegrees]]`, repeatable, gives that
band its own short chain of bones: `from` and `to` are fractions of the island's own Y
extent after alignment, so `sash:pelvis:0.0:0.58:2` hangs the lower 58 percent of the
belt off the pelvis in two segments. For a pair the drape is declared once for the left
island and the fitter swaps `_L` for `_R` and names the drapes `<name>_L` and `<name>_R`.
Rigid attachments such as backpacks and rigid wings omit `--drape`. When one connected
cloth island hangs from several places, repeat the flag with the same band and a unique
name for each attachment. Overlapping band vertices go to their nearest attachment in
the horizontal plane, so the left arm, torso and right arm drive independent panels.

The chain's root is the centroid of the vertices in the 1.5cm ring below the `to` line,
and it runs from there to the band's own bottom, split into equal bones
`drape_<name>_<n>` parented under the attach bone and then each under the one above.
Inside the band a vertex hangs between the two chain joints it lies between, a rope with
two influences; across the 3cm below the `to` line those weights blend into the body
weights the transfer gave it, so the root does not tear, and above the line nothing
changes. The exported skin is **the body's joints in the body's order, then the drape
bones appended** — the runtime binds the piece to the body's skeleton by index and adds
the extras under the attach bone — and `piece_joints_match_the_body` is the gate that
says so: the first N joints are the body's, every extra is a declared drape bone, and
each is parented where it was declared. The manifest carries a `drapes` block per chain:
its bones, the segment length, the root at bind and `toward`, the horizontal direction
from the root to the nearest skin, which is the way a swing would carry the cloth into
the body and therefore the way the runtime clamps it hardest. The review sheet renders
the chain at rest; motion is the clip gate's job.

The centreline is not the collision shape. The fitter samples every draped triangle at
its vertices, edge midpoints and centroid, then deterministically reduces those samples
to at most 24 supports per segment by farthest-point coverage. Each support retains up to
12 exact LBS terms: a term carries its source vertex position, joint and barycentric
weight, so adjacent chain weights and the body-to-drape fade deform exactly as the
rendered triangle does. The manifest schema enforces both bounds. This is why a wide
triangle cannot cross the body merely because its corners or the chain down its middle
remain clear.

Collision geometry is body-specific too. A fitted manifest carries capsule radii measured
from the target body's weighted skin for the torso, chest-to-neck shoulder shelf,
clavicles, arms and legs, plus a nearest fitted-body LBS anchor for each surface support.
There are no masculine-v3 thickness constants in the frame path. `bindDrapes` turns the
manifest into fixed typed arrays once; `stepDrapeChain` then uses bounded deterministic
coordinate descent over both swing axes, re-skinning descendant supports after every
candidate. A fitted drape with surface supports does not also collide its invisible
centreline: doing both drove short pauldron chains to their cone limit and visibly warped
the flap even though its surface was already clear. Legacy definitions without supports
keep centreline collision. Runtime and the clip gate call the same function, and the frame
path allocates nothing.

Shoulder plates keep the body's transferred clavicle, shoulder-helper and upper-arm blend.
Sharpening that blend into `stiff` weights made the plates move differently from the skin
under frost nova even while their hanging skirt cleared; the shoulders slot therefore uses
`transfer`, while the skirt's drape weights are still laid over that body blend below its
seam.

**The correction moves a garment's two walls together.** A cape is cloth with two
sides a few millimetres apart, and the outside pass is a nearest-point projection: the
inner wall starts deep in the body and lands on the skin plus the clearance, the outer
wall was already clear and does not move, and the two end up in the same place. The
shell is then flat, the walls interleave, and the piece renders as shards of its own
lining — which is what it looked like, and no repaint of the texture could have fixed
it, because the source's own texture was already right. So a vertex takes the largest
displacement of any vertex within `slot.shellRadius` of it (1cm by default, 0 disables),
provided that carrying it does not bring it closer to the skin than its own projection
did. A wall rides out with the wall beside it and the fabric keeps its thickness. Wider
is not better: at 2cm the carry walks a hood's crown 5.7mm and a cape's collar 8.7mm
into the skin, past what those slots allow, so a piece thicker than a centimetre asks
for it by name. The per-pass count of carried vertices is in the report.

**Cloth that swings hides nothing.** Body coverage is measured off the *fixed* part of a
piece only: every triangle with a corner weighted mostly to a `drape_` bone is left out of
both the ray test and the swallow test, because whatever a drape covers at bind is skin the
game has to draw the moment it swings. On this cape that is 4292 of 6000 triangles, and its
`hides` fell from 1778 body vertices to 434 — the yoke's own footprint, which is the part
that never moves. The report carries both counts. Runtime gear masking applies the same
triangle rule one layer up: a fixed yoke, wing root or backpack can hide a lower piece,
while triangles influenced by any drape chain cannot. A slot contract can still set
`hidesPieces: false` for a category of open attachments.

**Rest tilt.** The last field of `--drape` is `restDegrees`, how far off the body the chain
hangs at rest: a cape that hangs plumb sits on the seat and a sash on the thigh, and neither
needs motion to show it. The chain is hung that far from `toward` about the root, and the
band is turned with it — by the whole angle at the hem and none of it at the top, because a
band that rings the body has sides off the hinge and turning those rigidly lifts them into
the shoulders it hangs from. The hem lands where the chain's tip does either way. It suits a
band that hangs to one side. The current pauldron, belt and cape all ship at 0 degrees:
the cape's tilt walks its hem into free space behind the legs where the ray test cannot
answer over an open garment shell, and the belt's sash tilts into the tunic's skirt. A
piece can enable the tilt once the garment beneath it provides a closed surface.

**Two-sided cloth.** `--two-sided` repaints a piece whose lining and outer face were baked
from each other: each triangle is called outer or inner by its own normal against the
horizontal direction from the spine axis, the two dyes are found by clustering the covered
texels in hue, the outside takes whichever it is mostly painted in and the lining takes the
other, and every texel a side owns is set to that dye at its own brightness so the baked
folds survive. Texels no triangle covers are left alone. It is opt-in and recorded in the
manifest, and it is not what fixes a shell whose two walls have been flattened into each
other by the outside pass — that reads as shards of both colours no matter what the texture
says, and the fix belongs upstream of the paint.

**Replacing rather than covering.** A slot's `replaces`, written in the same
region-rule shape as `region`, names the skin the piece stands in for: the hand for
`hands`, the foot for `feet`, nothing for the cloth slots. What a piece hides is the
union of the coverage measured off the fitted piece and that replaced region, so a
glove hides the whole hand even where it does not quite reach — the way an armoured
game does it — and no fingertip pokes through as bare skin. `hands` replaces the lower
third of the forearm as well, because a coverage ray cannot save a vertex whose own
normal points away from the garment: the arm stood 6mm proud of the cuff at the back of
the wrist and read as a patch of skin through the leather. The band ends at 0.70 because
the poke-through vertices stop at 0.744 and the skin above the cuff's rim starts at
0.664 — a gap the boundary sits in, so no bare arm is hidden and no patch shows. The two counts stay separate
in the report, because a replaced region hiding much more than the coverage means the
piece is the wrong size and the tube fit is what answers that.

**Weights and export.** `transfer` copies the body's cleaned weights by nearest-face
interpolation, keeps only the slot's `allowedBones` (a pair's side keeps only its own
`_L`/`_R` bones plus unsuffixed ones), sends orphans to the nearest allowed bone
segment, caps four influences and renormalises. A slot's list has to reach every bone
the garment rides: `legs` includes `spine`, because a waistband weighted to the pelvis
alone shears through the belly the moment the torso flexes forward. Since masks are
computed, a slot's `region` now only sets alignment extents and carves proxies, so it
is drawn tight to the anatomy rather than widened to cover a garment. `stiff` runs the
same transfer and then raises each weight to the slot's `stiffness` power, keeps the
two strongest and renormalises, so a leather or plate piece hinges in a thin band
instead of smearing the way skin does: the boots' band of vertices holding no bone
above 0.8 fell from 751 (11.9% of the piece, 16.5cm tall) to 57 (3.8%, 11.8cm), and
`feet`, `hands`, `head` and `shoulders` default to it while the cloth slots stay on
`transfer`. The report carries that band per island. `rigid` gives
every vertex weight 1.0 on one bone (per side for pairs). Either way the piece exports on the body's own
joint list with identical inverse binds, so the runtime binds it straight to the
body's `Skeleton`.

**Gates.** Blender-side (`scripts/art/gear/gate.py`), measured off the exported
file: joints and inverse binds match the body, at most four influences summing to
one, every influence an allowed bone, triangle and material budgets, UVs and
textures surviving, rest axes identity, the piece clear of the skin at bind, toes
ahead of the ankles for a foot slot (`toes_point_forward`), one
mesh (or, for a pair, at least one island each side of the midline: a pauldron is
plates plus a drape). The bind gate counts a vertex as inside only when ray parity and
the nearest counted triangle's own normal agree: a head is a shell with sockets, and
parity alone reads a point a centimetre off one as buried. Where the two disagree the
vertex is no hit and the report counts it under `bindClearance.disagreeingVertices`,
because a piece that racks them up sits where the body cannot be measured. Two clip
gates (`scripts/art/gear/clip.ts`) run after:
`clears_the_body_through_motion_cycles` and `clears_the_body_through_stress_poses`.
Each skins the piece onto the body's own bones through 32 phases of walk, run,
`cleave`, `firebolt`, `frost_nova`, `dead`, then bind, two abductions, two arm
flexions, two spine twists, a torso flex and a hip-plus-knee flexion — the far ends
of the rig, not anything an animation plays. 180-degree abduction is deliberately
absent and 150 is advisory: linear skinning folds this body's own shoulder through
itself up there, so the pose measures the body rather than the piece, and no skill
raises an arm past 90. An advisory pose is still walked and still written to
`clip.json`, under `advisory`, but it gates nothing. A piece fails when more than the slot's `clip.fraction` of its vertices sit
deeper than `clip.depth` inside the body the rim rule still counts — a hidden or rim
triangle still tells a vertex which way is out, but never counts as a hit.

**Proxy fixtures.** `--input proxy:feet`, `proxy:head` and `proxy:cape` build a piece from
the body's own slot region, offset outward along its vertex normals, so a fitter run
needs no paid Tripo asset (alignment forced to `factor` 1.0, zero offsets — a proxy is
already the body's own shape). They exist to prove the fitter reproduces byte for byte
(`tests/fixtures/gear/proxy-{feet,head,cape}/`); the head proxy is the one whose `hides`
spans five body meshes. `proxy:cape` builds a narrow back-only yoke and sheet, then proves
surface-supported drapes reproduce and clear every motion without masking the body.
A proxy is a region's shell, not a garment: `proxy:legs` has no
waistband, so its top rim presses into the belly at 90 degrees of hip flexion and it
fails the clip gate honestly — it only ever passed while `--covers legs,waist` masked
that belly away. They are fixtures, not production art, and the review page never
lists them.

**Layering.** Every piece is fitted against the bare body, so nothing in a per-piece
gate can see a hood's mantle inside a tunic collar. Each slot carries a `layer` and
stands off the skin by a `clearance` that rises with it — `legs` and `hands` 1, `feet`
and `chest` 2, `head` and `shoulders` 3, `waist` 4, `back` 5 — so an outer piece is
always further out than what it covers, and `tests/art_contracts.test.ts` refuses a
contract where a higher layer sits closer in. The ladder is ceilinged by what the
pieces carry: above 0.016 the hood loses `clears_the_body_through_motion_cycles`,
because a mantle pushed off the skin stops hiding the shoulder it is measured against.
Shoulders deliberately share headgear's tier above chest: a tunic can never mask a
pauldron, while a pauldron may mask chest geometry underneath it.
`--under <piece,...>` names the fitted pieces this one is worn over: their shells
join the body in the surface the shrinkwrap pushes out of and the bind gate measures
against, so a hood is fitted around a tunic collar rather than through it, and the
manifest records what it was fitted over. Coverage stays body-only — gear never masks
gear at fit time, because which pieces are worn together is a runtime question. It
follows that a set is fitted from the skin outward: trousers, then the tunic under
which they sit, then the hood.

Shoulders use the same command for every set; the asset names are inputs, not fitter
rules:

```bash
npm run art:gear -- --input <shoulders.glb> --slot shoulders --body <body> \
  --piece <name> --under <chest-piece> --drape <name>:upper_arm_L:<from>:<to>:<segments>
```

The fitter refuses an under-piece from another body or the same/higher layer, measures
the smallest configured cap seat that clears the lower shell, and records both the dependency
and the per-side measurement in the manifest. A paired seat can mirror its direction so
left and right caps move outward while their measured band stays on the vertical axis.
The cap keeps its transferred clavicle,
shoulder-helper and upper-arm weights; only the declared hanging band receives drape
weights, so choosing its attach bone never rewrites the fixed plate.

`node --import tsx scripts/art/gear/clip.ts --set <dir> --set <dir>` skins a worn set
through bind, walk and run and counts the vertices of a higher-layer piece more than
3mm inside a lower-layer one. It is advisory and gates nothing: a cloak resting on a
pauldron can be a set that works, while a fixed shoulder cap deeply inside its tunic is
evidence that the configured seat is too small.

**Runtime and review.** `src/render/gear.ts`: a piece binds to the body's own
`Skeleton` object as a sibling `SkinnedMesh`; `applyBodyMasks` takes the union of the
worn pieces' `hides` and drops from the index every body triangle whose three vertices
are all in it, sharing every attribute by reference. The body sidecar is not a runtime
file: the page reads each piece's own manifest. Wearing a piece costs exactly one more draw call.
`applyGearMasks` does the same for gear under gear, which the fitter cannot bake because
which pieces are worn together is only known here: `src/render/gearcover.ts` sorts the
worn pieces by their slot's `layer` — never by the order they were put on — and drops
from each piece the triangles whose three vertices are all covered by a higher one.
Its rule is not the body's, deliberately. A vertex counts only when it is **inside**
the higher piece, by ray parity along three axes, and deeper than 4mm. A normal ray
was tried first and opened holes: a tunic hem passing above a trouser hip and a boot
cuff meeting a trouser leg both catch the ray while occluding nothing, and the
triangles they took read as dark rectangles the moment the camera came off axis.
Parity rather than the nearest triangle's normal, because a garment is an open shell
and everything under an upward-facing hem reads as behind it; each ray starts a
fraction of a millimetre off its axes so a shared edge is not counted twice. Wearing
all four warden pieces hides 19.4% of the trousers and 8.3% of the tunic, costs one
55ms pass on wear and nothing per frame, and taking the outer piece off puts the
triangles back. The triangle grid it searches with is the one
`scripts/art/gear/penetration.ts` measures the clip gate with. The motion
review page's Gear panel (`spike/motion/gear.ts`) lists every fitted piece under
`public/gear` — proxy fixtures excluded — with a checkbox each plus "Wear all" and
"Bare".

Commit gear the way a body is committed: concept images under
`docs/art-pipeline/concepts/gear/<set>/`, accepted Tripo GLBs under
`docs/art-pipeline/sources/gear/`.

Refitting a piece to a second body (Surface Deform onto the shared bones, retransfer
weights, rerun the gate) is not built: no second humanoid body exists yet to refit
onto.
