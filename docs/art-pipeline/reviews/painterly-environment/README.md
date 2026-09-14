# Painterly environment runtime review

Chrome reviewed the Alderbank runtime at `http://100.103.10.11:5331/` on
14 September 2026. The opt-in `?hillsideReview=1` route held the committed zone and
camera at noon while Baseline and Painterly switched on the same terrain mesh.

## Captures

- [`default-route.jpg`](default-route.jpg) records Painterly on the ordinary route,
  without the comparison panel.
- [`ground-baseline.jpg`](ground-baseline.jpg) records the legacy ground variant.
- [`ground-noon.jpg`](ground-noon.jpg) records the painterly grass, warm earth and
  soft ivory limestone at the matching ground view.
- [`overview-painterly.jpg`](overview-painterly.jpg) records whole-zone material,
  route and regional-ash readability.
- [`river-noon.jpg`](river-noon.jpg), [`river-dusk.jpg`](river-dusk.jpg) and
  [`river-night.jpg`](river-night.jpg) record the water at hours 12, 19 and 0.
- [`state.json`](state.json) records the review route's painterly spawn view at paused
  noon: the candidate was ready and the captured runtime error array was empty.

The inspected water showed a soft blue-to-turquoise shallow bed, deeper blue water,
broken white highlight strokes without a crosshatch pattern, and a surface that met
the visible bed at the shore. Baseline/Painterly switching worked in the review route.
Chrome's resource inspection on the ordinary route found only the painterly grass,
earth and limestone textures, with no legacy terrain maps loaded. Its diagnostics had
an empty error array and no review state.

## Evidence boundaries

The captures prove the listed views only; they do not show every shoreline segment.
Automated tests supply the exact geometry and collision proof for the shared connected
below-water-level footprint, including connected expansion and disconnected dry basins.

The overview shows regional ash treatment. No close-up runtime capture was made for the
ash particles or haze, so their live appearance is not claimed here; unit tests cover
their deterministic world anchoring, bounded count, dry-ground placement and shared ash
influence. This pass does not apply ash treatment to actors.

The final review run passed typecheck and 1,086 tests across 79 files, with one existing
skipped test. The production build passed with 530 ms bundling and its existing large
chunk warning. The `frameMs` value in `state.json` is JavaScript frame-work timing, not
full GPU completion or an FPS measurement.

The older [`painterly-hillside`](../painterly-hillside/) captures remain historical
evidence for the grass-only trial and do not prove this full environment rollout.
