# Tripo style-coherence test

This experiment tests whether the current Ashveil art direction survives a complete
image-to-3D pass across three different asset classes. It is evidence for the GDD's
AI-assisted pipeline direction, not an approved production asset set.

## Shared style contract

- deliberate low-poly forms with anime-adjacent silhouette clarity;
- broad clean planes and gently exaggerated proportions;
- hand-painted-looking colour with restrained PBR response;
- cream, teal, saffron, burnt orange, dark wood and copper;
- pearl-grey ash with sparse cyan-violet Veil fissures;
- no photoreal micro-detail, hard cel outlines, chibi proportions or gacha styling;
- geometry that can plausibly survive Smart Mesh, rigging and real-time rendering.

## Inputs

| Asset | Reference | What it tests |
| --- | --- | --- |
| Main character | `input/main-character.png` | Humanoid proportions, modular outfit readability and clean limb separation. |
| Ash wolf | `input/ash-wolf.png` | A coherent ash-transformation rule on an animation-ready quadruped. |
| Ashward gate | `input/ashward-gate.png` | Whether the same material and shape language transfers to modular architecture. |

The references were generated with built-in ImageGen from one shared prompt scaffold
and the same gameplay keyframe. Each uses an isolated subject, neutral lighting and
a simple background for image-to-3D reconstruction.

## Canonical humanoid base references

The modular-equipment experiment uses two body fits on one canonical skeleton. Both
bodies share height, joint placement, bind pose and a close-fitting under-suit. The
under-suit defines the body volume; all visible clothing and armour are separate
equipment assets.

| Body fit | Front | Back | Right |
| --- | --- | --- | --- |
| Masculine | `input/base-models/masculine-front.png` | `input/base-models/masculine-back.png` | `input/base-models/masculine-right.png` |
| Feminine | `input/base-models/feminine-front.png` | `input/base-models/feminine-back.png` | `input/base-models/feminine-right.png` |

These are separate files for Tripo's keyed multiview input. A left view is omitted
because the base geometry and under-suit are intentionally symmetrical. Before a
body becomes canonical, its generated mesh must be normalised to the shared skeleton
and verified against the other fit's joint landmarks.

The current references include simple hair for visual continuity, but hair is not
part of the canonical production body. If Tripo produces it as cleanly separable
geometry, remove it before normalising the body mesh; otherwise regenerate the base
with an exposed scalp. Production hairstyles will be separate cosmetics fitted to a
shared scalp envelope and head socket.

## First Tripo Studio result

The first manual Studio run generated the masculine body. Its untouched FBX is
retained at `output/base-models/masculine/raw/main-character-male.fbx` with SHA-256
`375e25dea0da0c8d4267ee4402a64cf4582520341b367e1163730b8f8fc56edb`.

Blender `5.2.1` and the runtime Three.js importer measured:

| Property | Result |
| --- | --- |
| Meshes | One FBX mesh object containing eight disconnected geometry islands |
| Topology | 10,925 vertices; 9,479 quads; 2,443 triangles; 21,401 runtime triangles |
| Hair | Separate 2,959-vertex island, so it can be removed without cutting the body |
| Other islands | Body, head, both hands and three small facial/eye pieces |
| Mesh health | 469 boundary edges, 475 non-manifold edges and two zero-area faces |
| Surface data | No UV layer, texture image, colour attribute, rig, weights or animation |
| Transform | One-unit total height and an unapplied 90-degree X rotation |

This is a useful topology prototype, not yet a canonical body. It is quad-dominant
rather than all-quad, and its silhouette matches the concept well. A production
derivative must preserve this raw file, remove the temporary hair, normalise scale
and transforms, decide which body seams remain intentionally separate, repair the
remaining topology issues, create UVs, rig to the canonical skeleton and pass joint
deformation tests.

## Repeatable masculine-model spike

The first preparation pass is automated through Blender rather than preserved as a
manual edit. The command only accepts the audited masculine FBX fingerprint and its
eight-island vertex signature. It fails closed for any other model until that model
receives an explicit, reviewed component map.

```text
npm run art:character-spike -- \
  --input docs/art-pipeline/tripo-style-test/output/base-models/masculine/raw/main-character-male.fbx \
  --output docs/art-pipeline/tripo-style-test/output/base-models/masculine/prepared \
  --target-height 1.8
```

The generated `report.json` is the machine-readable evidence record. The prepared
directory also contains the editable Blender source, bald-base and armor-fit GLBs,
front/back/right validation renders, and a fit-proxy diagnostic render. A successful
run atomically replaces the prepared directory, so partial reruns cannot mix with a
previous result.

Current evidence:

- the raw FBX hash remains unchanged;
- the hair island is excluded while the visually reviewed scalp remains complete;
- two zero-area faces are removed and normals are recalculated without welding or
  remeshing intentional component boundaries;
- the bald derivative is normalized to the provisional 1.8 m spike parameter;
- semantic separation produces seven meshes and seven primitives in the bald GLB,
  compared with the single Blender mesh in the raw FBX; this is evidence for later
  runtime packaging work, not an approved draw-call budget; and
- the axis-aligned torso shell is a negative fit-quality diagnostic: its jagged open
  boundaries and shoulder fragments demonstrate that production body masks need
  authored slot boundaries and animation-pose validation.

GDD candidates supported by this spike are keeping raw generations immutable,
maintaining bald mannequin derivatives with hair as a separate cosmetic, and using
one controlled mannequin before exploring more body shapes. The 1.8 m target is not
a canonical gameplay scale: the current actor view scales models from actor radius,
so asset-to-runtime scale remains open. Rigging, deformation stress poses, UVs,
textures, authored equipment masks, primitive consolidation and the feminine-body
comparison also remain open.

## Diagnostic rig spike

The prepared masculine mannequin can be bound reproducibly to the intentionally
minimal 20-bone diagnostic armature:

```text
npm run art:character-rig-spike -- \
  --input docs/art-pipeline/tripo-style-test/output/base-models/masculine/prepared \
  --output docs/art-pipeline/tripo-style-test/output/base-models/masculine/rigged
```

The command fails closed unless the prepared report, blend and bald GLB match the
audited source contract. It preserves their hashes, replaces its output atomically,
and emits an editable blend, one skinned diagnostic GLB, a machine-readable report,
shaded-wire front/back/right renders for bind plus five stress poses, and front/right
bind overlays that distinguish fitted targets from the exported bones.

Current structural evidence:

- all 7,966 vertices across seven semantic meshes received finite, normalized
  weights with at most four influences and the same armature modifier; shoulder,
  elbow and wrist transitions use deterministic geometry profiles rather than the
  initial broad automatic-weight transitions;
- `humanoid.v1` derives the shoulder pivot by extrapolating the proximal upper-arm
  medial axis from multiple cross sections. Its held-out residual is 6.3 mm, the
  raw bilateral reflection error is below 0.001 mm and both pivots remain inside
  the source envelope. Elbow, hip, knee and ankle targets use robust geometry
  slices, while wrists and neck use audited component seams;
- all 16 fitted joint targets retain their source components, sample counts and raw
  target/actual coordinates before the armature is created;
- the armature has 20 bones, with its root as the sole non-deforming bone, and its
  accepted masculine source-rest, runtime-rest and inverse-bind signatures are
  pinned in the versioned contract;
- the pelvis and authoring COG are derived from the bilateral hip midpoint; the
  sternoclavicular origin is measured independently from the upper torso rather
  than moving with the shoulder estimate;
- the editable blend retains a lightweight Blender-native FK/IK authoring rig with
  independently calibrated left/right elbow and knee poles. Evaluated authoring
  matrices are baked onto the constraint-free Ashveil deform rig; only that frozen
  rig is exported;
- every posed limb preserves its fitted rest orientation frame unless a bone-specific
  full orientation is authored. Arm poses transport independent geometry-derived
  humeral, forearm and palm frames through the bake; Blender and Three.js independently
  validate primary axes, normals, right-handedness and mirrored overhead frames within
  one degree. The audit rejects uncommanded axial twist above 60 degrees, mirrored
  overhead disagreement above 15 degrees, near-collinear poles and connected chain
  gaps above 1 mm;
- the editable blend stores six fully keyed poses with constant F-curves at 30 fps;
  the exported GLB contains both STEP and LINEAR transform tracks, so review tools
  sample just after each diagnostic marker rather than assuming identical key times;
- the runtime GLB retains seven meshes and seven primitives, one skin with 20 joints,
  and one named animation, with no armor proxy;
- all fixed head, neck and wrist seam correspondences remain below 30 mm and twice
  their own bind distance across the six poses;
- evaluated pose evidence records actual world-space endpoints, displacement axes,
  knee side/pole/flexion, sole-patch ground contact and head/face yaw rather than
  trusting the pose solver's requested targets; and
- source bounds remain finite and within the diagnostic ground tolerance.

This remains `diagnostic_not_production_ready`. Chest-local evidence, invariant to a
root/chest rotation, now records 14.93-degree bilateral clavicle elevation and about
50 mm of socket rise overhead;
the cross-body wrist and skinned hand centroid genuinely cross the midline; and the
deep bend holds the upper arm within 0.11 degrees of bind, flexes 127.5 degrees,
keeps the wrist within 0.11 degrees of the forearm and clears the torso by 90 mm.

Those pose corrections expose a source-topology blocker rather than resolving it.
With strict production thresholds unchanged, overhead shoulder covariance volume is
0.636-0.637 versus 0.70 required and its triangle-area p05 is 0.529-0.547 versus 0.60;
deep-elbow volume is 0.633 and p05 is 0.484. Wrist deformation passes, but its
separate source shells retain an 8.5-13.7 mm gap and 55.6-degree cyclic tangent
mismatch, so the seam is not a weld. Production acceptance is the conjunction of
posed deformation and wrist continuity; it remains false even if either subsystem is
considered alone. Smart Topology or equivalent authored joint loops are required
before this mannequin can be approved for animation or armor.

The long-stride frame has the correct lead/trail direction, pelvis axis, knee sides
and planted trail sole, but still exposes collapsed knee topology; it is negative
deformation evidence, not an approved motion. Production controls,
twist/finger/toe/facial bones, retargeting, root motion, feminine parity, armor
transfer, UVs, textures and canonical runtime scale remain unresolved. `humanoid.v1`
currently authenticates only this masculine diagnostic; it does not prove that the
feminine mannequin or any nonhumanoid can share its rest signature.

## Planned Tripo run

Tripo CLI `0.3.1` is installed globally and authenticated against the international
API. The first pass will use the documented `game-mobile` preset because it selects
the low-poly P1 path, targets 15,000 faces, produces 2K textures and converts to FBX.
The source task, preview and downloaded output will be retained for each asset.

```text
tripo make input/main-character.png --for game-mobile --name ashveil-main-character --out output/main-character --json --yes
tripo make input/ash-wolf.png --for game-mobile --name ashveil-ash-wolf --out output/ash-wolf --json --yes
tripo make input/ashward-gate.png --for game-mobile --name ashveil-ashward-gate --out output/ashward-gate --json --yes
```

No API generation request has been submitted because the authenticated API profile
has no credits. The first masculine-body result was generated manually with Studio
credits; Tripo Studio credits are separate from Tripo API credits.

## Acceptance review

The three outputs will be compared for:

- recognisable shared palette and material language;
- silhouette fidelity to the approved references;
- clean separation of limbs, cape, tail and gate opening;
- usable topology, UVs, textures, scale and pivot;
- gameplay-camera readability;
- suitability for later humanoid or quadruped rigging; and
- generation cost, failure rate and manual cleanup required.

## Look-development floor texture

The character review's optional Game look uses a painterly cream-stone floor texture
as a palette and gameplay-camera blockout. It is not an approved production material.
The full-resolution ImageGen result is retained at
`output/look-dev/textures/ashveil-cream-stone-v2-source.png` with SHA-256
`91d39bafb6abedd63b7f89b30c86cc1da527378db1e8043af762f1fca7d91f6c`. The 1024 px
runtime WebP is `spike/character/assets/ashveil-cream-stone-v2.webp`, SHA-256
`4f449880a573c13e881994cb0c2f28e9f1c96854c49478aa16d58538f4c01e27`.

The asset was made with a built-in ImageGen edit from the v1 generated source,
SHA-256 `c223028e98d496dc8df431d8ee9d3aeb9b83964a3c60cb60a06c755aceed1dd3`, using this
final prompt:

```text
Use case: precise-object-edit
Asset type: seamless square game floor albedo texture
Primary request: Make this exact painterly cream-stone floor texture genuinely seamless and tileable on all four edges.
Edit target: the supplied square floor texture.
Preserve: the warm cream/parchment stones, oxidized teal mineral accents, tiny saffron accents, broad hand-painted brushwork, medium irregular slab scale, light overall value, and neutral albedo character.
Change only: redraw/blend edge-crossing stones, grout, and color fields so the left edge continues perfectly into the right edge and the top edge continues perfectly into the bottom edge. Remove any visible seam when repeated in a 2x2 grid. Distribute edge transitions naturally; avoid creating a central focal point or obvious mirrored symmetry.
Constraints: square, texture fills edge to edge, top-down orthographic, no perspective, no objects, no characters, no text, no watermark, no border, no fog or ash, no directional light, no cast shadows, no vignette.
Avoid: photorealism, noisy microtexture, excessive cracks, high-contrast grout, central medallion, obvious repetition markers.
```

The output is not mathematically seamless: normalized opposite-edge RMSE is
`0.0516663` horizontally and `0.0798994` vertically. The review therefore uses
Three.js `MirroredRepeatWrapping` on both axes. This avoids a visible hard seam for
look development but does not convert the source into a production-ready tile.

## Auto-Rig Pro diagnostic benchmark

The masculine prepared mannequin also has an isolated Auto-Rig Pro 3.78.47 / Smart
AI 1.21 benchmark. Smart marker inference and reference-rig generation run in a live
Blender viewport because ARP's operators require viewport/OpenGL context; matching,
binding, pose generation, evidence, renders and export then run headlessly. Outputs
live under `output/base-models/masculine/rigged-auto-rig-pro` and never replace the
canonical custom-rig artifacts.

The benchmark is diagnostic, not production acceptance. ARP binds all seven semantic
meshes with negligible bind displacement and provides clavicle, arm, forearm and
twist chains, but this run has no deforming scapula bones. The diagnostic build now
normalizes and caps deform weights to four influences, disables Blender Preserve
Volume so validation matches glTF linear-blend skinning, and authors all animation on
the scene's measured 30 fps clock. Chest-local arm frames correct the prior backwards
cross-body recipe and preserve the accepted stride and independent head turn. Strict
shoulder and elbow deformation gates still fail on the current source topology.
These findings keep the result at
`diagnostic_not_production_ready` and make it a benchmark for later ARP configuration
or mesh-topology work, not a replacement skeleton. The diagnostic GLB intentionally
contains all 211 ARP joints, including its `c_` controls, reference bones and
mechanism graph. Runtime skeleton reduction has not been performed and is an
explicit blocking follow-up, not evidence of a runtime-clean export.

The GLB also carries two review-only in-place locomotion prototypes:
`Ashveil_Walk_InPlace` is frames 0–30 at 30 fps and
`Ashveil_Sprint_InPlace` is frames 0–18 at 30 fps. Both use keyed ARP leg IK/FK
switches, keep the trajectory control fixed, and repeat the first pose at the final
frame. Their report metrics cover clip timing and control-loop closure; skinned sole
planting and slide, ground clearance, knee plane, cyclic velocity, bilateral mirror
error and visual motion quality remain unmeasured production gates rather than
production claims.
