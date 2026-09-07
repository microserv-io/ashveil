# Character and tree variation

## Objective

Use the existing masculine-v3 character as the controllable explorer and make the
Blender tree placements less repetitive in the private first-zone prototype.

## Tree contract

- Retain the two Blender-authored tree meshes, their textures, all 33 tree anchors,
  and the existing four scenery instance batches. Buildings remain unchanged.
- Derive variation from each solid's stable ID, independent of iteration order:
  full yaw rotation, height approximately 0.82–1.18 of the template, independently
  varied width approximately 0.82–1.08 with equal X/Z scales, and restrained warm/cool
  instance tint. Keep positive scales and natural proportions.
- Fit horizontal scaling to each existing collision disk using actual transformed
  geometry through 1.0 metre above the ground datum. Lower height scaling must not
  bring wider geometry into that ground zone outside the disk. Keep the roots grounded.
- Keep camera obstruction based on trunk proxies, not foliage. Preserve source
  geometry/material/texture ownership and deterministic teardown/rebuild behavior.

## Character contract

- Load the actual committed masculine-v3 body with its skin, materials and canonical
  1.8-metre scale. Replace the temporary cone explorer rather than adding an NPC copy.
- Position, facing and collisions remain driven by the existing world movement module.
  The model faces +Z at zero yaw, stands on the terrain and follows walk/run/reset.
- Idle and locomotion presentation must not import the deprecated scene, session,
  combat loop or camera. Reuse verified independent animation assets or animation math
  where suitable. Use the existing isolated procedural skeleton driver and masculine
  profile, supplied with world-owned presentation state; no runtime imports of the
  legacy rig-input builder or sim/session are permitted. Drive gait from actual travelled
  distance and the same clamped movement delta, so an obstructed explorer becomes idle.
  Motion time accumulates that clamped delta rather than wall-clock time. Reset clears
  driver and position history before posing at spawn. Use actual speed: the current
  5.2/8 metres-per-second movement produces running and faster running on this rig;
  do not fake a slower walk animation while preserving fast world translation.
- Await both scenery and character readiness before creating the world, HUD, input
  handlers or animation loop. Fail visibly and retry if either asset cannot load.
- Preserve the existing camera orbit/zoom, touch controls, terrain, routes, speed and collision radius.
  No character creator, equipment system, combat, new rig or public-demo publishing.

## Keyboard steering

The user's control mapping is W/S forward/backward, A/D turn and Q/E strafe. Arrow
keys alias W/S and A/D; Shift retains sprint. Turning works in place at 120 degrees
per second, using the same clamped delta as movement. For this +Z-forward, +X-left
body, A adds yaw and D subtracts it. Forward is `(sin(yaw), cos(yaw))`; right is
`(-cos(yaw), sin(yaw))`. Backward and strafing movement preserve the heading, even
when blocked. Diagonal movement remains normalized by the existing movement module.

Keyboard turning also advances camera yaw by the same amount, retaining its orbit
offset. Mouse orbit changes only the camera. Initial/reset heading points away from
the reset camera (`cameraYaw + pi`). Touch joystick and injected diagnostic movement
retain camera-relative steering and auto-facing; nonzero keyboard steering takes
precedence when input sources are mixed. Opposing keys cancel and blur clears input.
Update the visible control hint. Steering belongs in a small pure world module rather
than duplicating collision or terrain logic in the renderer.

## Acceptance

Tests verify repeatable per-ID variation, distinct tree silhouettes, transformed ground
footprints, unchanged building matrices, shared resources, the actual character's rig
and scale, locomotion transitions, stationary behavior at obstacles and loading retry.
They also verify keyboard turn direction, turn-in-place, heading preservation while
strafing/backing up, diagonal normalization, frame-delta clamping and input clearing.
Inspect a private visual comparison with the real body and varied grove, run the
relevant project checks and obtain independent review before delivery through a PR.
Record any unavailable browser verification explicitly.

## Browser verification — 7 September 2026

Native Chrome on the private candidate rendered the textured masculine-v3 explorer,
varied tree placements and overview. At a 400-pixel mobile viewport the character,
joystick, run control and navigation remained visible without overlap.

Held keyboard events through the live input handlers verified A/D turning in place
by approximately ±1.047 radians in 0.5 seconds, with matching camera yaw. Q/E strafed
approximately 2.6 metres in opposite directions without changing heading; W/S moved
forward/backward the same distance. Shift+W travelled 3.21 metres in 0.4 seconds.
Overview and blur cancellation prevented movement. Runtime error capture stayed empty.

A native touch-drag attempt was blocked by the computer-use tool's
`windowNotFoundAtPosition` error, so this pass does not claim a completed physical
touch-gesture check. Input lifecycle and cancellation are covered by automated tests.
Directional backward/strafe animation remains the existing forward procedural gait.
