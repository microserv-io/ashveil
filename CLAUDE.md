<!-- Ashveil, project-root CLAUDE.md. Keep this lean (about 200 lines) and strictly
     repo-wide. Area guidance lives in the subdirectory's own CLAUDE.md (src/sim/ has
     one) and loads on demand when you open files there, so do NOT duplicate it here.
     Anchor on stable paths, symbols and pinned tests, never on counts that rot: no
     "343 tests", no "14 passives". If you change an invariant, change the test that
     guards it in the same commit, then update this file. HTML comments are stripped
     before load and cost nothing. No emojis. -->

# Ashveil

An isometric action-RPG in the Diablo / Path of Exile lineage, built core loop first.

The loop is the product: **pull a pack, spend skills, things die, loot drops, your
numbers change, go deeper and harder.** Everything else hangs off that, and none of
it matters if the ten-second kill-and-loot rhythm does not feel good.

Stack: TypeScript (ESM, `strict`) with Three.js for rendering, Vite, Vitest, and a
headless CLI harness. No UI framework; the HUD is plain DOM with Tailwind utilities.
Small dependency set on purpose.

## Repo map

| Path | What it is |
|---|---|
| `src/sim/` | **The game. Deterministic, host-agnostic, the source of truth.** Has its own `CLAUDE.md`: read it before changing anything here. |
| `src/session/` | Characters, persistence, the authoritative session. Owns what outlives an area. |
| `src/net/` | Transport interface and wire protocol. Loopback today. No gameplay. |
| `src/render/` | Three.js scene, meshes, effects, screen overlay, and the input layer (actions, device profiles, gamepad). Reads sim state, never mutates it. |
| `src/ui/` | HUD, gear panel, passive tree. |
| `headless/run.ts` | The CLI harness: `playtest`, `sweep`, `dps`, `trace`. |
| `spike/deck/` | Shell diagnostics for the Steam Deck decision. Shell-agnostic on purpose. |
| `tests/` | Vitest, including the architecture guards that enforce the invariants below. |
| `docs/architecture.md` | Why the architecture is shaped this way: netcode model, layering, zones, economy. Read before structural work. |
| `docs/quality.md` | How work gets done: red/green, what must have a test, module-first, the gate, what to look for in review. |

## Commands

- `npm run dev` plays it at http://localhost:5273. `?seed=7` reproduces an exact run.
- `npm test` runs Vitest. Prefer one file while iterating: `npx vitest run tests/loop.test.ts`.
- `npm run typecheck` and `npm run build` are the other two gates.
- `npm run sim -- playtest --seed 7 --minutes 6` plays it headless and reports.
- `npm run sim -- sweep --seeds 8 --minutes 4 [--policy twinstick]` measures across seeds.
- `npm run sim -- dps` gives per-skill DPS through real skill timings.
- `npm run sim -- trace --seed 7 --every 2` prints a second-by-second readout.
- `npm run gate` is typecheck, tests and build. `npm run gate:balance` adds a sweep.
- `npm run spike:dev` serves the Deck shell diagnostics on :5274.

In dev the browser exposes `globalThis.ashveil` as `{ sim, host, view, controls }`,
which is the fastest way to poke at a live game from the console.

## Default task workflow

1. Read `src/sim/CLAUDE.md` if the change touches the sim at all.
2. Make the change. Keep sim logic out of `render/` and `ui/`.
3. **Write the failing test first**, and check it fails for the right reason. Bug
   fixes always start with a reproduction: runs are deterministic, so a seed is a
   test waiting to be written. See `docs/quality.md`.
4. `npm run gate` (typecheck, tests, build) before calling it done.
5. **If the change could move game feel or balance, run a sweep before and after**
   and put the numbers in the PR. `npm run gate:balance` does both. See below.
6. Update the docs that went stale: `src/sim/CLAUDE.md` for sim rules,
   `docs/architecture.md` for structure, `README.md` for the outside view.

## Invariants, YOU MUST keep these

Each is enforced by `tests/architecture.test.ts`, which scans every file rather than
trusting review. If you need to break one, change the guard in the same commit and
say why in the message.

- **`src/sim/` is host-agnostic.** No DOM, no `three`, no wall-clock, no network, and
  no imports from `render/`, `ui/`, `net/` or `session/`. It must run unchanged in
  Node and the browser.
- **Determinism.** Fixed 60 Hz tick (`DT` in `src/sim/types.ts`). All randomness goes
  through `Rng` (`src/sim/rng.ts`). Never `Math.random`, `Date.now`, or
  `performance.now` in sim logic. Same seed, same run.
- **Dependencies point inward.** `sim` imports nothing above it, `session` and `net`
  may import `sim`, `render` and `ui` may read `sim` but never reach for `session`.
- **Prediction never rolls dice.** `tick('predicted')` locks the RNG and throws on any
  draw. Anything that decides an outcome (damage, loot, ailments, experience) belongs
  in the authoritative half of the tick and nowhere else.
- **Replicated state survives `JSON.stringify`.** No `Map`, `Set` or class instances
  in `Actor`, `Character`, projectiles, ground items or orbs. Snapshots are needed
  three times over: late join, prediction reconciliation, and save games.
- **The instance holds players, plural.** `sim.player` and `sim.progress` mean *the
  local player*, a host convenience. Systems iterate `playerActors()`. Anything
  written against "the player" breaks when the second one arrives.
- **New player capabilities go through `Intent`**, never a method a host calls
  directly. If the harness bot cannot reach it, it cannot be tested.
- **Items carry identity and provenance from birth.** Ids come from the instance's
  `mint`, never a module-global counter (that was a real bug: the counter leaked
  across instances in one process). Provenance is how duplication gets caught later.

## Balance and game feel: bring numbers

The harness exists so that tuning is measured rather than argued. A change to skill
timings, monster stats, drop rates or AI is not done until a sweep says what it did.

```bash
npm run sim -- sweep --seeds 6 --minutes 4          # before
# change something
npm run sim -- sweep --seeds 6 --minutes 4          # after
```

Watch kills per minute, deaths, depth reached, and the damage split across skills. A
change that moves no number is either inert or untested.

Two things to know before reading the output:

- **Any change to draw order shifts the RNG stream**, so per-seed numbers move even
  when behaviour is identical. Compare the envelope across seeds, not one seed.
- **`trace` is the debugging tool**, and its `moved` column has found three real bugs.
  A run where the bot is stuck shows `state=moving` with `moved` near zero.

Bot policies live in `src/sim/harness.ts`: `brawler` plays with a cursor, `twinstick`
with a stick, `punching-bag` never fights back so monster lethality can be measured,
`runner` skips combat so "can packs be outrun" can be answered. Add a policy to ask a
new question rather than bending an existing one.

## Conventions

- Comments explain **why**, never what. Prefer a clearer name or an extracted
  function over a comment. One or two lines, never a paragraph.
- Data-as-code: skills, monsters, affixes, passives and zone rules are tables in
  `src/sim/`, not logic. Add content by adding a row.
- Tests assert that the loop closes, not exact numbers, so tuning does not break them.
  The exception is `tests/damage.test.ts`, which pins the damage pipeline by hand.
- Presentation is a projection. Dropping a frame of effects must never change the
  outcome of a run.
- **Module-first.** New logic lands as its own tested module behind an existing seam,
  never appended to a coordinator. The deciding question: does it need the
  coordinator's private mutable state? If no, it is a sibling module every time.
  `tests/monolith_budget.test.ts` pins a line ceiling per coordinator; when you
  extract, **lower the ceiling**. Data tables are exempt, and correctly large.

## Working in parallel

Several sessions can work on this at once. To keep them from colliding:

- Use a worktree per task under `workspaces/<feature-name>` (already gitignored).
- `src/sim/sim.ts` is the busiest file and the easiest merge conflict. If two tasks
  both need it, prefer extracting a leaf module over both editing the coordinator.
- Balance work and mechanics work conflict silently: both move the sweep numbers.
  Say which you are doing in the PR, and re-run the sweep after merging, not only
  before.

## Deliberately not built

Do not add these as drive-by improvements; each is a decision that has been made and
deferred, and several would change the balance the loop is tuned around.

Flasks and potions, currency and crafting, more than one character archetype, skill
gems and supports, uniques, trade, a real endgame, sound, and art. Meshes are
coloured primitives on purpose: the question this build answers is whether the loop
is worth dressing up.

Netcode is also not built. The seams are in (`docs/architecture.md`), the wire is not.

## Open threads

Tracked as GitHub issues, not here: a list in this file rots, whereas closing an
issue is a side effect of doing the work. `gh issue list` is the current picture.

Standing rules that outlive any single issue:

- **Do not start shell or packaging work** until the Deck spike has run. Tauri looks
  like a poor fit for a Steam game and Electron may win; starting either way round
  before there are numbers risks throwing the work away.
- **Do not tune drop rates** until economy friction is decided. It sets drop rates,
  binding rules and item budget, so that work would be built on sand.
- Labels worth knowing: `decision` needs a call before work starts, `balance` means a
  sweep is required in the PR, `spike` is a time-boxed investigation.

## Maintaining this file

This file is loaded into every session, so it earns its length or it gets cut.

- **Keep it repo-wide.** Anything specific to one area belongs in that directory's
  own `CLAUDE.md`. `src/sim/` has one; add others when an area grows its own rules.
- **Anchor on stable things**: paths, exported symbols, test file names. Never counts,
  never "recently", never anything that rots on the next commit.
- **When you learn a trap, write it down** in the "Traps already hit" section of
  `src/sim/CLAUDE.md`, with the symptom first. Every entry there cost real debugging
  time; the list is the return on it.
- **When you change an invariant, change its guard test in the same commit.** An
  invariant nothing enforces is a comment, and comments drift.
- **Prune.** If a section has not been true for a while, delete it rather than
  softening it. A stale instruction is worse than a missing one.
