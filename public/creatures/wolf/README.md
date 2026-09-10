# Alderbank wolf

`wolf.glb` is copied without transformation from the reviewed runtime export of
`scripts/art/creatures/wolf.blend`. The editable checkpoint combines the user-supplied Tripo mesh retained at
`docs/art-pipeline/sources/wolf-tripo.glb` with its recovered and oriented 23-bone
skin and three animations authored through Blender's visible UI. The visible-UI repair
placed the rest bones inside the mesh, removed exactly two detached rear-paw quads
(four triangles), and authored the walk as two alternating phases with 13 keyed limb
controls per phase. The attack root now lunges forward in the export frame. This
prototype uses the attack only as a noncombat ambient action aimed into empty space.

The reviewed GLB contains one 12,901-vertex, 10,536-triangle skinned mesh with 23
bones. The manifest pins its exact bytes, clip timing, and unchanged export frame.
Ashveil's asset licence applies; see `LICENSE-ASSETS` at the repository root.
