# Approved first-zone character

The first-zone game uses the Blender-authored Tripo masculine character in
`public/bodies/masculine-clean-v1/`. Its manifest pins the reviewed GLB by byte count
and SHA-256 and records the seven authored clips. Its canonical Blender source is
`scripts/art/humans/tripo-male-cleanup.blend`; the public package is the immutable runtime
copy.

Normal movement uses `run_forward`, Shift uses the distinct `sprint_forward`, and Alt
offers the slower roleplay `walk_forward`. W/S movement, A/D turning, and Q/E strafing
remain world-control behavior. The approved checkpoint has only forward locomotion
clips, so reverse, strafe, and diagonal movement temporarily reuse the selected forward
gait without changing the character's facing. Directional clips remain future art work.

Jump displacement comes only from world physics. A grounded jump first plays the
authored anticipation while the physics state is `preparing`, then physics supplies the
upward impulse. The controller continues through `jump_start`, loops `jump_air` while
airborne, and crossfades through `jump_land` after physical contact. Internal pelvis
motion is retained; the GLB scene root has no animated world translation.

The rejected procedural male/female rebuild and its appearance experiment remain in the
art worktree as preserved evidence. They are not loaded by the first-zone game, and the
approved character does not claim face, hair, skin-tone, or body-base customization.

The first-zone character starts in the separate `starter-leather` visual set: chest,
legs, boots, and waist. Three-piece manifests remain loadable while the waist asset
migrates; each present slot contains one or two skinned primitives rebound at load time
to the approved character's 68-joint skeleton. The gear file contributes no bones or
animation to a character instance. Runtime validation refuses different joint order,
inverse binds, bind space, or malformed weights. Its manifest names the body SHA-256
pinned by the approved manifest; repository tests, rather than a runtime digest, pin the
file bytes.

The Gear panel can show or hide each present piece independently and applies a primary
dye plus an optional trim dye where the authored material provides that channel. A new
page load starts from the authored colours with every present piece equipped. Clearing a
dye restores its authored base colour, while Return to refuge preserves equipment and
dyes for the current page session.

Slot identity does not define coverage: a chest appearance may later contain hanging
robe or dress geometry over the legs, and a waist appearance stays independently
visible. These choices are visual appearance state rather than item ownership or stats.
The current GLB is fitted only to the approved masculine body; other body templates need
their own validated fit before they can reuse the same appearance and dye contract.
There is no inventory, glamour plate persistence, or body-region masking yet. Garments
must clear every authored clip without relying on hidden body geometry.
