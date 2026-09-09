# Concept, slot ownership, and fit

Read this reference when defining a visual target, choosing deformation, reusing parts, or claiming fit across bodies.

## Reference package

- Render or generate the concept on the current approved body and a neutral pose suitable for comparison.
- Keep front and back views of the same design at the same camera scale, pose, and body proportions. Add the side view before building shoulders, helmets, boots, thick belts, capes, robe panels, or other depth-sensitive forms.
- Preserve one view as authoritative when generated views disagree. Reconcile the others into a short note about silhouette, overlap, depth, and hidden construction instead of blending contradictions accidentally.
- Review front/back together after each meaningful change. A single favorable view cannot establish fidelity or fit.
- Separate fixed colors and effects from dyeable primary and trim areas in the brief. Fixed ivory, metal, crystals, emissive parts, or similar authored accents stay fixed unless the task says otherwise.

Reuse approved reference views when they already answer the task; do not regenerate them by habit. For a new concept, use this compact prompt shape and fill only relevant fields: `Design [piece or set] on [approved body] for [class fantasy], matching [references]. Keep [fixed materials/colors] fixed and show [dyeable channels]. Show front and back in the same neutral pose, camera scale, and proportions; add a side view for [depth-sensitive forms]. Make slot boundaries and overlaps readable.`

## Slot and deformation plan

Choose ownership from the visual and animation behavior, not merely where a piece appears in bind pose.

- Thin chest, pants, sleeves, and gloves usually follow the body and favor skinning.
- Shoulder plates, helmets, and other rigid plates often favor bone attachment when the runtime contract supports it. Boots need real toe-box, sole, heel, and cuff volume; choose skinning or attachment from the required toe and ankle motion.
- The chest slot owns free-hanging robe or skirt panels when removing the chest must remove the garment. Build them as independent hanging meshes rather than making leg geometry own the layer.
- A waist-off state must still leave deliberate midsection coverage. Check it with the declared chest and legs combinations.
- Keep rigid and deforming regions separate when their motion needs differ. Do not delete or replace an attachment object before recording its parent, transform, and export identity.

For a thin body-following piece, an efficient manual starting point can be to duplicate the approved body's or a compatible fitted garment's local surface region in Edit Mode, separate it as a new mesh while preserving the source and useful weights, then shape, offset, or Solidify it through the UI. Test coverage and deformation before detailing. Do not edit or delete the approved body to hide clipping unless an existing coverage contract explicitly requires hidden body regions.

A body foot or existing fitted boot can provide scale and pose reference, but shape an authored toe box, sole, heel, and cuff volume. A body-hugging foot duplicate alone reads as a sock rather than a boot.

## Reuse without sameness

Reuse manually fitted components, attachment transforms, clean topology patches, UV layouts, weight-transfer setups, and material templates only when their body, rig, scale, and silhouette role are compatible. Record provenance. Recoloring, duplicating, or adding ornaments to an existing mesh does not make the whole piece newly modeled.

Edit one half and mirror when the design and rig are truly symmetric. Preserve asymmetry where it carries the concept. Do not use a universal negative-scale recipe or require exact vertex-order symmetry unless the active contract does.

## Fit claims

Weights, morphs, and a shared skeleton do not prove fit across races or body shapes. Reuse attachment and fit profiles where available, then test each body explicitly declared in scope, including stocky, feminine, or muscular fixtures when provided. If a fixture is missing, report that body as unvalidated; do not promise automatic fit.

Judge proportional risk. A tiny seam near a low-motion boundary may be acceptable while a larger hidden interpenetration can tear under motion. Seek the requested appearance and stable motion rather than mathematical zero at any cost.
