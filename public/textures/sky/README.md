# Alderbank painterly sky

The default first-zone route uses `ashveil-sky-day-v2.png`, a 1,774 by 887 RGB
equirectangular panorama generated with OpenAI's built-in image generation tool on
14 September 2026. Its gently colourful azure, turquoise, ivory and periwinkle palette,
softly sculpted cloud banks and organic painted edges follow the supplied Alderbank
environment image as a style reference. The image contains no baked sun, moon or stars.

The first output is retained as generation provenance. Chrome wrap review found that its
clouded left and right sectors produced a visible join when the renderer blended those
different edges. The v2 edit keeps the central painted cloud composition while making
both horizontal edge sectors matching clear sky and cleaning the lower atmospheric
hemisphere. Runtime code adds only a narrow wrap safety blend and handles pole and
lower-hemisphere transitions in the sky shader.

| File | Role | SHA-256 |
| --- | --- | --- |
| `ashveil-sky-day.png` | Original generated panorama | `f70e21f2e28701e3f9870dc4264ba7614901f0f342ec25a394837028daf58e9c` |
| `ashveil-sky-day-v2.png` | Active seam-corrected panorama | `7431b94fe90bf363ce1901bc95ee1522096608b21a18713fe57a2981f3976580` |

[`PROMPT.md`](PROMPT.md) preserves the original prompt and style-reference role.
[`PROMPT-v2.md`](PROMPT-v2.md) preserves the exact edit prompt. Both PNGs are copied
from their generated outputs without pixel edits.

These files are project-controlled asset data under the repository's `LICENSE-ASSETS`.
That license asserts only rights Microserv.io actually holds and does not guarantee that
output made with generative tools is copyright-protected.
