---
name: blender-game-armor
description: Author and validate one fitted armor piece or a modular set for an existing game character through Blender's visible UI. Use for reference-led modeling, fitting, rigging, materials, export, and in-engine motion review; default to manual Computer Use rather than scripted geometry generation.
---

# Blender Game Armor

Produce armor that matches the requested visual target, fits every body actually declared in scope, and works through the game's current equipment contract. Optimize effort by finding fit and contract failures before detail work, reusing compatible authored components, and stopping work on parts whose relevant checks remain valid.

The current request defines method, scope, fidelity, and authorization. Historical preferences, examples, and checkpoints do not grant broader permissions or impose a full set, color tier, race list, or new budget.

## Non-negotiable authoring boundary

- Use Blender's visible UI through Computer Use for geometry-changing work. UI transforms, Edit Mode, modifiers, UVs, weights, materials, and manual reuse of existing parts are allowed.
- Do not generate or edit geometry through `bpy`, Blender's Python Console, pasted scripts, headless Blender, or shell-driven geometry tools unless the user explicitly changes the authoring method for this task.
- Automated read-only asset diagnostics, metadata/manifest generation, tests, and authorized runtime integration are allowed. A command that fits, rebuilds, or transforms geometry is authoring, even when its name sounds like validation.
- If Computer Use or the required visible Blender session is unavailable, report geometry authoring, export, and visual validation as blocked. Continue authorized non-geometry work such as reference reconciliation, fixture and contract discovery, provenance/slot/material planning, and an integration specification. Do not silently substitute Python.
- Give Blender UI control to one agent. Follow the active repository's delegation rules for separable code, read-only diagnostics, and independent review without creating competing UI owners.

## Start from observed truth

Before mutation, inspect:

1. Repository instructions, current branch/worktree, existing changes, and the current task's allowed write scope.
2. The approved body files, body digest, rig/rest pose/inverse-bind contract, available body fixtures, animations, equipment slots, materials/dye rules, export roots, and validator commands.
3. The current Blender app, open file, mode, active object, selection, hidden state, modifiers, transforms, and saved/exported state. Refresh UI state before the first action and after interactions that could change context.
4. Existing manually fitted parts, attachment profiles, UV/material templates, and prior validated checkpoints that are compatible with the current body and contract.

Treat feature branches and historical files as evidence, not the active contract. If a required seam or fixture is absent, report that limitation instead of inventing it. Do not fetch or rebase repeatedly during an unchanged authoring task.

Keep a compact checkpoint ledger with source and export paths, hashes, target body/profile, completed checks, current Blender state, and next action. Record reused, modified, and newly authored content separately.

## Define the target

Confirm only missing decisions that would materially change the result: class fantasy, requested slot or slots, body fixtures, fixed palette versus dyeable primary/trim channels, authoritative references, desired fidelity, and delivery scope. Ask early, then continue independent discovery while waiting.

If no approved reference already defines the target, use the available image-generation capability to create a concept on the current body before modeling. Keep front and back in the same pose, scale, and proportions; add a side view early for dimensional pieces and hanging garments. Reconcile contradictions explicitly and choose a primary view. Never claim pixel-perfect fidelity from one screenshot.

Read [concept-and-fit.md](references/concept-and-fit.md) before concept creation, slot planning, reuse decisions, or multi-body fitting.
When approved image views are used for manual construction, follow its **Blender reference-image tracing** section before modeling.

## Work in evidence-producing stages

1. **Blockout export:** establish slot ownership, attachment/deformation type, coverage, and silhouette. Review paired views on the body in engine before dense mesh, UV, or surface detail.
2. **Fit and motion export:** fit the declared body fixtures, author or transfer weights, and test representative poses. Check both sides and the back, not only the easiest front view.
3. **Detail export:** add topology, materials, UVs, and polish after the silhouette and motion risks are understood.
4. **Final export:** export only the contract-required rig and named gear roots. Generate a manifest only when the active contract uses one; otherwise run its authoritative export/import validation. Cold-reload the runtime, then freeze repository writes during motion QA so hot reload cannot invalidate the evidence.

At each stage, compare source, export, and runtime state. A saved `.blend`, successful export, valid contract metadata or import, and correct live appearance are separate claims. Stop iterating unaffected validated parts unless a dependency or new evidence invalidates them.

Read [blender-ui.md](references/blender-ui.md) for manual editing, mirroring, selection, recovery, normals, and export failure shields.

## Validate the declared scope

- Run the repository's authoritative export/import validator first, plus its manifest validator when the active contract uses one. Use focused, read-only diagnostics for an observed failure; do not invent a parallel manifest or validator around one asset's assumptions.
- Verify the exact body/rig digest, ordered bones, rest pose and inverse binds, accepted influence count and normalized weights, supported morph policy, declared roots, self-contained payload, materials, and measured budgets from the current contract.
- For a scoped edit, verify unchanged roots and decoded accessors remain exact where the contract promises preservation.
- In engine, inspect reference fidelity and shading from front, back, and side; every delivered slot individually removable; a bare-body state; relevant cross-slot coverage; physical rigid attachments; dye channels; and fixed materials.
- Test the actual supported idle, locomotion, and jump clips from both sides and back. Pause exact times when needed and record the clip/body combinations actually inspected. Intersection counts need visual interpretation; boundary touches are not a realistic zero target.
- Keep appearance selection separate from stat equipment when the project supports cosmetic reuse. Do not claim a complete glamour/transmog system unless its state, persistence, and UI were implemented and tested.
- Obtain independent visual and implementation review when the repository policy requires it or the change is broad enough to benefit from it.

For Ashveil paths, current commands, Mage-derived constraints, cloth/material cautions, runtime checks, and delivery URLs, read [ashveil-adapter.md](references/ashveil-adapter.md). Discover another project's corresponding seams rather than importing Ashveil assumptions.

## Finish with reviewable evidence

When runtime integration is requested, hand off the normal playable URL as the primary link. Equip the piece or set in normal play, close review panels, and test movement plus jumping; provide any pose/review URL separately.

Report source, export, and reference paths plus the manifest path when applicable; hashes/digests when the contract uses them; what was reused versus authored; checks actually run; body/clip combinations reviewed; visual limitations; and blockers or unvalidated fixtures. A draft checkpoint is not completion of the requested fidelity. An open-ended budget does not authorize endless unmeasured rework or lower the quality target.
