# Quest marker icons v1

These PNGs are the visual asset set for the Alderbank quest-marker states. The
current runtime still draws its markers procedurally in
`src/world/quest-npcs.ts`; these assets are committed for a later wiring pass.

| Asset | Quest category | State glyph | Generated source |
| --- | --- | --- | --- |
| `available-side.png` | Optional Side Quest | Teal circular frame with ivory exclamation mark | `exec-135d929b-86b2-4a1f-809f-6a0e750894d3.png` |
| `available-main.png` | Main Story | Amber-gold diamond frame with ivory exclamation mark | `exec-d0d99b5a-1691-4c7a-8f20-27ac68951d02.png` |
| `in-progress-side.png` | Optional Side Quest | Teal circular frame with ivory horizontal dash | `exec-f7fbf94f-1ee5-4543-b8f9-f9ae1a7910bf.png` |
| `in-progress-main.png` | Main Story | Amber-gold diamond frame with ivory horizontal dash | `exec-29b3b0d6-e477-46fd-b734-41fe637748d4.png` |

The category silhouette and the internal glyph together identify each state.
The live UI must also retain its textual category and state labels, as required
by `docs/quest-system.md`.

## Generation record

Generated with OpenAI's built-in `image_gen` tool on 12 September 2026. The
exact prompt strings are preserved in [`prompts.json`](prompts.json), in the
same order as the table above. Source files came from
`/Users/roccolangeweg/.codex/generated_images/01a09411-6f51-7e63-834d-800b7f47d42e/`.
Each committed PNG is a byte-for-byte copy of its listed generated source; no
image processing, resizing, recolouring, or alpha extraction was applied.

All four files are 1254 x 1254, 8-bit RGBA PNGs with genuine alpha and fully
transparent corners. Alpha pixel counts (transparent / partial / opaque) are:

| Asset | Alpha pixels |
| --- | ---: |
| `available-side.png` | 856450 / 712353 / 3713 |
| `available-main.png` | 1140513 / 429601 / 2402 |
| `in-progress-side.png` | 863277 / 706046 / 3193 |
| `in-progress-main.png` | 1119645 / 450811 / 2060 |
