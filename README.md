# Ashveil

An isometric action-RPG in the Diablo / Path of Exile lineage, built core loop first.

The loop is the product: **pull a pack → spend skills → things die → loot drops → your
numbers change → go deeper, harder.** Everything else (endgame, crafting, trade,
ascendancies, uniques) hangs off that, and none of it matters if the ten-second
kill-and-loot rhythm does not feel good. So that rhythm is what exists so far.

```bash
npm install
npm run dev          # play it at http://localhost:5273
npm run sim          # play it headless, and get numbers back
npm test             # 183 tests
```

## Architecture

The rule that shapes everything: **`src/sim` is the game, and it does not know the
browser exists.**

```
src/sim/      deterministic core — seeded RNG, fixed 60Hz tick, no DOM, no wall-clock
src/render/   three.js scene, meshes, effects, screen-space overlay, input
src/ui/       HUD, inventory, passive tree
headless/     CLI that drives the sim with a scripted player
tests/        vitest, including the architecture guard below
```

`src/sim` never imports three.js and never touches `Math.random`, `Date.now`,
`window` or `requestAnimationFrame`. That is not a convention, it is enforced by
`tests/architecture.test.ts`, which reads every file in the directory and fails the
build on any of them. The payoff: the same seed produces the same run everywhere, so
a bug found headless reproduces exactly in the browser, and balance can be measured
without opening anything.

The browser and the headless bot both drive the sim through one narrow surface:

```ts
sim.queue({ kind: 'use_skill', skill: 'frost_nova', aim: position })
sim.tick()
for (const event of sim.events) { /* draw, log, or measure */ }
```

Anything a human can reach, a test can reach. Rendering is a pure projection of sim
state — dropping a frame of effects can never change the outcome of a run.

## The damage pipeline

Modelled on PoE's, because that ordering is where the genre's build depth lives and
retrofitting it later is miserable:

```
base → flat added → increased (additive) → more (multiplicative) → crit → mitigation
```

Every mod a build can touch enters at exactly one of those steps. A mod carries tags
and applies to a hit only when *every* tag it carries is present on that hit, so
`{stat: 'damage', kind: 'increased', value: 40, tags: ['fire', 'spell']}` reads as
"40% increased Fire Spell Damage" and scales only the fire portion of spells.

Mitigation splits the way it should: armour scales against the size of the hit it
faces (so it eats a swarm's chip damage and barely dents a brute's slam), while
resistances are a flat percentage capped at 75%.

Weapons carry **local** affixes that modify the weapon's own numbers, and global ones
that modify the wearer. That distinction matters — treating a weapon's flat physical
roll as a global mod would count it twice for attacks that already scale with weapon
damage.

## The headless sim

`npm run sim` runs the real game with a scripted player. This is the main balance
instrument, not a toy.

```bash
npm run sim -- playtest --seed 7 --minutes 6   # one full run, reported
npm run sim -- sweep --seeds 8 --minutes 4     # variance across seeds
npm run sim -- dps                             # per-skill DPS, real timings
npm run sim -- trace --seed 7 --every 2        # second-by-second readout
```

`playtest` reports depth reached, clear times, kills/min, time-to-kill, DPS overall
vs in combat, damage split by skill, drops by rarity, deaths, and where the run's
time actually went (idle / moving / acting / dead).

`trace` is the debugging tool. It prints a row per interval with position, state,
distance moved, path cursor and current target. Three real bugs were found by reading
its `moved` column: the fix history is in the git log.

Bot policies live in `src/sim/harness.ts` — `brawler` plays the intended loop,
`punching-bag` never fights back (so monster lethality can be measured), and `runner`
skips combat entirely (so "can packs be outrun" can be answered). Add a policy to ask
a new question.

## Current state

Playable end to end. A four-minute run typically reaches depth 2–3 and level 6–7 at
roughly 25 kills/min with 0–1 deaths, and clear times fall as power accrues, which is
the curve the loop is supposed to have.

**In:** click-to-move with A* and an unstuck net, four player skills on a commit
(windup → hit → recovery) model, three monster archetypes with pack aggro, leashing
and telegraphed hits, monster rarities with rolled modifiers, the damage pipeline
above, items with tiered affixes, drop tables, inventory and equipment, XP and levels,
a 14-node passive tree, procedural areas, and a portal that generates the next one
deeper.

**Deliberately not in yet:** flasks, currency and crafting, more than one character
archetype, skill gems / supports, uniques, a real endgame, sound, and art. The meshes
are coloured primitives on purpose — the question this build answers is whether the
loop is worth dressing up, not what the dressing looks like.

## Notes

- `?seed=7` in the URL reproduces an exact run; omit it for a random one.
- In dev, `globalThis.ashveil` exposes `{ sim, host, view, input }` for poking at a
  live game from the console.
- Controls: LMB move/attack, RMB firebolt, Q nova, Space dash, E loot, Tab gear,
  P passives, F portal.
