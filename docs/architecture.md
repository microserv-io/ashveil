# Ashveil architecture

The decisions here exist to keep two futures cheap: **co-op multiplayer** and a
**native Steam Deck build**. Both are easy to make impossible by accident, and both
are shaped almost entirely by choices made before either is written.

## The one decision everything else follows from

**There is no single-player code path.**

Single-player is a one-player session against a server running in the same process
over a loopback transport. Co-op is the same session with more players and a real
transport. If single-player were its own path, multiplayer would be a rewrite, and
the two paths would drift the moment anything was fixed in one of them.

```
                 ┌─────────────────────────────────────────┐
                 │ GameServer (authoritative)              │
   Commands ───► │   characters · parties · instances      │
                 │   Instance.tick('authoritative')        │
   Snapshots ◄── │   rolls all randomness                  │
   + Events      └─────────────────────────────────────────┘
                                    ▲
                              Transport
                    (loopback │ Steam sockets │ WebSocket)
                                    ▼
                 ┌─────────────────────────────────────────┐
                 │ Client                                  │
                 │   predicts own movement, RNG-free       │
                 │   reconciles against snapshots          │
                 │   renders a projection of sim state     │
                 └─────────────────────────────────────────┘
```

Single-player collapses this to one process with a loopback transport. Nothing about
the game code knows the difference.

## Netcode model: authoritative server with client prediction

The genre has settled this. Diablo and PoE are server-authoritative because an ARPG
is a loot game, and a loot game with client-authoritative damage or drops is a
cheating game. Lockstep is the wrong fit — it cannot do drop-in/drop-out, and it
demands cross-platform floating-point determinism we would have to guarantee between
a Deck and a desktop.

The consequences that shape the code:

| concern | where it happens |
| --- | --- |
| movement, timers, animation | predicted on the client, corrected by the server |
| damage rolls, crits, ailments | server only |
| loot drops, affix rolls | server only |
| xp, levels, passives | server only |
| area generation | server rolls the seed; clients regenerate from it |

**The rule this creates: prediction must be RNG-free.** A client that rolls dice
diverges immediately and irrecoverably. So the tick is split into a predictable
subset and an authoritative one, and a test asserts the predictable subset never
reaches the RNG. See `Instance.tick(mode)`.

The prediction loop, when it is built:

1. client samples input, produces `PlayerCommand {playerId, sequence, intent}`
2. client applies it to its local sim (predictable systems only) and buffers it
3. server applies commands on its own tick and broadcasts a snapshot plus events,
   including the last sequence it processed per player
4. client rewinds its own actor to the snapshot and replays buffered commands newer
   than that sequence
5. everything the client does not own is interpolated between snapshots

Snapshots carry the seed, never the map: areas are a pure function of
`(seed, depth)`, so a late joiner regenerates the geometry locally.

## Layers

```
src/sim/        rules and simulation. No DOM, no wall-clock, no Math.random, no network.
src/session/    characters, parties, instances, transitions. Owns what outlives an area.
src/net/        transport abstraction and the wire protocol. No gameplay.
src/render/     three.js projection of sim state.
src/ui/         HUD and panels.
headless/       CLI harness driving the sim with scripted players.
```

Dependency rule, enforced by `tests/architecture.test.ts`: **dependencies point
inward.** `sim` imports nothing from the others. `session` may import `sim`. `net`
may import `session` and `sim` types. `render` and `ui` may import `sim` types and
read sim state, never mutate it.

Animation is also a projection: each actor view converts replicated state and sim
time into a preallocated `RigInput`, then gives it to that body's `MotionDriver`.
The clip-backed driver owns Three.js animation state; neither the driver nor the
pose feeds information back into the simulation.

### Zones

Three kinds of place, with different rules, because they answer different questions:

| | geometry | combat | who is there | entry | cleared? |
| --- | --- | --- | --- | --- | --- |
| **hub** | authored | no | strangers, up to ~50 | seamless | never |
| **overworld** | authored | yes | your party only | seamless | never; monsters respawn |
| **dungeon** | procedural from `(seed, depth)` | yes | your party only | portal | yes, then left behind |

Strangers appear in hubs and nowhere else. That is the load-bearing decision: every
fight in the game then happens at a known party size, so monster density and health
can be tuned against it. Shared-world combat would break that, and defending against
leeching and griefing is a second problem on top.

The procedural generator therefore only ever serves dungeons. Hubs and the overworld
need authored geometry, which is content rather than code — the generator is wired
behind a zone rule so authored maps can replace it per zone without touching the sim.

**Seamless is still a handoff.** A shared hub and a party-only overworld cannot be
the same instance, so walking between them crosses instances no matter how it looks.
`entry: 'seamless'` is a promise about presentation, not topology: the client
connects to the destination before it leaves the source and hands off without a
loading screen. Dungeons are `entry: 'portal'` and may take their time. This is the
one place the session layer has to hold two connections at once, and it is why the
transport is an interface rather than a single socket.

### Instance vs session

Two things were tangled and are now separate:

- **`Instance`** is one area with actors in it: map, monsters, projectiles, ground
  loot, the tick. Ephemeral, thrown away when the party leaves. Party-scoped, the way
  ARPG zones always are.
- **`Session`/`GameServer`** owns what survives: characters, party membership, which
  instance each party is in, and moving them between instances. Taking the portal is
  not an instance mutating itself — it is the session creating the next instance and
  migrating the party into it.

`Character` is the persisted unit — level, xp, equipment, inventory, passives. This
is also the save game, which the native build needs regardless of multiplayer.

## Patterns in use, and why

**Deterministic simulation with a fixed timestep.** Same seed, same run, any host.
Without it, server-authoritative play cannot be reproduced or debugged, and the
headless harness could not measure anything. Enforced by test, not convention.

**Command pattern for all input.** `PlayerCommand` is the only way the world changes
from outside. Addressed (`playerId`) so inputs can be attributed, sequenced so
prediction can be reconciled. Because it is plain data, it is already the wire
format, and because it is the *only* path, anything a player can do a test can do.

**Event stream as the replication channel.** Systems announce what happened rather
than calling into presentation. The renderer, the HUD, the harness and — later — the
network all consume the same stream. Events carry a `subject` so a client can tell
"someone levelled" from "you levelled".

**Snapshot and restore.** Needed three times over: late join, prediction
reconciliation, and save games. This is why sim state must stay serialisable, which
in turn is why `Map`/`Set` in replicated state is a defect rather than a preference.

**Transport abstraction.** `LoopbackTransport` for single-player and the listen
server, Steam sockets for the native build, WebSocket for a dedicated server. The
game never names one.

**Repository for persistence.** Characters load and save through an interface, so the
web build can use IndexedDB, the native build the filesystem, and a live deployment
an account service, without the session layer noticing.

## Economy

Trade is deliberately not built. What *is* built is the part that cannot be added
afterwards, because by then items are already in circulation with no history:

- **Server-issued identity and provenance.** Every item carries an id unique to the
  instance that minted it, plus where it came from — instance, depth, tick, source.
  That audit trail is how duplication is found. This replaced a module-global
  counter that leaked across instances in one process.
- **Binding.** Nothing binds while nothing trades, but the field exists on every
  item from the start. Retrofitting it means deciding retroactively what every
  existing item is.
- **Realms.** Online characters live server-side and are the only ones an economy
  may touch; offline characters live in a local save. There is deliberately no
  migration between them — an offline character's items were minted on a machine
  the player controls, which is the simplest dupe there is. It also means the
  native build keeps offline play, which matters on a handheld.

The risk worth stating plainly is not technical. A frictionless economy can gut the
loop the whole game rests on: when buying an upgrade beats farming one, killing
things stops mattering. Diablo III's auction house is the cautionary case. Every
ARPG since has answered deliberately — Path of Exile with trade friction, Diablo IV
by binding the best items, Last Epoch by making players choose between better drops
and access to trade. That answer sets drop rates, binding rules and item budget, so
it is a design decision to make before the economy is built, not after.

A live economy is also a permanent operational commitment: botting, RMT, dupes,
migrations, uptime. That is the ongoing cost, and it is larger than the build.

## Steam Deck native build

The shell is deliberately thin — it owns platform, never gameplay:

- **Transport**: `SteamNetworkingSockets` via `steamworks.js`, replacing loopback for
  real co-op. Lobbies for matchmaking.
- **Input**: a Steam Input backend filling the same actions the existing backends do
  (`src/render/actions.ts`). This is the only way to reach the back grips, trackpads
  and gyro when running under Steam, and it brings the official rebinding UI with it.
- **Persistence**: filesystem save, optionally Steam Cloud.

Package split is deferred on purpose. Directory boundaries enforced by test give the
same discipline today at no cost; converting to workspaces is mechanical once the
desktop shell actually exists, and doing it earlier buys nothing but churn.

## Phasing

**Phase 1 — seams (no netcode).** Players become a registry. Characters move out of
the instance. Commands become addressed and sequenced. State becomes serialisable.
The tick splits into predictable and authoritative. Transport interface plus
loopback. This is the work that is cheap now and expensive later.

**Phase 2 — native shell.** Tauri or Electron, Steam Input backend, filesystem saves
for offline characters. Single-player throughout; no netcode yet.

**Phase 3 — netcode.** Real transport, snapshot/delta replication, prediction and
reconciliation, interest management. The layers above exist so this phase touches
`net/` and `session/` and almost nothing else.

**Phase 4 — economy.** Account and item services, atomic trades, and the design
answer to trade friction. Requires dedicated servers; listen servers cannot be
authoritative over items that have value.

Deliberately deferred: interest management, delta compression, lag compensation,
anti-cheat beyond server authority, dedicated-server hosting, authored map content,
and shared-world combat. On that last one — if the goal is "the world feels
inhabited", asynchronous presence (traces, echoes, ghosts of other players) buys
most of the feeling at almost no cost and with no effect on difficulty tuning.
