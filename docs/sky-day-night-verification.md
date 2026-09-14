# Sky and day-night verification

Chrome inspected the actual first-zone route on 14 September 2026. The active v2
panorama loaded without captured runtime errors. Dawn, noon, dusk and midnight showed
continuous lighting changes; midnight retained readable terrain, paths, the approved
dark character and NPCs under cool fill and moonlight. The v2 horizontal wrap remained
visually continuous while panning, including the formerly smeared edge direction, and
the zenith remained clean during maximum upward look. The larger soft-edged sun, moon
and sparse stars rendered at their expected phases.

Cloud layering was checked from the reset camera after dragging from `(800, 620)` to
`(429, 278)`, producing a diagnostic yaw of about 2.305. At 09:00 the sun was nearly
hidden with a cloud-shaped lower crescent; at 09:24 it partly emerged across an irregular
cloud edge; at 10:00 the whole soft sun was clear. At 21:24 the same painted cloud shape
obscured the moon's centre, while at 22:00 the moon was fully clear. Both discs remained
behind world geometry. No console errors occurred in the accepted run after 08:40 UTC;
earlier transient shader compilation errors at 08:37 belonged to the incomplete hot
reload before the missing sampler declaration was corrected.

Development diagnostics verified the following behavior:

- Changing the cycle from 600 to 120 seconds preserved the current phase. A 23.9-hour
  setting advanced through midnight to about 2.9839 after 15.435 seconds at that cycle
  length. Pause held the phase.
- Focusing the cycle field and pressing J, F or W neither moved the explorer nor opened
  the journal. The panel clears held movement without taking ownership of the quest
  modal's input-enabled state.
- Synthetic persisted `pagehide` stopped frames; the matching `pageshow` resumed one
  canvas and advanced the unpaused clock by elapsed monotonic time. This checks the event
  path but is not evidence from an actual browser back-forward-cache navigation.
- Overview showed the zone top-down. Returning to the landing restored the normal camera
  while preserving time at 12:00, paused, with a 600-second cycle. Maximum upward drag
  preserved the horizontal movement heading.
- Diagnostic `move(0, 1)` moved Safe Landing from approximately
  `(460.917, 4.184, 414.382)` to `(447.340, 6.495, 383.889)`; `stop()` stopped it and the
  captured error list remained empty. This is diagnostic movement evidence, not a fresh
  keyboard, touch or full-route traversal.
- At a 390 by 844 touch viewport, the time panel, mobile journal and joystick had clear
  spacing, the bottom controls remained usable, and the open journal trapped W input.

With the sky request blocked in DevTools, boot reached the retry screen. Restoring the
request and selecting Try again recovered one canvas, one Time of day panel and the
default running 08:00/600-second clock. A production preview loaded the sky asset with
no captured errors and exposed neither the development panel nor
`globalThis.ashveilWorld`.

At the normal Safe Landing camera, a warmed 240-frame sample recorded 40 draw calls,
1,510,514 submitted triangles, a 2.1 ms median and a 2.8 ms p95 for local CPU frame
work, with an empty captured error list. The updated-main baseline at the same camera
recorded 36 draw calls, 1,468,757 triangles, a 2.9 ms median and a 4.0 ms p95. These are
machine-local CPU measurements that exclude GPU completion and do not establish FPS.
Normal run-to-run timing variation means they are not evidence of a performance
improvement; the useful comparison is the added four draw calls and submitted sky
geometry.
