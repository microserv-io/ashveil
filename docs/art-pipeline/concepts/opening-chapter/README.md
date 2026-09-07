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

The terrain overview supports the [first-zone terrain build slice](../../../first-zone-terrain.md).
It is not an exact spatial map or evidence of implemented content. Its composition
places the waystation unusually close to the refuge; playable distance and scale must
follow the story's travel contract and later terrain review instead.

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
