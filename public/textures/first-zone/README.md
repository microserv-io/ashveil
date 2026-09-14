# First-zone texture candidates

The original four images are retained as the first-zone material study and as the
opt-in runtime comparison baseline. They are not the default terrain art.
Edge checks found visible discontinuities in ordinary repeat mode. The review page
therefore starts with mirrored repeat, which conceals the joins but introduces a
recognisable symmetry. Production use still requires a seam-retouched source.

Each PNG is an sRGB albedo map for a rough, non-metal surface. No normal,
roughness, height, displacement or ambient-occlusion map has been inferred from
the colour image. If those maps become useful, author and validate them as separate
source assets instead of treating generated colour detail as physical surface data.

`manifest.json` records a suggested real-world width for one texture repeat. The
values are review starting points, not canon:

| Candidate | Suggested width per repeat |
| --- | ---: |
| Meadow grass | 2 m |
| Worn earth | 2.5 m |
| Ivory limestone | 3 m |
| Ash ground | 2 m |

For review, load the PNG as an sRGB colour texture, use mirrored repeat wrapping on
both axes, and set the repeat from the rendered surface size divided by the manifest's
`physicalRepeatMetres`. Start with the listed roughness and zero metalness. Keep
the original 1254 × 1254 files unchanged; WebGL 2 supports repeating non-power-of-two
textures. Use the page's ordinary repeat mode to inspect the raw joins; do not ship
that mode until the edges have been retouched and rechecked.

Run `npm run texture:dev` and open `http://100.103.10.11:5297/` to compare the
maps on a material study, switch between one and three repeats, inspect seams, and
download the original candidates. `npm run texture:build` writes the standalone
review bundle to `spike/zone-textures/dist/`.

Source reference: `website/assets/source/ember-and-bloom-world.png`. Generation
prompts and provenance are recorded in `PROMPTS.md` beside these files.

The `concepts/` directory contains two scene studies that put the candidate palette
in context. They are concept illustrations, not engine screenshots or evidence that
their depicted environment has been implemented. Their exact prompts and references
are recorded in `concepts/PROMPTS.md`.

## Painterly terrain v1

The default terrain uses `meadow-grass-painterly-v1.png`,
`worn-earth-painterly-v1.png` and `ivory-limestone-painterly-v1.png`. Their exact
prompts, dimensions, hashes and built-in ImageGen provenance are recorded in
`painterly-v1.json`; all three were copied without pixel edits on 14 September 2026.
The grass was approved in the Safe Landing trial. Earth and limestone are edits of
their respective original albedos. The shader combines decorrelated world-space
samples, broad variation and distance quieting so large surfaces do not expose one
obvious repeat.

Open the default route with `?hillsideReview=1` to hold the scene at noon and compare
the original Baseline with Painterly on the same terrain, character, sky, camera and
clock. Painterly is the ordinary route and covers the whole authored zone; the review
route alone loads the four original maps.

Ash is a regional effect, not another albedo. The existing continuous ash influence
drains colour and softens contrast after grass, earth and limestone are composed. The
same pure world-space influence supplies the paint map and is available for later
character or creature effects. Sparse world-anchored motes use that influence in a
bounded patch around the camera without changing the global fog or sky. This terrain
pass does not change character materials.
