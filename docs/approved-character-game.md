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
