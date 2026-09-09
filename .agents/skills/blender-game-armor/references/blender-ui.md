# Manual Blender UI failure shields

Read this reference before geometry-changing work through Computer Use or when recovering from a failed edit. These are context-sensitive checks, not a universal modeling recipe.

## Context and batching

- Refresh the UI state before acting. Confirm the correct window, file, mode, collection, active object, selection, and visible result after each state-changing batch.
- Batch only deterministic UI actions whose intermediate state is understood. Separate activation from commands that depend on it.
- Never reuse recorded screen coordinates. Locate controls from the current state.
- Save a named checkpoint before topology, destructive modifier application, object replacement, or risky weight work. After a failed bevel or similar operation, return to the known checkpoint instead of stacking blind undo commands.

## Selection and input traps

- A selection pattern can select objects without making the intended object active. Verify the active object before Delete, Edit Mode, modifier operations, joins, or parenting.
- An Outliner row click makes that object active. Extending a keyboard selection may also advance the active object. Recheck before the next destructive command.
- Scrolling with viewport focus normally preserves selection; clicking blank space may deselect. Confirm rather than infer.
- Search with F3, then visibly confirm the chosen result. Mouse hover can cause the first-looking item to be the wrong command.
- Use field text entry for decimal values when shortcuts could be interpreted as hotkeys. Some controls need a separate activation and value-entry action.
- Escape cancels the color picker. Commit outside the picker and verify the resulting RGB/material state.
- Edit Mode `Alt+H` reveals hidden mesh elements; Object Mode visibility is a different state. Inspect both when geometry appears missing.

## Optional symmetric replacement recipe

For a truly symmetric rigid shoulder or similar bone attachment whose existing target must remain, use this only after verifying both the symmetry axis and the symmetry plane's origin. X through world origin is an example; a translated character needs its actual symmetry center.

1. Record the target object's bone parent, local/world transforms, modifiers, materials, and export name.
2. Record the current transform-pivot mode and transform orientation, put the 3D cursor at the verified symmetry center, set the pivot to 3D Cursor, and confirm the orientation matches the symmetry axis (`Global` for the world-X example).
3. Select all geometry intended to replace the target—the entire piece for a whole-object replacement, not merely the last edited faces. Duplicate it in Edit Mode with `Shift+D`, cancel the automatic translation with `Escape`, mirror on the verified axis (`S X -1` for the world-X example), recalculate normals as a separate operation, and separate the duplicate to a new object. Return to Object Mode.
4. Make only the old attachment target active, enter Edit Mode, select and delete only its old mesh vertices, then return to Object Mode. Preserve the attachment object itself.
5. Select the mirrored source object and the now-empty target, make the target active, and join. Restore the previous pivot mode and transform orientation.
6. Inspect transforms, orientation, seams, parenting, rig behavior, and shading from both sides.

This is optional. A Mirror modifier or manual bilateral edits can be better. Never delete an attachment object blindly or treat negative scale as a default export state.

Skinned boots, gloves, sleeves, and other left/right pieces need verified left-to-right vertex-group and weight mapping as well as mirrored geometry. Never copy left-side weights onto the right side unchanged. Pose both sides and verify the expected opposite bones drive them.

## Topology and normals

`Recalculate Outside` does not guarantee correct smooth shading across sharp, concave, reflected, or folded surfaces. Inspect face orientation and loop normals, finite positions/normals, triangle areas, and visible shading. Depending on the failure, manually triangulate, dissolve degenerate geometry, reset custom vectors, or mark deliberate sharp edges. A prior asset's sharp-angle setting is evidence, not a universal value.

Do not add complex diagnostics for microscopic seams without visible or contract evidence. Prefer the repository validator, then a narrow read-only check for the observed failure.

## Export selection

Export only the rig and named gear roots required by the active contract. Exclude the character body, drafts, cameras, lights, and animations unless the contract explicitly requires them. Before overwriting, verify the canonical directory, filename, selection, format, transforms, animation, material, and embedding options in the visible export UI. Inspect the written artifact and verify transforms, hierarchy, skin normalization, and trusted inverse binds. Keep Blender backup files such as `.blend1` out of deliverables.
