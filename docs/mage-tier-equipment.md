# Arcane mage tier equipment

## Runtime contract

`arcane-mage-tier` is an optional visual set for the approved
`masculine-clean-v1` body. It has exactly eight player-facing slots: head,
shoulders, chest, hands, waist, legs, boots, and back. A slot may contain any
positive number of declared parts. This lets the shoulder slot own two rigid
shoulders and lets the chest own both a fitted torso and the hanging robe skirt.
The skirt is not wrapped into the legs slot.

The trusted runtime catalog contains only `starter-leather` and
`arcane-mage-tier`. Starter leather keeps its existing v1 manifest and GLB; a
loader adapter presents its four slots to the generic wardrobe. The mage export
uses `ashveil.gear-set.v2` and declares its set id, exact body id and body GLB
SHA-256, GLB byte length and SHA-256, raw joint names, inverse-bind SHA-256,
slots and parts, global material roles, and exact whole-set budget totals.
Part bounds are measured in canonical body-rest space. Fetched GLB bytes are
length- and SHA-checked before parsing. Buffers and images must live inside the
GLB binary chunk; external and data-URI dependencies are rejected.

Each part is either `skinned` or `rigid`. Skinned parts retain strict identity
bind space and use the approved body's existing 68-joint skeleton. A rigid part
must be parented directly to its declared raw joint in the export. The loader
maps that raw name through the manifest joint index to the corresponding body
bone, verifies the source and approved rest spaces, and retains the authored
part subtree transform when it attaches the clone. Sanitized joint and part-name
collisions are rejected.

The updater accepts two complete, exact rig profiles: the approved body export
and the shipped Starter leather roundtrip. Before deriving either profile it
checks the source GLB against its manifest byte length and SHA-256. The updater
also pins the shipped Starter byte length, GLB SHA, and inverse-bind SHA, then
requires its v1 schema, approved body SHA, and joint order. A Mage
export must then match one profile's complete 68-joint order, inverse-bind SHA,
and all 68 computed world-rest matrices exactly. It cannot combine an
inverse-bind hash from one profile with rest transforms from the other, and the
updater has no general floating-point tolerance or unlisted hash allowlist.

The Starter profile exists for the known Blender import/export roundtrip. Its
largest inverse-bind component difference from the approved body is
`9.357929e-6`. Reference-pose measurements found at most `0.992 µm` of authored
source versus runtime-body vertex displacement and `2.238 µm` from isolated
inverse-bind substitution. Rigid-part displacement was at most `0.311 µm`
(`0.274 µm` head, `0.311 µm` left shoulder, `0.293 µm` right shoulder). The
runtime's existing `1e-5` compatibility check and canonical-body rebind cover
that measured roundtrip. These measurements do not relax the updater gate and
do not replace motion review.

Every render node must belong to exactly one declared, non-overlapping part
root. There is no per-slot part or primitive limit. Whole-set ceilings are
120,000 triangles, 256 draw calls, 64 source materials, and 128 material clones
per character. The manifest records the exact measured value for each ceiling.
Materials named with the `Dye Primary` or `Dye Trim` prefix receive that role;
all other materials are fixed. The wardrobe clones each source material once
per set and slot, shares that clone across the slot's parts, and changes only the
base color of dye-role clones. Fixed material properties, including an authored
emissive crystal, remain unchanged.

The expected mage roots are:

| Slot | Root | Deformation |
| --- | --- | --- |
| Head | `ArcaneMageHead` | rigid on `head.x` |
| Shoulders | `ArcaneMageShoulderL`, `ArcaneMageShoulderR` | rigid on `shoulder.l`, `shoulder.r` |
| Chest | `ArcaneMageChest`, `ArcaneMageRobeSkirt` | skinned |
| Hands | `ArcaneMageHands` | skinned |
| Waist | `ArcaneMageWaist` | skinned |
| Legs | `ArcaneMageLegs` | skinned |
| Boots | `ArcaneMageBoots` | skinned |
| Back | `ArcaneMageBack` | skinned |

The updater reads the manual export and writes metadata only:

```sh
npm run art:gear-manifest:mage
npm run art:gear-manifest:mage -- --check
```

It never creates or changes geometry. The Blender source and GLB must be made by
hand through Blender's UI.

## Development motion review

Append `?gearReview=1` to the development world URL to open the gear motion
review panel. The panel is available only when `import.meta.env.DEV` is true and
is loaded dynamically, so production builds keep the normal world behavior. It
uses the same approved character, animation mixer, wardrobe, and renderer as the
game.

The clip selector contains the seven approved manifest names: `idle`,
`walk_forward`, `run_forward`, `sprint_forward`, `jump_start`, `jump_air`, and
`jump_land`. The chosen clip loops while the explorer remains in place. Changing
clips resets playback to zero. Play/Pause and the normalized time slider support
exact paused-pose inspection, including the end pose at `1`. Front, Back, Left,
and Right set the orbit yaw relative to the character's facing. Scroll zoom uses
a 3.2-meter full-body preset distance and a review-only minimum of 2.3 meters;
the normal minimum remains 4.8 meters. Mage is selected by default when its
optional asset loaded. The Gear panel remains available for mixed-slot and dye
checks.

## Selection and failure behavior

The wardrobe stores one selected set id or `null` for each visual slot and
stores primary and trim dyes by set and slot. Individual selection preserves all
other slots and remembers dyes when switching sets. **Arcane mage** selects the
mage set in all eight slots. **Starter leather** selects its four slots and
clears head, shoulders, hands, and back. **Return to refuge** resets movement and
camera state while retaining the loadout and dyes.

The starter set is required. Mage loading, validation, or construction is
optional and transactional: the runtime stages the whole set off-selection,
removes staged roots and disposes its material clones on failure, records the
diagnostic, and continues with playable starter gear. The HUD only offers sets
that completed construction.

## Acceptance and limitations

The final manual asset must pass the updater check, runtime source and wardrobe
tests, typecheck, and build. It also needs visual review against the authoritative
front/back concept and supporting side reference in idle, walk, run, sprint,
jump start, jump air, and jump land. The crescent shoulder blades, inner arc,
outer hooked wing, three hanging plates, and fixed emissive crystal must remain
readable in that review.

The tenth in-progress export established a numeric regression baseline at
normalized times `0.246` and `0.768`. With all Mage slots equipped, aggregate
robe/leg segment-triangle hits changed from normal skinning to the garment field
by `4783 -> 3801` and `4679 -> 3777` in run, and `4842 -> 4004` and
`4374 -> 3512` in sprint. Robe/boot hits changed by `2297 -> 1483` and
`1704 -> 594` in run, and `2071 -> 852` and `1293 -> 700` in sprint. These
counts include authored touching edges and are useful as directional regression
evidence; they are not a collision-free certificate. Each later manual export
must repeat the same poses visually. Back views must also check that outward
robe motion does not create an obvious new crossing with the separate mantle.

The tenth pairwise diagnostic recorded normal skinning -> garment field counts
as follows. `I`, `C`, `Iv`, and `V` mean Indigo, Champagne trim, Ivory, and
Violet; `Back` is the aggregate robe/mantle count.

| Clip/time | I-C | I-Iv | I-V | C-Iv | C-V | Iv-V | Back |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| run `.246` | 4180 -> 4391 | 236 -> 111 | 148 -> 312 | 2387 -> 2337 | 7910 -> 8524 | 3071 -> 2912 | 0 -> 128 |
| run `.768` | 4180 -> 4276 | 475 -> 145 | 277 -> 341 | 2405 -> 2397 | 8151 -> 8532 | 3097 -> 3174 | 8 -> 128 |
| sprint `.246` | 4260 -> 4422 | 539 -> 276 | 330 -> 484 | 2384 -> 2349 | 7942 -> 8504 | 3120 -> 3197 | 0 -> 112 |
| sprint `.768` | 4228 -> 4482 | 424 -> 161 | 348 -> 367 | 2359 -> 2349 | 8252 -> 8855 | 3144 -> 3263 | 132 -> 204 |

Several raw counts increase, including the mantle count. The eleventh export
was assessed visually at these poses, but its numeric pairwise diagnostic was
not rerun; no zero-intersection result is claimed for it.

The eleventh export passed live idle, walk, run, sprint, jump start, jump air,
and jump land samples without the prior Ivory/Violet striped crossings or a
large new robe/mantle crossing. None, Starter, and Mage boots with Mage legs,
Chest/waist None selections, slot mixing, dyes, fixed Ivory/crystal channels,
and paused poses also worked in that review.
A pronounced outward sprint flare and a small angular Ivory side patch remain
visible limitations. The current GLB is `8,327,984`
bytes with SHA-256 `cdd4ad0cacb34baa9592704a855477f35e9cd8e344dd9c7aec7b4efecb657cab`;
its manifest records `94,318` triangles, `7` source materials, `39` draw calls,
and `31` per-character material instances.

The hanging skirt uses authored skin weights on the existing rig. The renderer
consumes the four influences in `JOINTS_0` and `WEIGHTS_0`; exports with
secondary influence sets are rejected instead of silently dropping weights.
Morph targets are also rejected because wardrobe instances do not copy morph
state.

The trusted `masculine-clean-v1` Mage profile applies a conservative render-only
garment field to `ArcaneMageRobeSkirt` after normal skinning. Six tapered
capsules follow the approved left and right `thigh_stretch`, `leg_stretch`,
`foot`, and `toes_01` joints. Their radii take the conservative maximum of the
body and the currently selected None, Starter, or Mage legs and boots.

For each robe vertex, the shader evaluates one smooth radial envelope around the
body root at its authored angle and height. It compares that envelope in the
current pose with the rest envelope and applies only the outward change. Nearby
Ivory, Violet, Indigo and trim layers therefore receive the same additive field
instead of being projected onto one capsule surface. The field has no per-frame
JavaScript work or allocation. It fades out toward the waist so the upper manual
weights remain in control, and the rest pose is exact. The same displacement
runs in colour and shadow shaders and therefore also updates an exact pose
selected with the paused development scrubber. It does not change the GLB
geometry or weights. A constant attribute on disposable runtime geometry clones
limits the field to the robe draw even when another chest part shares the same
per-slot material clone; disposal restores the untouched source geometry.

This correction has no inertia, cloth dynamics, self-collision, or cape
collision. It is an outward garment-level response, not a universal proof that
every triangle clears every limb. In particular, authored robe vertices that
start inside a conservative body envelope receive no static rest expansion;
positive separation does not exist for the field to preserve there. The
approved skeleton still has no dedicated cloth bones. The measured pose checks
cover only this Mage robe on the approved masculine body and do not claim
automatic fitting for another garment, body, race, or animation.

The runtime now loads the complete manually authored eight-slot Mage export,
supports per-slot mixing and dyes, and applies the approved-body robe correction.
Its manifest must be regenerated after every Blender export. Artistic fidelity
to the concept and animation fit remain visual review concerns rather than
pixel-perfect guarantees. The implementation adds no stats, save migration,
glamour overrides, body-coverage inference, morph fitting, other bodies, or
other races; only `masculine-clean-v1` has been fitted and validated.
