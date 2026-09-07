# Environment fidelity pass

## Objective

Bring the Blender scenery closer to the accepted environment concept and actual
masculine-v3 character. The initial kit is a blockout-quality baseline: flat surfaces,
rigid tile grids and angular branch junctions remain visible at gameplay distance.
Increasing triangle counts alone does not satisfy this pass.

## Scope and contracts

- Refine the existing cottage, refuge hall, alder and orchard tree in Blender. Start with
  a cottage/tree comparison beside the actual 1.8-metre character before refining the kit.
- Add sculpted, smoothly shaded forms where silhouettes need them: rounded irregular
  masonry, softened and varied roof tiles, shaped structural timber and connected curved
  tree forks. Add readable door/window construction and finer, denser branching foliage.
- Replace flat-only surface treatment with exportable UV texture detail for plaster,
  limestone, terracotta, timber, bark and leaves. Use a compact shared PBR atlas where
  practical; retain one material and one joined mesh per template and four instance batches.
- Embed PNG atlas images in the GLB. Record semantic atlas regions, channel bindings,
  colour spaces, dimensions and hashes in the manifest. Assign UVs before joining parts,
  with padded regions to prevent neighbouring surfaces bleeding at distance.
- Keep texture maps immutable and owned by the cached source. Instance material clones
  share those maps; removing an instance group must not invalidate future instances.
- Preserve root names, metre/Y-up/Z-front frame, ground datum, footprint metadata and all
  authored positions, yaws, collision disks, terrain, routes and input behavior. Foundation
  skirts must continue to cover the measured slope relief.
- Measure tree ground footprints through 1.0 metre above the datum in both the exporter
  and runtime validation.
- Keep an editable local Blender source outside the application build output, reproducible
  generator, committed runtime assets and measured manifest. Preserve the previous kit as
  a local comparison artifact. GDD and public gallery content are outside this visual pass.
- Use the real masculine body for comparative review, without replacing the temporary
  gameplay pawn or importing the deprecated scene/animation bootstrap.

## Acceptance

The revised cottage and tree must show a clear improvement beside the character under
the same light, both close up and at normal gameplay distance. The concept remains the
visual target, not a claim of pixel-identical rendering. Flat rectangular tiles, obvious
cone intersections and untextured slabs must no longer dominate the assets' appearance.

Record actual exported geometry/texture sizes and final private-browser frame timings.
Initial working geometry allowances are approximately 35,000 triangles per hall, 25,000
per cottage and 15,000 per tree; these are planning allowances, not reasons to reject a
visibly better result or mechanically subdivide an unchanged shape. Test asset loading,
UV/material export, footprint/instance contracts, texture ownership, retry and mobile
rendering. Review the full diff independently and run the relevant project gates.
Node asset tests must decode the actual embedded PNG pixels and check material bindings;
browser verification must also check successful texture upload and recovery after a
texture load failure. A missing texture must not silently become an accepted flat asset.

The playable build remains private. This pass does not authorize demo publication or
present enlarged crops of the concept image as new artwork.
