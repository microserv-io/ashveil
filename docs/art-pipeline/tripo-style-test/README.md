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
