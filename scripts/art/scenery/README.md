# First-zone Blender scenery kit

The first-zone environment templates are generated in Blender from one checked-in
script. The committed kit was generated and checked for repeatable export with
Blender 5.2.1 LTS. From the repository root, run:

```bash
/opt/homebrew/bin/blender --background --python scripts/art/scenery/generate_first_zone.py
```

The command writes the runtime asset and its measured contract to
`public/world/first-zone/scenery-kit.glb` and
`public/world/first-zone/scenery-kit.manifest.json`. It also saves the editable
Blender source and four-panel review render under the ignored
`scripts/art/scenery/.output/first-zone/` directory. That local directory is kept
outside `dist/` so a Vite build cannot erase the source file. The local output also
contains close and gameplay-distance scale proofs with the real masculine-v3 body,
plus the three source PNGs packed into the GLB.

The saved `.blend` opens on a spaced review presentation with the actual 1.8-metre
body. Its `EXPORT_SOURCE__4_IDENTITY_ROOTS` collection retains the four export
meshes at the shared origin, while `REVIEW_PRESENTATION__NOT_EXPORTED` contains the
camera, lights, body and display copies.

The GLB contains four root mesh nodes: `refuge_hall`, `cottage`, `alder_tree`, and
`orchard_tree`. Every root has identity transforms, uses metres in the runtime
+Y-up/+Z-forward frame, carries one shared atlas material with `TEXCOORD_0` and a
mild `COLOR_0` tint, and exports its ground datum and collision footprint in node
extras. The embedded 2048-pixel PBR atlas set supplies sRGB base color, linear
tangent normals, and linear occlusion/roughness/metalness channels. The manifest
records the semantic UV rectangles, gutters, image dimensions, encoded hashes,
color spaces, channel meanings, geometry counts and reference hashes.

Triangle allowances are visual-planning guidance: 35,000 for the refuge hall,
25,000 for the cottage and 15,000 for each tree. Export only stops at the separate
one-million-triangle sanity cap intended to catch accidental runaway subdivision.
Tree footprint validation measures geometry through 1.0 metre above ground so the
authored crown can extend beyond the collision disk.

The modeling reference is
`docs/art-pipeline/concepts/opening-chapter/environment-kit.png`; its exact prompt is
stored beside it. The committed masculine-v3 body establishes the 1.8-metre human
scale, while `public/textures/first-zone/concepts/village-edge.png` supplies the
ivory stone, aged timber, terracotta, teal, and foliage direction.
