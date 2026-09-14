# Quest marker icons v2

This revision replaces only the optional side-quest glyphs with simple, unframed
markers. The main-story assets remain the gold diamond markers in
[`../v1/available-main.png`](../v1/available-main.png) and
[`../v1/in-progress-main.png`](../v1/in-progress-main.png).

| Asset | Quest category | State glyph | Generated source |
| --- | --- | --- | --- |
| `available-side.png` | Optional Side Quest | Ivory exclamation glyph with a muted teal edge | `exec-5f940259-71b6-4f55-b2c5-1256b2510bd5.png` |
| `in-progress-side.png` | Optional Side Quest | Cool-grey dash glyph with a muted teal edge | `exec-0b9c51fb-7ac2-4021-88a0-6e1bd896092c.png` |

The symbols identify the side-quest state. The live UI must retain textual
category and state labels as required by `docs/quest-system.md`. The current
runtime still draws its markers procedurally in `src/world/quest-npcs.ts`; this
asset revision is not wired into it.

## Generation record

Generated with OpenAI's built-in `image_gen` tool on 13 September 2026. The
exact prompts, source research, and art direction are retained in
[`prompts.json`](prompts.json). Source files came from
`/Users/roccolangeweg/.codex/generated_images/01a09411-6f51-7e63-834d-800b7f47d42e/`.
Each committed PNG is a byte-for-byte copy of its listed generated source; no
image processing, resizing, recolouring, or alpha extraction was applied.

Both files are 1254 x 1254, 8-bit RGBA PNGs with genuine alpha and fully
transparent corners. Alpha pixel counts (transparent / partial / opaque) are:

| Asset | Alpha pixels |
| --- | ---: |
| `available-side.png` | 1378090 / 193244 / 1182 |
| `in-progress-side.png` | 1429543 / 141543 / 1430 |
