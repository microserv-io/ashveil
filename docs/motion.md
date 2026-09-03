# Authoring motion

Ashveil's gameplay animation is generated at runtime by `src/render/procedural/`:
a pure function of replicated sim state, sim time and per-body memory, written onto
any body whose profile resolves the semantic joints. There are no clips to download
and no retargeting. This is how to add or change a motion, and what must hold.

## Read first

- `src/render/procedural/joints.ts`: the frame contract and the handedness table.
  Every sign in this system is pinned by `tests/procedural_handedness.test.ts`;
  read the table before touching a rotation.
- `src/render/procedural/posekeys.ts`: the pose key format. A key states only what
  it changes: torso turns as angles about the body axes, hands as targets relative
  to their own shoulder in arm lengths, feet as targets relative to their own hip in
  leg lengths, elbow and knee poles as directions, the root offset in leg lengths;
  a row may state a `gather`, a time-driven roll of both hands through the wind-up
  for casts whose time varies.
- `src/render/procedural/clips.ts`: the pose tables, one row per skill. This is
  where a new spell or swing lives.
- `docs/pipeline.md`: how bodies are built and why the joints are semantic.

## Adding a skill motion

1. Add the sim skill first (`src/sim/skills.ts`); the motion follows its windup
   and recovery, never the other way round. `phase.windup` runs 0 to 1 during the
   anticipation, `phase.recovery` 0 to 1 after the hit lands. A strike belongs on
   the turn, the frame the damage lands, so neither half of a sweep straddles the
   rate change between the two timings.
2. Add a row to `POSE_SOURCES` in `clips.ts` with keys over the phase. Author hand
   paths as targets in world-relative units, not rotations: a hand that goes
   "forward 0.6 and up 0.2" cannot be flipped the way a joint angle can. Use poles
   to say where an elbow or knee leads. Keep `planted: true` unless the feet move.
2b. If the motion has no sim skill yet, state its reference wind-up and recovery in
   `MOTION_TIMINGS` instead of adding the sim skill in step 1.
3. Map the skill to its pose in `src/render/riginput.ts` (`rigStateOf`) if it is
   a new `RigState`; every state must resolve to a pose or the coverage test fails.
4. Run the gates: `npx vitest run tests/procedural_` covers continuity across the
   windup-to-recovery boundary at the skill's real timings, self-intersection of
   every arm segment against a torso capsule, feet above the floor, finite unit
   quaternions, allocation-free frame path, and the handedness table.
5. Watch it: `npm run motion:dev`, open http://100.103.10.11:5277 (or the port you
   chose) on any device, and pick the body and state; Loop repeats the state with an
   idle beat between casts, and Cycle plays it once. Rocco reviews every animation
   on that page and a GIF on the PR before it merges.

## Motion families that exist

Locomotion (`gait.ts`, `stances.ts`, `arms.ts`, `armpace.ts`): idle, walk, run,
dash, with foot roll, no-slide by construction, cadence derived from speed, arm
swing as one parameterisation from stroll to sprint. The shoulder girdle
(`girdle.ts`) follows the arm. The flinch (`flinch.ts`) is an additive layer from
the hit flash. Death (`clips.ts`, `dead`) is a fall onto the back that must settle
within `DEATH_SETTLE`. Skills: cleave, firebolt, frost nova, monster bite, bolt and
slam, all target-driven; firebolt and frost nova both play the two-hand `cast`,
which gathers a ball at the waist and fires it on the turn. Casting adds a looping
two-hand `channel`. Executes follow the cast with `execute_overhead` and
`execute_thrust`. Weapon motions cover `swing_one_hand`, `swing_two_hand` and
`bow_draw`. `stagger` is a full-body hit reaction stronger than the flinch layer.

## Motions before sim skills

A motion without a sim skill is a pose row plus an entry in `MOTION_TIMINGS`; the
gates walk it at those reference timings. A sim skill that adopts it later maps to
the clip name and plays the row at its own wind-up and recovery.

## Rules that do not bend

- The pose is never a source of truth: hits, footsteps and damage follow sim timers.
- `time` is `sim.time`; the per-body seed is `actor.id`; no wall-clock anywhere.
- No allocation in the frame path; module-level scratch, preallocated poses.
- Missing optional joints are skipped, never merged into a parent.
- A behaviour change to an existing motion updates its test's numbers in the same
  commit with the measurement that justifies them, or it is a regression.
