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

No generation request has been submitted yet because the authenticated API profile
has no credits. Tripo Studio credits are separate from Tripo API credits.

## Acceptance review

The three outputs will be compared for:

- recognisable shared palette and material language;
- silhouette fidelity to the approved references;
- clean separation of limbs, cape, tail and gate opening;
- usable topology, UVs, textures, scale and pivot;
- gameplay-camera readability;
- suitability for later humanoid or quadruped rigging; and
- generation cost, failure rate and manual cleanup required.
