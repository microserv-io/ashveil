# Ashveil public website

## Objective

Publish Ashveil's chosen Ember & Bloom identity and complete current GDD on a
public, readable website. Rocco selected identity study 03 on 5 September 2026.
Ashveil's new product direction is an MMORPG; the detailed redesign is a later task.

## Brand source correction

The selected third-panel wordmark and emblem must use the original pixels from
`website/assets/source/identity-studies.png`. Public SVG files are viewport
containers with the original PNG bytes embedded; they deliberately retain the
painted parchment background and are not vector paths. A genuine production vector,
single-colour variant and minimum-size system remain deferred. Alegreya is supporting
editorial typography and must not be presented as the wordmark's source face.

## Scope

- Separate static website under `website/`, with its own build output. Keep the
  game entry, build and runtime intact. Use Tailwind and reusable plain-HTML
  components, following the repository's explicit no-UI-framework convention.
- Landing page: the selected Ashveil wordmark and leaf-and-ember emblem artwork;
  forest, ivory, terracotta and gold palette; expansive painterly landscape with a
  small party; clear link to read the design document; honest early-development
  language. No invented release, signup, gameplay footage or promised systems.
- Brand page: accepted direction, font specimens, palette, original-artwork SVG
  container downloads,
  concept artwork and practical usage notes. Two self-hosted OFL font families:
  Alegreya for display and Source Sans 3 for navigation and prose. Generated art is
  labelled concept art. Record provenance and font licences.
- GDD page: build-time rendering from `docs/game-design-document.md`, not a second
  manually maintained copy. Preserve every existing section and item. Add a
  conspicuous transition note: MMORPG is the new direction; earlier ARPG loop,
  camera and competitor assumptions await review. Only update the GDD introduction
  to reflect this transition; do not settle gameplay or commercial design. Show
  compact legacy-baseline context beside product/camera/competition sections so
  deep links and printouts cannot mistake earlier decisions for new commitments.
- Incorporate open design proposals in a clearly separate status-labelled addendum:
  PR #32 painterly/toon rendering and PR #35 canonical-body gear production,
  authored body regions, spring-bone cloth and human visual acceptance. Summarise
  all their GDD additions, link the PRs and keep the status explicitly open as of
  the content review date. PR #24 is the merged baseline, superseding closed #17.
- GDD navigation: heading anchors, usable desktop contents and mobile navigation,
  selectable text, print stylesheet, source Markdown download. Relative links to
  technical docs must resolve publicly, using repository links where appropriate.
  Make the two existing technical references absolute public repository URLs in
  the source as well, so the identical standalone Markdown download stays useful.
- Fully rendered HTML without JavaScript for reading, navigation and downloads.
  No analytics, accounts, backend, tracking, external runtime font requests or game
  asset fetches. Use restrained progressive enhancement only if it adds value.
- GitHub Pages deployment at the repository path `/ashveil/`; also support a
  configurable base path for custom-domain or local hosting. Add a site-specific
  CI build and publish workflow for main plus manual dispatch. PR CI validates only;
  deployment must depend on successful build. Use minimal workflow permissions.
- Public scope is the site output only, not the game or repository root directory.
  Add a useful 404 page, titles/descriptions, social metadata, favicon, and responsive
  artwork. Serve local review on all interfaces and supply the Tailscale URL.

## Non-goals

Detailed MMORPG design, FF14/WoW feature research, game changes, purchases or custom
domain registration, newsletter, community accounts, ecommerce and a game launcher.

## Acceptance

1. Home, GDD, brand page and 404 render at the Pages base path and on direct visits.
2. All current GDD content blocks (including paragraphs, tables and list items)
   remain present; downloaded Markdown matches the source; repeated headings
   receive unique, stable anchors. Validate both `/ashveil/` and `/` build bases.
3. All internal links, images, fonts and downloads resolve; technical references
   point to real public documents. No game GLBs or model-fetch scripts in site build.
4. Mobile at 390px and desktop at 1440px have no horizontal overflow; keyboard
   focus, navigation, readable contrast and reduced-motion preferences work.
5. Brand reproduces study 03 exactly: its original wordmark and botanical ember
   pixels, painted parchment ground, warm earthy palette and shared-world imagery.
6. Relevant site checks (including a separate typecheck if using TypeScript) and
   repository `npm run gate` pass. An independent agent
   reviews the complete diff and runs relevant tests. Visually inspect in Chrome;
   if the Chrome extension is unavailable, report that exact limitation and use
   installed Chrome through browser automation for practical verification.
7. Conventional commit and PR; green CI before merge; publish and verify the real
   public URL, then clean up the temporary worktree and local preview.
