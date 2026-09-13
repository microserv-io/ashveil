# Opening chapter concept art

These scene studies support the public first-chapter story page and terrain planning.
They explore atmosphere, composition and possible location language; they do not
decide level layout, mechanics, quest staging or final environment production. The
four public-gallery PNG sources live under `website/assets/source/chapter/`. The site
build produces their public JPEG and WebP derivatives.

| Scene | Public caption | Source | Prompt provenance |
|---|---|---|---|
| Alderbank Refuge | Alderbank Refuge · a proposed haven for the chapter’s survivors | `website/assets/source/chapter/alderbank-refuge.png` | [`prompts.json`](prompts.json), asset `alderbank` |
| Orchard and wagon road | Orchard and wagon road · a proposed route through the chapter’s lived-in countryside | `website/assets/source/chapter/orchard-and-wagon-road.png` | [`prompts.json`](prompts.json), asset `orchard` |
| Broken waystation | Broken waystation · a proposed threshold where the road begins to fail | `website/assets/source/chapter/broken-waystation.png` | [`prompts.json`](prompts.json), asset `waystation` |
| Ward engine | Ward engine · a proposed visual direction for the first dungeon’s central mechanism | `website/assets/source/chapter/ward-engine.png` | [`prompts.json`](prompts.json), asset `engine` |
| First-zone terrain overview | Atmospheric river-valley composition for the proposed terrain slice | [`terrain-overview.png`](terrain-overview.png) | [`terrain-prompts.json`](terrain-prompts.json) |
| Starting-zone map v2 (current planning) | Terrain-shape revision with substantial interior ridges, escarpments and sheltered route pockets | [`starting-zone-map-v2.png`](starting-zone-map-v2.png) | [`starting-zone-map-v2.prompt.json`](starting-zone-map-v2.prompt.json) |
| Starting-zone map v1 (historical) | Original north-up regional study for chapter geography, route bundles and return staging | [`starting-zone-map-v1.png`](starting-zone-map-v1.png) | [`starting-zone-map-v1.prompt.json`](starting-zone-map-v1.prompt.json) |

The terrain overview supports the [first-zone terrain build slice](../../../first-zone-terrain.md).
It is not an exact spatial map or evidence of implemented content. Its composition
places the waystation unusually close to the refuge; playable distance and scale must
follow the story's travel contract and later terrain review instead.

The current starting-zone map is a north-up regional staging study, not an exact-scale map,
collision layout or runtime integration plan. It maps the refuge/S01–S05 hub, the
M04–M05 wagon and fields outing with S06–S10, the optional Westmere Farm chain
S11–S13, the orchard chain S14–S16 (not the grove), the M06–M07 Lower Road approach
with S17–S18, and the M08 entrance area with S19–S20. North is `+world z` and east is
`-world x`, a provisional presentation choice to honour the story's east-verge staging.
Its two crossing depictions are provisional story-beat interpretations. The numbered
regions are not one continuous outing: the story also returns to the refuge after
M04–M05 before M06–M07, and the shared road supports that intermediate visit.

## Generation record

The source PNGs were generated with OpenAI's built-in `image_gen` tool on 6 September
2026. [`prompts.json`](prompts.json) preserves the exact prompts and reference roles.
The outdoor studies used `public/textures/first-zone/concepts/village-edge.png` from
PR #48 at commit `5368d069cb0c5d690e580055d6a94945935a8498` for style and material guidance;
the dungeon studies used `public/textures/first-zone/concepts/ash-boundary.png` from
the same revision. Those reference images remain provenance and are not introduced
into this branch by the gallery.

The terrain overview was generated with the same tool on 7 September 2026.
[`terrain-prompts.json`](terrain-prompts.json) preserves its prompt, correction and
reference role.

The starting-zone map was generated with the same tool on 13 September 2026.
[`starting-zone-map-v1.prompt.json`](starting-zone-map-v1.prompt.json) preserves the
exact prompt, corrections, source documents, visual research, measured dimensions and
source SHA-256.

The v2 terrain-shape revision was generated with the same tool on 13 September 2026.
[`starting-zone-map-v2.prompt.json`](starting-zone-map-v2.prompt.json) preserves its
exact edit prompt, v1 source path and hash, generated hash and dimensions, and the
adopted layout decisions. V2 is the current planning reference and awaits translation
into authored terrain; the active editor overlay and runtime geometry still use v1.
