---
name: run-ashveil
description: Build, run, and drive Ashveil. Use when asked to start the game, play it, screenshot the UI, verify a change in the real client, or interact with the running app.
---

Ashveil is a Vite + Three.js browser game. Start the dev server, then drive it with
`.claude/skills/run-ashveil/driver.mjs`, a Playwright script that plays the game with
real mouse and keyboard input and writes screenshots to `/tmp/`.

**Most changes here do not need the browser at all.** The repo ships its own headless
harness that runs the whole game in Node in under a second — see
[Sim changes](#sim-changes-the-fast-path) below. Reach for the browser driver when the
change touches `src/render/`, `src/ui/` or the input layer, or when someone asks to see it.

## Prerequisites

macOS or Linux with Node and npm. Verified against:

```bash
node -v   # v25.8.2
npm -v    # 11.11.1
```

No system packages are needed. **Chrome is not required** — the driver uses a
Playwright-managed Chromium, so this works on a machine with no browser installed.

## Setup

```bash
npm install
```

Playwright is installed into the skill directory rather than the repo, because the
project keeps a small dependency set on purpose and this is agent tooling, not product
code. `node_modules/` is already gitignored at every level.

```bash
npm install --prefix .claude/skills/run-ashveil playwright
.claude/skills/run-ashveil/node_modules/.bin/playwright install chromium
```

`driver.mjs` lives next to that `node_modules`, so its `import { chromium }` resolves
without touching the repo's own dependencies.

## Run (agent path)

Start the dev server in the background. It binds loopback by default; `--host 0.0.0.0`
also exposes it on the machine's LAN and tailnet addresses, which is what you want when
the session is being driven remotely.

```bash
npm run dev -- --host 0.0.0.0
```

Wait for it, rather than sleeping a fixed amount:

```bash
for i in $(seq 1 10); do curl -sf -o /dev/null http://127.0.0.1:5273/ && break; sleep 1; done
```

Then pick a command. All three exit non-zero on a console error or an unmet expectation,
so they work as assertions in a chain.

```bash
node .claude/skills/run-ashveil/driver.mjs smoke
node .claude/skills/run-ashveil/driver.mjs play
node .claude/skills/run-ashveil/driver.mjs loop
```

| command | what it proves | screenshots |
|---|---|---|
| `smoke` | Page loads, scene renders, the fixed-timestep loop is advancing, no console errors | `/tmp/ashveil-smoke.png` |
| `play` | The whole product: walks into a pack, kills, loot drops, picks it up with `E`, wears it from the gear panel | `/tmp/ashveil-play-fought.png`, `-play-gear.png`, `-play-equipped.png` |
| `loop` | Area transition — depth advances, player arrives at the new spawn, cooldowns reset | `/tmp/ashveil-loop-next-area.png` |

Flags: `--url http://127.0.0.1:5273`, `--seed 7`, and `--steps 260` (how long `play`
hunts before giving up).

Real output from `play`:

```
fought:  {"tick":841,"depth":1,"level":1,"xp":48,"kills":2,"left":54,"ground":2,...,"life":"26/75"}
looted:  {"tick":994,...,"ground":0,"bag":2,...}
equip:   Grimsong, Rough Glovesgloves+6 armour+16 maximum mana+14 maximum life+
worn:    {"tick":1149,...,"bag":1,"worn":3,"armour":25,"life":"21/89"}
PASS play: 2 kills, 48 xp, 1 carried, 3 worn, armour 25
```

At `--seed 7` that outcome held across three consecutive runs. Armour going 14 to 25 is
the equip actually landing, not just the panel closing.

**Look at the screenshot.** A dark frame is normal — the game is dim by design — but you
should see the isometric room, the skill bar, and the two orbs. An empty white frame
means it never rendered.

## Sim changes: the fast path

`src/sim/` is the game and it runs headless. This is faster than the browser and gives
you numbers instead of a picture:

```bash
npm run sim -- playtest --seed 7 --minutes 6      # 21600 ticks in ~300ms
npm run sim -- sweep --seeds 6 --minutes 4        # the envelope across seeds
npm run sim -- trace --seed 7 --every 2           # per-second readout for debugging
npm run gate                                      # typecheck + tests + build
```

Runs are deterministic, so a pure refactor should produce a **byte-identical sweep, per
seed** — not merely a similar envelope. If per-seed numbers moved, you changed the RNG
draw order somewhere.

## Run (human path)

```bash
npm run dev
```

Opens at http://localhost:5273. `?seed=7` reproduces an exact run. Controls are printed
along the bottom of the screen: WASD move, mouse aim, LMB attack, RMB firebolt, Q nova,
Space dash, E loot, F portal, Tab gear, P passives, M toggles movement mode.

## Gotchas

Each of these cost real debugging time.

- **A WASD bot gets zero kills.** `MOVE_KEYS` in `src/render/keyboard.ts` maps WASD
  straight to world axes with no pathfinder, so holding keys toward the nearest monster
  grinds the player into the first wall between here and there — `state: 'moving'` with
  the position frozen. Press `m` for click-to-move, which routes through `findPath`. The
  driver does this in `beginPlaying()`.
- **Click-to-move needs the button held DOWN.** The move intent is only emitted while
  `attack_primary` is held. Pulsing `mouse.down()` / `mouse.up()` in a loop never moves
  the player. Hold the button and re-aim with `mouse.move()`.
- **There is no keyboard attack.** `attack_primary` is bound to mouse button 0 only, so a
  keyboard-only bot can cast Q and nothing else — and in click mode it cannot walk either.
- **Project to the cursor plane, not the model.** The input layer raycasts the pointer
  onto y=0 (`pointerToGround`), so projecting a monster at body height puts the cursor
  behind it. Project at y=0.
- **There is no `THREE` global to import in the page.** `host.camera.position` is a
  `Vector3` instance, so `host.camera.position.clone().set(x, 0, y).project(host.camera)`
  is how you get world→screen.
- **`globalThis.ashveil` is dev-only** (`import.meta.env.DEV` in `src/main.ts`). Drive
  `npm run dev`, never a preview of `dist/` — the driver will time out waiting for it.
- **Port 5273 is `strictPort: true`.** Vite fails outright rather than picking another
  port, so kill a stale server (or another worktree's) before starting.
- **`E` only loots what is in range.** Pressing it from across the room silently does
  nothing; `ITEM_PICKUP_RANGE` is 2.6. Walk onto the pile first.
- **`#overlay` and `#hud` are `pointer-events: none`,** so canvas clicks pass through
  them — but the ground-item labels inside the overlay *are* real buttons and clicking
  one queues a pickup.
- **Chasing only the nearest monster deadlocks the bot.** The closest one in a straight
  line is regularly behind a wall with no route to it, so the player stands still until
  the steps run out — three kills and then nothing for two hundred steps. `chase()`
  watches for stalled progress and rotates to the next-nearest target; without that,
  `play` failed roughly one run in three.
- **The `play` run is not deterministic** even at a fixed seed, because wall-clock timing
  decides how many frames land between inputs. Kill counts vary run to run, which is why
  the assertions check `> 0` rather than an exact number.
- **Never trust fps from a headless browser.** Chromium falls back to SwiftShader
  software rasterisation, which reported 8fps on a scene the GPU runs at 86. Check
  with `gl.getParameter(WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL)`; launch
  with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` to get real numbers.
- **Normal monsters only drop 22% of the time.** A short fight can legitimately end with
  a bare floor, so `play` fails with "dropped nothing" rather than pretending the loot
  path is broken. Retry or raise `--steps`.

## Troubleshooting

| symptom | cause and fix |
|---|---|
| `Could not find Google Chrome executable` | You reached for the Chrome DevTools MCP. There is no Chrome here — use this driver, which brings its own Chromium. |
| `Cannot find package 'playwright'` | Node resolves from the *script's* directory. Run `driver.mjs` at its committed path so it finds `.claude/skills/run-ashveil/node_modules`; do not copy it elsewhere. |
| `page.waitForFunction: Timeout ... globalThis.ashveil` | Serving a production build, or the server is not the dev server. Use `npm run dev`. |
| `Port 5273 is already in use` | Another dev server, often from a sibling worktree. `lsof -nP -iTCP:5273 -sTCP:LISTEN` then kill it. |
| `FAIL play: killed nothing` | The bot ran out of steps before reaching a pack. Retry, raise `--steps`, or try another `--seed`. |
| `FAIL play: N kills dropped nothing` | Unlucky drop rolls, not a bug. Raise `--steps` so it kills more. |
