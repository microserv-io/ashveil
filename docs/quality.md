# Development and quality rules

How work gets done here and what "done" means. `CLAUDE.md` has the invariants;
this is the practice around them.

## Red, green, refactor

Write the failing test first. Not as ceremony: on a project like this it is the
cheapest way to be sure the test is testing anything.

1. **RED.** Write the test and watch it fail. **Check it fails for the right
   reason.** A test that fails on a typo, a missing import or an assertion that
   would never hold proves nothing, and a surprising number of green tests were
   never red.
2. **GREEN.** Smallest change that passes. Resist fixing the neighbouring thing
   you noticed; note it or file an issue.
3. **REFACTOR.** Now clean up, with the test holding the behaviour still.

### Bug fixes start with a reproduction, always

This is the rule that matters most here, because determinism makes it cheap.
Every run reproduces exactly from its seed, so a bug report with a seed is a test
waiting to be written.

```bash
npm run sim -- trace --seed 7 --every 2   # find the tick where it goes wrong
```

Then pin it before fixing:

```ts
// tests/pathfind.test.ts — written when the bot could stall against a wall
describe('walking across an area cannot stall', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed} reaches the portal`, () => { /* ... */ })
  }
})
```

That test failed first. Fixing the smoothing made it pass, and it now guards a
class of bug rather than one instance of it. Three of this project's real bugs
were found this way; the traps list in `src/sim/CLAUDE.md` is the return on it.

A fix without a failing-test-first is only a fix for the case you happened to try.

## What must have a test

- **Any change to `src/sim/`.** No exceptions: it is the game, and it is the part
  that runs headless where tests are cheap.
- **Every bug fix**, as above, written before the fix.
- **Every invariant.** If you enforce a rule in review, you have not enforced it.
  Move it into `tests/architecture.test.ts` where it is checked mechanically.
- **New player capabilities**, which is automatic if they go through `Intent`,
  since the harness bot can then reach them.

Presentation is the exception: `src/render/` and `src/ui/` are verified by running
the game, not by asserting on DOM. Anything worth pinning there is usually pure
logic that belongs in a module a test can import directly.

## The test tiers, and what each is for

| tier | example | asserts |
| --- | --- | --- |
| **Architecture guards** | `tests/architecture.test.ts`, `tests/monolith_budget.test.ts` | Mechanical invariants: no `Math.random` in the sim, dependencies point inward, no file over budget |
| **Pinned math** | `tests/damage.test.ts` | Exact numbers, by hand. The damage pipeline is the one place a wrong number is invisible and catastrophic |
| **Behaviour** | `tests/loop.test.ts`, `tests/multiplayer.test.ts` | That the loop closes and the seams hold, never exact values |
| **Determinism** | `tests/determinism.test.ts` | Same seed, same run, byte for byte |
| **Frame budget** | `tests/frame_budget.test.ts`, `npm run perf` | That a frame still fits in 16.67ms. The test pins the sim half headless; `npm run perf` measures the whole frame in real Chrome |

**Behaviour tests assert shape, not magnitude.** `monstersKilled > 30`, not
`=== 47`. Tuning must not turn the suite red, or the suite becomes the thing people
work around. `tests/damage.test.ts` is the deliberate exception: it pins the
pipeline arithmetic exactly, because "increased" landing where "more" should
silently changes every build in the game.

## Balance changes are measured, not tested

A test cannot tell you whether the game feels good. The harness can tell you what
changed.

```bash
npm run sim -- sweep --seeds 6 --minutes 4   # before
# change something
npm run sim -- sweep --seeds 6 --minutes 4   # after
```

Put both in the PR. Watch kills per minute, deaths, depth, and the damage split
across skills. Two traps:

- **Any change to draw order shifts the RNG stream**, so per-seed numbers move even
  when behaviour is identical. Compare the envelope across seeds, never one seed.
- **A change that moves no number is inert or untested.** Find out which.

## Module-first

**Every piece of new logic lands as its own small, tested module behind an existing
seam. Never append it to a coordinator.**

The deciding question is one: **does this code need the coordinator's private
mutable state** — the live tick loop, the scene graph, the HUD's DOM? If no, it is
a sibling module, every time. If only partly, extract the pure part into a module a
test imports directly and leave the coordinator a thin consumer.

`src/sim/vec2.ts`, `src/sim/targeting.ts` and `src/sim/character.ts` are the
pattern: pure, imported directly by tests, no `Sim` in sight.

`tests/monolith_budget.test.ts` enforces this with a line ceiling per coordinator.
When you extract, **lower the ceiling**. Raising one is a decision to justify in the
commit message.

Data-as-code is exempt. Skills, monsters, affixes, passives and zone rules are
correctly large tables. Module-first is about logic, never data.

## The gate

`npm run gate` before calling anything done. It runs typecheck, the full suite, and
a production build.

```bash
npm run gate            # typecheck + tests + build
npm run gate:balance    # the above, plus a sweep, for anything touching game feel
```

While iterating, run one file: `npx vitest run tests/loop.test.ts`.

## Definition of done

- [ ] `npm run gate` green
- [ ] New behaviour has tests; bug fixes have a test that failed first
- [ ] Balance-affecting changes have before/after sweep numbers in the PR
- [ ] Invariant changes moved their guard test in the same commit
- [ ] Docs that went stale are updated: `src/sim/CLAUDE.md` for sim rules,
      `docs/architecture.md` for structure, `CLAUDE.md` for working rules
- [ ] The diff is scoped to the task; unrelated refactors are separate

## Code review, what to actually look for

In rough order of how much damage each does if missed:

1. **Does it break an invariant** that no test guards yet? If so the review finding
   is "add the guard", not "fix this instance".
2. **Does it reach across a layer?** Sim logic in the renderer, or a host mutating
   sim state directly, is the failure that compounds.
3. **Would this desync?** Anything that rolls dice outside the authoritative tick,
   or that puts a `Map`, `Set` or class instance into replicated state.
4. **Does it assume one player?** `sim.player` is the local player, a convenience.
   Systems iterate.
5. **Was the test ever red?** If a test cannot fail, it is documentation.
6. **Did a coordinator grow** when a module would have done?
