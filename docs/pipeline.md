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
  [--weights transfer|rigid] [--covers <slot,slot>] [--no-mask] [--outdir <dir>]
```

Writes `public/gear/<piece>/`: `<piece>.glb`, `<piece>.manifest.json`,
`<piece>.report.json` (every measurement), `<piece>.review.png` (not committed). Same
contract as `art:fit`: a failed gate deletes the GLB and exits non-zero named after
it. `--input proxy:<slot>` builds a test piece from the body's own region instead of
importing one (see "Proxy fixtures"). `--covers` names the slot regions the piece
hides, its own slot by default: a short-sleeved tunic covers `chest,shoulders`, and
both the bind gate and the clip gate stop counting what a covered region hides.

Eight slots, three of them pairs: `feet`, `hands`, `shoulders` (two islands, one per
side), and `legs`, `waist`, `chest`, `back`, `head` (one). `back` is the cloak: its
contract region is empty, so it never masks body geometry.

A slot's region lives in `humanoid.v1.json`'s `slots` block as `{bone, along}` rules:
a body vertex belongs to the slot when its dominant bone (largest skin weight) is
named and its position along that bone's landmark segment, a 0-1 fraction, falls in
`along` (default the whole bone). `fit/masks.py` resolves this once per body into
`<body>.masks.json` — vertex indices per mesh, per slot — which the gear fitter and
the runtime both read.

**Alignment.** The piece is scaled uniformly so its extent along the region's
`span.axis` matches the region's own extent times `factor`, then translated so each
axis's anchor (piece min/centre/max onto body min/centre/max, plus a metres offset)
lines up. Pairs align each island to its own side's region (`_L`/`_R` bones); `back`
borrows the chest's extents via `referenceSlot`. Yaw is tried at 0 and 180 degrees
about +Y, and the orientation with fewer piece vertices landing inside the body wins,
ties broken by lower mean distance to the surface. Two shrinkwrap passes follow: the
whole piece is pulled to `clearance` metres outside the body, then a `hug` vertex
group — the bands of the piece's own span that should hug (a cuff, a collar, the
belt) — is pulled onto the skin within `hug.reach` of it, smoothstepped at the edges.

**Weights and export.** `transfer` copies the body's cleaned weights by nearest-face
interpolation, keeps only the slot's `allowedBones` (a pair's side keeps only its own
`_L`/`_R` bones plus unsuffixed ones), sends orphans to the nearest allowed bone
segment, caps four influences and renormalises. `rigid` gives every vertex weight 1.0
on one bone (per side for pairs). Either way the piece exports on the body's own
joint list with identical inverse binds, so the runtime binds it straight to the
body's `Skeleton`.

**Gates.** Blender-side (`scripts/art/gear/gate.py`), measured off the exported file:
joints and inverse binds match the body, at most four influences summing to one,
every influence an allowed bone, triangle and material budgets, UVs and textures
surviving, rest axes identity, the piece clear of the skin at bind, one mesh (or two
islands for a pair). Two clip gates (`scripts/art/gear/clip.ts`) run after:
`clears_the_body_through_motion_cycles` and `clears_the_body_through_stress_poses`.
Each skins the piece onto the body's own bones through 32 phases of walk, run,
`cleave`, `firebolt`, `frost_nova`, `dead`, then bind, two abductions, two arm
flexions, two spine twists, a torso flex and a hip-plus-knee flexion — the far ends
of the rig, not anything an animation plays. 180-degree abduction is deliberately
absent: linear skinning folds this body's own shoulder through itself there, so the
pose would measure the body rather than the piece, and no skill raises an arm that
far. A piece fails when more than the slot's `clip.fraction` of its vertices sit
deeper than `clip.depth` inside the *visible* body — a masked triangle still tells a
vertex which way is out, but never counts as a hit.

**Proxy fixtures.** `--input proxy:feet` and `--input proxy:legs` carve a piece from
the body's own masked region, offset outward along its vertex normals, so a fitter
run needs no paid Tripo asset (alignment forced to `factor` 1.0, zero offsets — a
proxy is already the body's own shape). They exist to prove the fitter reproduces
byte for byte (`tests/fixtures/gear/proxy-{feet,legs}/`); the legs proxy declares
`--covers legs,waist`, because a waistband sits in the waist region. They are fixtures,
not production art, and the review page never lists them.

**Runtime and review.** `src/render/gear.ts`: a piece binds to the body's own
`Skeleton` object as a sibling `SkinnedMesh`; `applyBodyMasks` drops body triangles
whose three vertices all sit inside a worn slot's mask from the index, sharing every
attribute by reference. Wearing a piece costs exactly one more draw call. The motion
review page's Gear panel (`spike/motion/gear.ts`) lists every fitted piece under
`public/gear` — proxy fixtures excluded — with a checkbox each plus "Wear all" and
"Bare".

Commit gear the way a body is committed: concept images under
`docs/art-pipeline/concepts/gear/<set>/`, accepted Tripo GLBs under
`docs/art-pipeline/sources/gear/`.

Refitting a piece to a second body (Surface Deform onto the shared bones, retransfer
weights, rerun the gate) is not built: no second humanoid body exists yet to refit
onto.
