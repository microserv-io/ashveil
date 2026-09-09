# Ashveil adapter

Use this reference only in an Ashveil checkout. Discover the active branch's contract first: the generic wardrobe and Mage tier were unmerged feature work when this skill was authored, so their files and commands may be absent from `main` or may have changed.

## Discover the active seam

Read repository instructions plus `docs/pipeline.md`, the approved body manifest, `package.json`, and any current gear source/wardrobe/manifest updater and tests. Search for symbols and paths rather than assuming they exist:

- `public/bodies/<body-id>/<body-id>.manifest.json` and its GLB
- `public/gear/<set-id>/`, `scripts/art/gear/`, and the editable `.blend`
- `GearSetSource`, `GearWardrobe`, visual slot and dye declarations, motion review support, and gear tests
- manifest schema, trusted catalog, required slots/roots, material-role naming, body digest, rig profiles, payload rules, and budget constants

The historical Mage feature used `src/world/gear-source.ts`, `src/world/gear.ts`, and `scripts/art/gear/update_starter_gear_manifest.mjs`. Use those only if present in the active checkout. Do not make an unmerged Mage path a prerequisite for unrelated armor work.

## Commands and authoring boundary

Read `package.json` before running any command. On the historical Mage branch, the exact metadata commands were:

```sh
npm run art:gear-manifest:mage
npm run art:gear-manifest:mage -- --check
```

They target `arcane-mage-tier`; do not run them blindly for a new set. A `--set=<set-id>` flag does not imply arbitrary set support: verify that the requested id is registered and accepted by the current updater before invoking it. Otherwise, adding a new set may require authorized catalog, updater, and runtime changes with tests before a valid command exists.

`npm run art:fit` is a geometry-fitting pipeline. It is not a read-only audit or manifest check and is outside the default manual-UI authoring method.

After each manual export, generate its manifest and run the check form. The authoritative updater should own container parsing, self-contained payload validation, hierarchy/root mapping, rig/weights/inverse-bind validation, materials, budgets, and file/body hashes. Add focused read-only diagnostics only for a visible or validator-reported gap.

## Mage-derived runtime cautions

The historical generic contract expected ordered bones, exact trusted rest/inverse-bind identity, no secondary influence set, at most four nonzero influences with normalized weights, no morph targets, declared non-overlapping roots, embedded buffers/images, and measured material/draw/triangle budgets. Discover the current values; the Mage bone count, asset metrics, and eight-slot layout are examples rather than defaults for another set.

For a scoped asset edit, decode and compare unchanged roots, accessors, materials, image payloads, skin, and inverse binds when preservation is part of the claim. Do not require exact vertex-order mirroring or zero seam slivers unless the current contract or observed failure calls for it.

Material clones must own their lifetime. A runtime correction that applies to one garment geometry must be scoped to the exact body and garment, keep CPU diagnostics plus GPU color and shadow behavior consistent, and add no per-frame allocation. Do not use a shared per-draw uniform shortcut that can leak across meshes.

Assess authored weights before proposing runtime garment correction. Do not silently add a cloth solver for new gear. The Mage robe's body-specific radial field has no inertia, cloth dynamics, self-collision, or cape collision and is not a generic collision-free solution. Nearest-capsule projection per vertex can tear layered cloth and switch owners across joints; do not reuse that approach as a default.

## Live validation and delivery

When the active branch provides `?gearReview=1`, use it as a separate review URL. It disables normal movement, so the primary handoff must be the playable URL without that flag. In normal play, equip the delivered set, close panels, and test movement and jumping.

For Mage-style motion review, cover the supported idle, walk, run, sprint, jump start, jump air, and jump land clips from front, back, left, and right as risk warrants. Paused samples such as normalized `.246` and `.768` are useful regression points, not universal required values. Inspect physical slot removal, bare body, chest-off robe removal, waist-off coverage, boots, mixed slots, dyeable primary/trim, and fixed ivory/crystal materials when those features exist.

Run focused asset/source/wardrobe checks for asset-only changes. Run the full runtime gate when code changes or a focused check exposes a broader failure. During cold-reload motion QA, freeze repository writes because hot reload can reset the scene and invalidate the sample.

Launch a durable preview process using the repository's approved service method and binding rules, not a child tied to the tool session. Verify fresh HTTP responses for the page, essential assets, expected digests, and UI. A prior local `launchctl` fix is evidence for one machine, not a universal requirement or permission to install a service. Do not claim reboot persistence unless it was configured and tested.

Report the normal playable URL first and the review URL separately, plus exact checks, source/export/reference paths, body and clip coverage, limitations, and whether runtime integration changed. Follow repository PR policy; do not merge automatically.
