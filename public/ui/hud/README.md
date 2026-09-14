# First-zone HUD assets

The first-zone MMO interface reuses the original Ember & Bloom visual-study assets without pixel edits. The 1,774 × 887 `art/menu-atlas.png` is clipped at runtime with the SVG silhouettes and optical bounds in `src/world/menu-icons.ts`; the opaque forest background remains in the source image and is excluded by those clips. The seven used cells represent Character, Pack, Map, Journal, Finder, Social, and Settings. The eighth compass cell remains unused.

The atlas and clipping paths were copied from the read-only `workspaces/mmo-ui-mockup/ui-concept` reference. Its source notes record that the atlas was generated with OpenAI image generation on 5 September 2026, then edited to replace a rejected checkerboard background with uniform forest enamel. The original prompt and corrective prompt remain in that workspace's `public/art/MENU-ICON-NOTES.md`.

`fonts/alegreya-variable.ttf` and `fonts/source-sans-3-variable.ttf` are the exact mockup font files. Their adjacent OFL texts are retained verbatim.

| File | SHA-256 |
| --- | --- |
| `art/menu-atlas.png` | `997f0a0e537ea18c4448ebfb92ea96a10caf6246a039e7cffb413256f46c31d8` |
| `fonts/alegreya-variable.ttf` | `ba5564634b93a8f8ba57b48cd4f1ae7417d2b4656fbac779028679b00de3cf12` |
| `fonts/source-sans-3-variable.ttf` | `042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9` |
| `fonts/alegreya-OFL.txt` | `ad9c189d8fe80860a6508268d1427d2cd0fec35982f89e935f292077378c7221` |
| `fonts/source-sans-3-OFL.txt` | `7fac2f6c6bc47144e2c35e8f41147b3c8c895490d44b46266a5312fe93364d2e` |

The atlas is project asset data covered by `LICENSE-ASSETS`. The font files are covered by their bundled SIL Open Font License texts.
