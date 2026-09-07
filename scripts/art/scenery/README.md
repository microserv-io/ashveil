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
outside `dist/` so a Vite build cannot erase the source file.
The four named meshes share the export origin in the `.blend`; select one in the
Outliner and enter Local View to inspect or edit it independently.

The GLB contains four root mesh nodes: `refuge_hall`, `cottage`, `alder_tree`, and
`orchard_tree`. Every root has identity transforms, uses metres in the runtime
+Y-up/+Z-forward frame, carries one material driven by `COLOR_0`, and exports its
ground datum and collision footprint in node extras. The manifest records bounds,
triangle counts, budgets, and reference hashes.

The modeling reference is
`docs/art-pipeline/concepts/opening-chapter/environment-kit.png`; its exact prompt is
stored beside it. The committed masculine-v3 body establishes the 1.8-metre human
scale, while `public/textures/first-zone/concepts/village-edge.png` supplies the
ivory stone, aged timber, terracotta, teal, and foliage direction.
