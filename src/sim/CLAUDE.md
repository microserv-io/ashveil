# src/sim — the deterministic core

The game lives here. It does not know the browser exists.

## The contract

Same seed, same run, on any host. That is what makes a headless bug reproduce
exactly in the browser and lets balance be measured without opening anything.

Banned in this directory, enforced by `tests/architecture.test.ts`:
`Math.random`, `Date.now`, `new Date`, `performance.now`, `window.*`, `document.*`,
`requestAnimationFrame`, and any import of `three` or `../render` / `../ui`.

- Randomness comes from `sim.rng` only. Use `rng.fork(salt)` when a subsystem needs
  its own stream without shifting the sequence everyone else sees.
- Time is `sim.time` and `sim.tickCount`, advanced by `tick()`. Never wall-clock.
- `DT` is fixed at 1/60. Systems must not read the render frame rate.

## Tick order

`Sim.tick()` is a registry of phases and the order is load-bearing:

1. `applyIntents` — the only way state changes from outside
2. `advanceTimers` — cooldowns, windup, recovery, hit flash
3. `resolveCasts` → `updateProjectiles` → `updateAilments` — everything that deals damage
4. `updateDeaths` — flag deaths **before** anything decides
5. `updateAI` — monsters now read an accurate world
6. `updateMovement` → `resolveSeparation`
7. `updateRegeneration` → `updatePickups` → `updateRespawn` → `updateAreaState`

Deaths sit between damage and decisions on purpose. With AI running first, monsters
spend a tick reacting to a corpse whose `dead` flag has not been set yet.

## Modules

| file | what it owns |
| --- | --- |
| `sim.ts` | the coordinator: clock, entity set, tick phases, intents, events |
| `types.ts` | every shared type, the tuning constants, the `SimEvent` union, `Actor` |
| `damage.ts` | the hit pipeline. Change nothing here without a test in `tests/damage.test.ts` |
| `stats.ts` | mod resolution: `(base + flat) * (1 + Σincreased) * Πmore` |
| `skills.ts` | skill data. The windup/recovery numbers are the main lever on game feel |
| `monsters.ts` | archetypes, rarity scaling, monster modifier pool |
| `ai.ts` | monster state machine: aggro, pack alerting, leashing, retreat |
| `items.ts` | bases, tiered affix pools, rolling; local vs global mods |
| `loot.ts` | drop tables per monster rarity |
| `mapgen.ts` | rooms, corridors, pack placement; also the tile queries |
| `pathfind.ts` | `NavGrid` (per-radius passability) and 8-way A* with string pulling |
| `progression.ts` | XP table, level mods, passive tree |
| `targeting.ts` | soft targeting and aim resolution for cursorless input; pure leaf |
| `character.ts` | the persisted unit: level, xp, gear, passives. Plain JSON, no Map/Set |
| `snapshot.ts` | `InstanceSnapshot` and the tick modes; version-gated |
| `harness.ts` | scripted bot policies, run metrics, DPS and sweep probes |
| `rng.ts`, `vec2.ts` | pure leaves; a test imports them directly |

## Multiplayer rules

The instance holds *players*, plural. Anything written against "the player" is a
bug waiting for the second one to arrive.

- `sim.player` and `sim.progress` mean **the local player** — a host convenience,
  not a claim that there is only one. Systems iterate `playerActors()` instead.
- Commands arrive as `PlayerCommand`: addressed and sequenced. `slot.lastSequence`
  is what a client reconciles its prediction against, so never stop recording it.
- Events concerning one player carry `subject`. Without it a client cannot tell its
  own loot from a party member's.
- **Predicted ticks must not draw from the RNG.** `tick('predicted')` locks it and
  throws on any draw. Anything that rolls — damage, loot, ailments, xp — belongs in
  the authoritative half of the tick and nowhere else.
- Replicated state must survive `JSON.stringify`. No `Map`, no `Set`, no class
  instances in `Actor`, `Character`, projectiles, ground items or orbs.
- Area geometry is a pure function of `(seed, depth)` via `areaRng`. Never send a
  map; send the seed. Never draw map generation from the main stream, or a restored
  snapshot regenerates different geometry.

## Adding a mechanic

1. If it is pure (no `Sim`, no rng, no clock), make it a leaf module like `vec2.ts`
   and test it directly. Prefer this.
2. State on `Actor` must be serialisable and part of the fingerprint — anything a
   replay would need to reproduce belongs there, including presentation-ish fields
   like `hitFlash`.
3. New player capabilities go through `Intent`, never through a method the browser
   calls directly. If the bot cannot reach it, it cannot be tested.
4. Tell the host what happened with a `SimEvent`. The renderer, HUD and harness all
   read the same stream; none of them poll for changes.
5. Re-run `npm run sim -- sweep` before and after. A mechanic that does not move any
   number in the report is either inert or untested.

## Traps already hit

- **Wall-sliding hides being stuck.** Progress must be measured toward the current
  waypoint, not as raw distance travelled: a body grinding along a wall moves at
  nearly full speed while getting no closer. See `trackStuck`.
- **Path smoothing must anchor on the actor's real position** for the first segment.
  Anchoring on the first tile centre can emit an opening waypoint the actor cannot
  reach, and separation pushes drift actors off their path afterwards.
- **The weapon's `attacksPerSecond` is the base attack speed**, applied in
  `recomputeStats`. It is easy to roll that number and never feed it anywhere.
- **Local weapon mods must not also be granted globally** or they count twice for
  attacks that already scale with weapon damage.
- **Direct movement has no pathfinder.** Walking a straight line at a destination
  grinds into the first wall between here and there. Anything steering with
  `move_direction` over distance has to follow a path, as `steerToward` does.
- **Sight is not a walkability test.** `hasLineOfSight` ignores body radius, so a
  gap a projectile flies through is one a shoulder wedges in. Use `hasLineOfWalk`
  for "can I walk straight there".
