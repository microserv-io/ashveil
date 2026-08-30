# Ashveil

An elevated top-down action-RPG in the Diablo / Path of Exile lineage, built core loop first.

The loop is the product: **pull a pack → spend skills → things die → loot drops → your
numbers change → go deeper, harder.** Everything else (endgame, crafting, trade,
ascendancies, uniques) hangs off that, and none of it matters if the ten-second
kill-and-loot rhythm does not feel good. So that rhythm is what exists so far.

```bash
npm install
npm run dev          # play it at http://localhost:5273
npm run sim          # play it headless, and get numbers back
npm test             # vitest suite
```

## Architecture

The rule that shapes everything: **`src/sim` is the game, and it does not know the
browser exists.**

```
src/sim/      deterministic core — seeded RNG, fixed 60Hz tick, no DOM, no wall-clock
src/session/  characters, persistence, the authoritative session
src/net/      transport abstraction and wire protocol
src/render/   three.js scene, meshes, effects, screen-space overlay, input
src/ui/       HUD, inventory, passive tree
headless/     CLI that drives the sim with a scripted player
tests/        vitest, including the architecture guards below
```

Dependencies point inward and a test enforces it. See
[docs/architecture.md](docs/architecture.md) for the layering, the netcode model
and why single-player is a one-player session rather than its own code path.

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

## The frame budget

A frame has 16.67ms to advance the sim and draw it. `npm run perf` plays a fixed seed
against a bot in real Chrome and reports where that time went, against a baseline
recorded on the machine it runs on.

```bash
npm run perf                  # measure and compare
npm run perf -- --record      # this is the new baseline
npm run perf -- --headed      # watch it play
```

It measures CPU cost per frame rather than an fps counter, because rAF is paced by
the compositor: it reads ~48fps on an empty page on a busy machine and 60 on an idle
one, whichever way the game is performing. Nearly all of the cost is in drawing —
advancing the sim is about 0.1ms of the frame.

Bot policies live in `src/sim/harness.ts` — `brawler` plays the intended loop with a
cursor, `twinstick` plays it with a stick, `punching-bag` never fights back (so monster
lethality can be measured), and `runner` skips combat entirely (so "can packs be
outrun" can be answered). Add a policy to ask a new question.

## Controls

Movement is **direct** by default — left stick or WASD — not click-to-move. A stick
sends a direction, and a direction is the only thing that can express strafing,
kiting, or backing out of a slam telegraph while still facing the fight. Click-to-move
is still there for the older feel; `M` toggles it.

Aiming without a cursor is a soft target: the right stick aims explicitly, and if you
do not touch it the game picks a target from what you are facing. That decides who
gets hit, so it lives in `src/sim/targeting.ts` where it is testable, not in the
input handler. A mouse gets no assistance — you already have exact aim.

| | mouse + keyboard | gamepad | Steam Deck |
| --- | --- | --- | --- |
| move | WASD | left stick | left stick |
| aim | cursor | right stick | right stick or right trackpad |
| attack | LMB | RT | R2 |
| firebolt | RMB | RB | R1 |
| nova | Q | LB | L1 |
| dash | Space | LT | **L4** |
| interact / portal | F | A | **R4** |
| loot | E | X | **L5** |
| gear | Tab | Y | **R5** |
| passives | P | Menu | Menu |

### Devices

Gameplay asks for actions (`attack_primary`), never buttons. Backends fill in the
same action set, so a new device is a profile in `src/render/profiles.ts` and
nothing else changes. Bindings that point past what a device reports are inert, so
the Deck profile degrades to the standard layout rather than breaking on a pad that
lacks back grips.

Back grips carry the actions you need while both thumbs are already busy — dash,
loot, interact — which is exactly what an ARPG asks for. The right trackpad reads as
an absolute position from centre, which is far closer to a mouse than a stick is.

**A caveat worth knowing.** Through Steam, a Deck presents as a plain virtual XInput
pad: Steam Input binds the grips, trackpads and gyro onto the standard controls, and
the extras never reach the page. The extended profile therefore only engages when the
device really reports them (desktop mode, Steam Input not intercepting) — capability
is detected, not assumed from the name. Reaching them properly under Steam means the
Steamworks `ISteamInput` API and a native shell (Electron or Tauri + steamworks.js).
The action layer is the seam for that: a Steam Input backend fills the same actions,
and gameplay does not change. That port is not done.

The controller path is covered headlessly by the `twinstick` bot policy, so a
regression shows up as a number in a sweep rather than as a bug report:

```bash
npm run sim -- sweep --seeds 6 --minutes 4 --policy twinstick
npm run sim -- sweep --seeds 6 --minutes 4 --policy brawler
```

## Current state

Playable end to end. A four-minute headless run typically reaches depth 2-3 and level
6-7 at roughly 25 kills/min with 0-1 deaths, and clear times fall as power accrues,
which is the curve the loop is supposed to have. Re-measure with
`npm run sim -- sweep` rather than trusting this paragraph.

Working on this? Start with [CLAUDE.md](CLAUDE.md), then
[docs/game-design-document.md](docs/game-design-document.md) for player-facing design,
[docs/architecture.md](docs/architecture.md) for structural work and
[src/sim/CLAUDE.md](src/sim/CLAUDE.md) before touching the sim.

**In:** direct movement with click-to-move as an option, gamepad and Steam Deck
support through an action layer, A* with an unstuck net, four player skills on a commit
(windup → hit → recovery) model, three monster archetypes with pack aggro, leashing
and telegraphed hits, monster rarities with rolled modifiers, the damage pipeline
above, items with tiered affixes, drop tables, inventory and equipment, XP and levels,
a 14-node passive tree, procedural areas, and a portal that generates the next one
deeper.

**Deliberately not in yet:** touch controls, a Steamworks/Steam Input backend, flasks,
currency and crafting, more than one character archetype, skill gems / supports,
uniques, a real endgame, sound, and art. The meshes are coloured primitives on
purpose — the question this build answers is whether the loop is worth dressing up,
not what the dressing looks like.

## Notes

- `?seed=7` in the URL reproduces an exact run; omit it for a random one.
- In dev, `globalThis.ashveil` exposes `{ sim, host, view, input }` for poking at a
  live game from the console.
- `?ui=1.4` overrides the interface scale; it bumps automatically when a pad is
  connected, since a controller usually means a handheld or a couch.

## License

MIT. Client, server, simulation and all — see [LICENSE](LICENSE).

The dependency set is deliberately small and permissively licensed (Three.js, Vite
and Vitest are all MIT). The art is the KayKit Adventurers, Skeletons and Dungeon
Remastered packs by Kay Lousberg (kaylousberg.com), released under CC0 1.0: no
attribution is required, so the credit here is courtesy rather than obligation. The
models are fetched by `npm run assets` rather than committed. There is no audio.
