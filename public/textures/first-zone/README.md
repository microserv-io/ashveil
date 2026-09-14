# First-zone texture candidates

These four images are a bounded material study for the first zone. They are
candidates for visual review, not finished zone art or a gameplay commitment.
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

## Safe Landing hillside review

`meadow-grass-painterly-v1.png` is an isolated review-only candidate for the real
Safe Landing hillside. Its exact generation prompt is retained in
`meadow-grass-painterly-v1.prompt.txt`, and `hillside-review.json` records its hash,
dimensions and review status. It was generated with the built-in ImageGen tool on
14 September 2026 and copied without pixel edits. The source has fresher greens and
calmer broad brushwork, but still contains recognisable leaf clusters. The review
shader therefore combines two decorrelated world-space samples, adds broad warm/cool
variation and quiets detail with camera distance.

Open the default route with `?hillsideReview=1` to hold the scene at noon and compare
Baseline with Painterly on the same terrain, character, sky, camera and clock. The
trial is feathered from a 60-metre core to a 100-metre outer radius around the authored
spawn and changes only living grass; road earth, ash, limestone and collision keep their
normal semantics. This does not replace the default terrain material. Meadow tufts are
deferred because the current runtime has no reusable grass-detail asset or placement
mechanism suitable for this bounded material test.
