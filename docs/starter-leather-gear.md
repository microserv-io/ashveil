# Starter leather gear

## Delivery specification

Create a modest new-character outfit for the approved masculine first-zone character:
a brown leather jerkin, separate waist belt, dark leather trousers, and plain ankle boots. The front/back
GPT image concept in `art-pipeline/concepts/gear/starter-leather/` guides construction.
These are four individually equippable visual pieces: `chest`, `waist`, `legs`, and `boots`.

The approved `masculine-clean-v1` body and its seven authored animations remain the
source of truth. Preserve the existing body GLB, manifest, and canonical Blender file.
Build the editable clothing by hand through Blender's UI and retain the local editable
scene; geometry-generation scripts are outside this delivery. Review the actual character
wearing the pieces through Computer Use.

Ship a separate gear GLB with four named skinned meshes and no animations. Clothing
must follow the approved 68-joint skeleton, with validated names, skin weights,
inverse binds, and mesh coordinate spaces. Each character instance owns its clothing
visibility and cloned materials. Shared template geometry must survive instance disposal.
The manifest is authoritative for each slot's mesh name; runtime code must not repeat the
exported Blender object names as a second mapping.

The starter appearance exposes primary leather and trim dye channels. A dye sets the
selected paint colour on the semantic material; Default restores its authored colour.

The first-zone game starts with all four pieces equipped. A compact accessible Gear
panel offers an explicit equip/unequip control per piece and shows current state.
Mouse, touch, and keyboard activation must work without triggering character movement.
All sixteen combinations, including the bare undersuit, must remain supported. Returning
to the refuge preserves equipment choices within the current play session.

This pass does not introduce item stats, loot, persistence, other character bodies,
or changes to the legacy game. Loading failures must remain recoverable through the
existing retry flow and must not present unloaded clothing as successfully equipped.
The separate meshes in this checkpoint are an exact-body prototype, not the reusable
equipment architecture described below.

## Acceptance checks

- The concept, source attribution, and generation prompt are saved in the worktree.
- The editable clothing scene and runtime export match the modest concept silhouette.
- The body files retain their original hashes.
- Chest, waist, legs, and boots can each be removed and restored in the running first zone.
- Primary leather and trim dyes affect only their intended areas.
- Clothing follows idle, walk, run, sprint, jump start, air, and landing without visible
  body penetration, detached sections, or gaps between adjacent clothing pieces.
- Asset validation rejects missing slots, malformed weights, and incompatible rigs.
- Independent review checks the full diff, asset evidence, and relevant tests.
- Typecheck, tests, build, and a live browser review complete before delivery.

## Status

The exact-body checkpoint is complete for `masculine-clean-v1`. The handmade source is
[`scripts/art/gear/starter-leather-handmade.blend`](../scripts/art/gear/starter-leather-handmade.blend),
and its runtime export is
[`public/gear/starter-leather/starter-leather.glb`](../public/gear/starter-leather/starter-leather.glb):
770,492 bytes, 14,257 triangles, four slots, three materials and 68 joints. The approved
body GLB and canonical Blender source remain byte-identical to their versions at `HEAD`.

Live review verified independent equip controls, primary and trim dyes, authored-colour
reset, preservation through Return to refuge, and sampled idle, walk, run, sprint, jump-air
and landing states. Selected runtime evidence is the
[`front`](art-pipeline/concepts/gear/starter-leather/review/handmade-live-front.jpg),
[`dyes and reset`](art-pipeline/concepts/gear/starter-leather/review/handmade-final-dyes-reset.jpg),
[`run`](art-pipeline/concepts/gear/starter-leather/review/handmade-final-run-diagonal.jpg),
and [`sprint`](art-pipeline/concepts/gear/starter-leather/review/handmade-final-sprint-diagonal.jpg)
screenshots. The focused starter-gear run passed 21 tests; typecheck and build passed. The
quiet full suite passed 61 files and 972 tests, with one skipped test out of 973, in 49.87s.

This proves the approved masculine fit only. Reusable multi-body fit, glamour overrides,
outfit presets, robes and cloth behavior remain future work under the contract below.

## Reusable equipment direction

The production target is one equipment appearance that can be worn by a female human,
female and male gnomes, and muscular orcs without remodeling that garment for every
body. Use a hybrid presentation model:

- Close-fitting chest and trouser appearances are material layers on a standardized
  body surface. The target body's own mesh supplies height, width, bust, hip, limb and
  muscle volume, so the appearance follows girth as well as the skeleton.
- Hands, feet and waist use body-owned replaceable surface shapes selected by stable
  geoset identifiers. Each body is prepared for those identifiers once; an item selects
  an identifier and materials rather than containing a new body-specific mesh.
- Helmets, shoulder pieces and cloaks remain separate silhouette geometry attached to
  stable sockets or the compatible skeleton. A silhouette that cannot clear the whole
  supported body family may declare exceptional fit variants; that is an explicit art
  cost, not the default equipment path.

Inventory slot, visual coverage and deformation method are independent properties. A
chest-slot robe may cover the torso, pelvis and legs, hide lower-priority trouser and body
regions, and add one hanging skirt mesh. It remains owned by the chest slot. The skirt is
skinned as hanging cloth from the pelvis/body chain rather than stuck to each leg as
close-fitting trousers. A future versioned cloth-bone rig extension may add secondary
motion when every compatible body supplies it; cloth simulation is outside this pass.

Bone length or bone scale alone does not satisfy this contract. It can place joints for
different proportions, but it cannot describe the surface volume needed for a narrow
human torso, a short gnome, or a muscular orc. Surface layers and body-owned geosets
inherit that volume from the authored body.

### Minimum asset contract before a second body

Every wearable body package must declare:

- a versioned `wearableFamily` and `surfaceLayout` shared by compatible appearances;
- stable surface region names used by chest, legs, hands, feet and waist layers;
- stable hideable body-region names where a separate surface shape needs to cover skin;
- its body-owned, skinned geosets for the supported hand, foot and waist silhouettes;
- stable head, left-shoulder, right-shoulder and back sockets; and
- its own skeleton/rest-pose compatibility data and reviewed animation envelope.

Every equipment appearance must be independent of a body id. Its minimum presentation
record is:

```ts
interface EquipmentAppearance {
  readonly id: string
  readonly wearableFamily: string
  readonly surfaceLayers: readonly {
    readonly ownerSlot: 'chest' | 'legs'
    readonly region: string
    readonly baseColor: string
    readonly dyeMasks?: { readonly primary: string; readonly trim?: string }
  }[]
  readonly coverage: readonly {
    readonly ownerSlot: string
    readonly regions: readonly string[]
    readonly hideLowerPriority: boolean
  }[]
  readonly geosets?: Readonly<Record<'hands' | 'feet' | 'waist', string>>
  readonly attachments?: readonly {
    readonly slot: 'head' | 'leftShoulder' | 'rightShoulder' | 'back'
    readonly model: string
  }[]
  readonly hangingParts?: readonly {
    readonly ownerSlot: 'chest' | 'legs'
    readonly model: string
    readonly deformation: 'skinned-hanging'
    readonly requiredRigExtension?: string
  }[]
  readonly dyeChannels?: readonly ['primary', 'trim']
}
```

The primary starter-leather dye changes the leather. The trim dye changes trim. A future
material may add masks and detail maps that remain modulated by the selected paint colour
without changing appearance identity or the body-fit contract.

Equipment rules and presentation state remain separate. The character state needs an
equipped item id for gameplay and an optional appearance override per slot. Resolving a
slot uses the override when present and otherwise uses the equipped item's appearance;
clearing an override therefore restores the equipped appearance without changing stats.
Dyes belong to the resolved appearance. Outfit presets can later store override and dye
choices without changing equipped items. Coverage precedence then decides which body,
trouser or robe regions render; it must not infer coverage from the owning inventory slot.

### Current evidence and migration limit

The shipped starter manifest names `masculine-clean-v1`, pins that body's SHA-256, and
contains one exact 68-joint inverse-bind signature. The runtime rejects any different
body SHA, joint order, inverse binds or bind space before rebinding the four meshes.
The approved body and starter gear contain no morph targets. The repository has runtime
GLBs only for `masculine-clean-v1` and the separate 24-joint `masculine-v3`; the feminine
mannequin is concept art only, and there are no gnome or orc body models. No current asset
therefore demonstrates reusable multi-body fit.

For the handmade starter set, the smallest migration is to retain the current Blender
geometry as its visual reference, author chest and trouser colour plus two-channel dye
masks against the eventual standardized surface layout, and select a body-owned low-boot
geoset for the feet. The runtime loader can then replace the exact-body four-mesh manifest
with surface layers, geoset selections and optional attachments. The body material needs
an instance-owned composed texture or equivalent layer material, while the appearance
resolver owns override fallback and dye colours. None of those seams should be claimed
as working until a standardized body surface exists.

The current approved body is one immutable skinned mesh with no stable hideable region
groups. This checkpoint therefore continues to clear the visible undersuit rather than
editing or selectively hiding it. Covered-body hiding becomes available only when a body
package supplies the region boundary named by an appearance.

The existing asset can currently prove exact-body loading, animation following,
independent slot visibility and per-instance material ownership. Synthetic tests could
prove the future manifest parser, appearance fallback and dye-channel resolution now,
but they cannot prove fit. Multi-body acceptance requires loading the same appearance id
and the same source texture layers on every target body, then reviewing idle, walk, run,
sprint and the full jump sequence for clipping, gaps, detached attachments and unintended
skin exposure. The dye proof must exercise two visibly different colour pairs while
leaving geometry and equipment state unchanged, and clearing an appearance override must
restore the equipped look without changing the equipped item. A robe proof must equip the
robe as a chest item, hide its declared trouser/body coverage, and show its skirt hanging
between and around the legs throughout locomotion instead of inheriting each leg's shape.
