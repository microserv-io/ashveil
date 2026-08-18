# CC0 art spike

**The kit is now in the game** (`src/render/models.ts` and friends). This spike stays
as the fast way to judge art in isolation, and as the record of how the call was made.

Renders the **real** `generateArea` output with a candidate CC0 asset kit, under the
game's own camera, lighting, fog and palette. Nothing in `src/` is touched; the spike
reads the sim the way the renderer does.

```bash
npm run art:dev          # fetches ~18MB of CC0 models, serves on :5275
```

It shares `public/models` with the game rather than keeping a second copy.

Keys: `1`-`8` switch animation state, `[` / `]` rescale characters.

## The kit

[KayKit](https://kaylousberg.itch.io/) by Kay Lousberg — **CC0 1.0 Universal**, verified
in each pack's `LICENSE.txt`, not just the storefront blurb. Attribution is not required;
we credit anyway.

| pack | used for |
|---|---|
| [Dungeon Remastered](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | floors, walls, stairs, chests, barrels, torches, coins |
| [Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | the player (Knight); 4 spare archetypes |
| [Skeletons](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | `swarm`, `ranged`, `brute`; a spare mage |

Mirrored on GitHub, so `fetch-assets.mjs` pins exact paths and needs no storefront
download form. Models are **not committed** — 22MB of binaries that git would carry
forever, from an upstream that is already a stable public archive.

## Why this kit

- **One rig across every pack.** Adventurers and Skeletons share an identical 41-bone
  skeleton and 76 clip names, so one animation mapping drives player and monsters alike.
- **The clips already match the sim.** Every `ActorState` and skill has a clip:
  see `clips.ts`. Nothing had to be invented or retargeted.
- **One 1024 gradient atlas per pack**, so the whole dungeon batches into few draws.
- **Weapons are separate models** meant to attach to a hand bone — which lines up with
  `character.equipment.weapon` driving what the player is seen holding.

## What the spike measured

Numbers from seed 7, depth 1, 1280x800, Apple M4:

| | first pass | after fixing scale and density |
|---|---|---|
| triangles | 1,782,170 | 194,240 |
| draw calls | 122 | 120 |
| fps | 79 | 86 |

The two mistakes behind that first column are the findings worth keeping:

- **The sim grid is a collision grid, not a visual one.** KayKit's floor tile is 4
  units; Ashveil's sim tile is 1. Laying one model per sim tile costs 16x the geometry
  for no visible gain. One floor model per 4x4 block is both cheaper and correctly
  proportioned.
- **Size characters by height, not by the collision circle.** Matching the sim's 0.88
  diameter against the model's 1.94 *arm span* renders them as specks. Arm span is not
  body width. At `0.85` a character stands ~1.85 sim units, which treats one sim unit
  as roughly a metre and agrees with the 4-unit tile.
- **Squeezing a 4-wide wall onto a 1-unit footprint reads as corrugated stripes**,
  because its carved detail repeats four times per span. Walls go on the same 4-unit
  visual grid as the floor (`WALL_MODE`; flip to `'squeezed'` to see it).

## Still open

- **Walls only approximate the sim's walkable boundary** on the 4-unit visual grid, so
  the geometry can lie about collision by up to two tiles. A real integration needs a
  wall-run pass rather than per-block stamping.
- **Every GLB embeds its own copy of the shared atlas** — 55 textures for 15 models.
  Deduplicating on load, or repacking, should cut that hard.
- **Characters carry all 76-95 clips** (~3.6-4.8MB each, ~22MB total). Ashveil needs 8.
  Stripping the rest is the single biggest download win, and the shared rig means one
  animation library could serve every character.
