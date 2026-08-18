/**
 * Drives the running Ashveil client in headless Chromium.
 *
 * This exists because the interesting part of Ashveil is the ten-second
 * kill-and-loot rhythm, and you cannot see that from a screenshot of the spawn
 * room. The driver plays the game: walks the player into a pack, swings, picks the
 * drops up and wears one.
 *
 *   node .claude/skills/run-ashveil/driver.mjs smoke [--url U] [--seed N]
 *   node .claude/skills/run-ashveil/driver.mjs play  [--url U] [--seed N] [--steps N]
 *   node .claude/skills/run-ashveil/driver.mjs loop  [--url U] [--seed N]
 *
 * Screenshots land in /tmp/ashveil-<command>-*.png. Exit code is non-zero if the
 * page logged an error or the requested flow did not complete.
 */
import { chromium } from 'playwright'

const [, , command = 'smoke', ...rest] = process.argv
const flag = (name, fallback) => {
  const at = rest.indexOf(`--${name}`)
  return at === -1 ? fallback : rest[at + 1]
}

const SEED = flag('seed', '7')
const URL = `${flag('url', 'http://127.0.0.1:5273')}/?seed=${SEED}`
const STEPS = Number(flag('steps', '260'))
const VIEWPORT = { width: 1280, height: 800 }

// ---------------------------------------------------------------------------
// Page-side helpers. `globalThis.ashveil` is a dev-only export from src/main.ts.
// ---------------------------------------------------------------------------

const state = (page) =>
  page.evaluate(() => {
    const { sim } = globalThis.ashveil
    return {
      tick: sim.tickCount,
      depth: sim.depth,
      level: sim.progress.level,
      xp: sim.progress.xp,
      kills: sim.monstersKilled,
      left: sim.monstersRemaining(),
      ground: sim.groundItems.length,
      orbs: sim.orbs.length,
      bag: sim.progress.inventory.length,
      worn: Object.keys(sim.progress.equipment).length,
      armour: Math.round(sim.player.stats.armour),
      life: `${Math.round(sim.player.life)}/${Math.round(sim.player.stats.maxLife)}`,
      pos: [+sim.player.pos.x.toFixed(1), +sim.player.pos.y.toFixed(1)],
    }
  })

/**
 * Screen pixel for the nearest monster or ground item.
 *
 * Projected at ground height, not body height: the input layer raycasts the cursor
 * onto the y=0 plane, so aiming at a monster's chest lands the cursor behind it.
 * There is no THREE global to import, but `camera.position` is a Vector3 instance,
 * so cloning it is the way to get one.
 */
const nearest = (page, kind, rank = 0) =>
  page.evaluate(
    ([k, n]) => {
      const { sim, host } = globalThis.ashveil
      const me = sim.player.pos
      const pool =
        k === 'monster' ? sim.monsters().filter((m) => !m.dead).map((m) => m.pos) : sim.groundItems.map((g) => g.pos)
      if (!pool.length) return null
      const gap = (p) => Math.hypot(p.x - me.x, p.y - me.y)
      const target = [...pool].sort((a, b) => gap(a) - gap(b))[n % pool.length]
      const ndc = host.camera.position.clone().set(target.x, 0, target.y).project(host.camera)
      return {
        x: ((ndc.x + 1) / 2) * innerWidth,
        y: ((1 - ndc.y) / 2) * innerHeight,
        gap: +gap(target).toFixed(1),
      }
    },
    [kind, rank],
  )

const onScreen = (at) => [Math.max(4, Math.min(VIEWPORT.width - 4, at.x)), Math.max(4, Math.min(VIEWPORT.height - 4, at.y))]

// ---------------------------------------------------------------------------

async function open() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: VIEWPORT })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto(URL, { waitUntil: 'load' })
  // Dev-only global; if this times out you are serving a production build.
  await page.waitForFunction(() => globalThis.ashveil?.sim, null, { timeout: 20_000 })
  return { browser, page, errors }
}

async function shot(page, name) {
  const path = `/tmp/ashveil-${name}.png`
  await page.screenshot({ path })
  console.log(`  screenshot ${path}`)
}

/**
 * Click-to-move, because WASD does not pathfind and walks the player into the
 * first wall between here and the target. `m` toggles it on. The button has to
 * stay DOWN — the move intent is emitted only while attack_primary is held, so
 * pulsing the mouse never gets anywhere. Re-aim by moving, not by re-clicking.
 */
async function beginPlaying(page) {
  await page.keyboard.press('m')
  await (await page.$('canvas')).hover()
  await page.mouse.down()
}

/**
 * Chase and engage. Rotates to the next-nearest target when progress stalls: the
 * closest monster in a straight line is often behind a wall with no route to it, and
 * a bot that only ever picks the nearest one stands there until the steps run out.
 */
async function chase(page, kind, steps, stop) {
  let rank = 0
  let sinceProgress = 0
  let last = await state(page)

  for (let step = 0; step < steps; step++) {
    const at = await nearest(page, kind, rank)
    if (!at) return false
    await page.mouse.move(...onScreen(at))
    if (kind === 'monster' && step % 10 === 9) await page.keyboard.press('q') // frost nova
    if (kind === 'ground' && step % 4 === 3) await page.keyboard.press('e') // loot in range
    await page.waitForTimeout(130)

    const now = await state(page)
    if (stop && (await stop(now))) return true
    const moved = Math.hypot(now.pos[0] - last.pos[0], now.pos[1] - last.pos[1])
    if (now.kills > last.kills || now.bag > last.bag || moved > 0.6) sinceProgress = 0
    else if (++sinceProgress >= 20) {
      rank++
      sinceProgress = 0
    }
    last = now
  }
  return false
}

// ---------------------------------------------------------------------------

async function smoke() {
  const { browser, page, errors } = await open()
  const loaded = await state(page)
  console.log('loaded:', JSON.stringify(loaded))
  await shot(page, 'smoke')

  // Let the fixed-timestep loop actually advance, so a frozen frame is caught.
  await page.waitForTimeout(1500)
  const later = await state(page)
  await browser.close()

  if (later.tick <= loaded.tick) throw new Error(`sim is not ticking (${loaded.tick} -> ${later.tick})`)
  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  console.log(`ticking: ${loaded.tick} -> ${later.tick}`)
  return 'ok'
}

/** Kill something, loot it, wear it. The whole product in one pass. */
async function play() {
  const { browser, page, errors } = await open()
  console.log('loaded: ', JSON.stringify(await state(page)))
  await beginPlaying(page)

  await chase(page, 'monster', STEPS, (now) => now.ground >= 2)
  const fought = await state(page)
  console.log('fought: ', JSON.stringify(fought))
  await shot(page, 'play-fought')

  await chase(page, 'ground', 140, (now) => now.ground === 0 && now.bag > 0)
  await page.mouse.up()
  await page.keyboard.press('e')
  await page.waitForTimeout(400)
  const looted = await state(page)
  console.log('looted: ', JSON.stringify(looted))

  // Wear it through the real panel: Tab, then click the row in Carried.
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  await shot(page, 'play-gear')
  const row = page.locator('#hud button').filter({ hasText: 'upgrade' }).first()
  if (await row.count()) {
    console.log('equip:  ', (await row.textContent())?.replace(/\s+/g, ' ').trim().slice(0, 70))
    await row.click()
    await page.waitForTimeout(400)
  }
  const worn = await state(page)
  console.log('worn:   ', JSON.stringify(worn))
  await shot(page, 'play-equipped')
  await browser.close()

  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  if (fought.kills === 0) throw new Error('killed nothing — the bot never reached a pack')
  // Normal monsters drop 22% of the time, so a short unlucky fight can legitimately
  // leave the floor bare. Only a fight that dropped something proves the loot path.
  if (fought.ground === 0) throw new Error(`${fought.kills} kills dropped nothing — retry or raise --steps`)
  if (looted.bag === 0) throw new Error('picked nothing up — loot stayed on the floor')
  return `${worn.kills} kills, ${worn.xp} xp, ${worn.bag} carried, ${worn.worn} worn, armour ${worn.armour}`
}

/**
 * The area loop, driven straight through the sim's own command path rather than
 * the input layer: portals need the area cleared first, which is minutes of play.
 */
async function loop() {
  const { browser, page, errors } = await open()
  const result = await page.evaluate(() => {
    const { sim } = globalThis.ashveil
    const before = { depth: sim.depth, cooldowns: { ...sim.player.cooldowns }, pos: { ...sim.player.pos } }
    sim.enterNextArea()
    // Check placement before ticking: monsters aggro and the player walks off.
    const arrived = { atSpawn: sim.player.pos.x === sim.map.spawn.x && sim.player.pos.y === sim.map.spawn.y }
    for (let i = 0; i < 120; i++) sim.tick()
    return {
      before,
      arrived,
      after: { depth: sim.depth, cooldowns: sim.player.cooldowns, monsters: sim.monstersRemaining() },
    }
  })
  console.log('transition:', JSON.stringify(result))
  await shot(page, 'loop-next-area')
  await browser.close()

  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  if (result.after.depth !== result.before.depth + 1) throw new Error('depth did not advance')
  if (!result.arrived.atSpawn) throw new Error('player did not arrive at the new spawn')
  return `depth ${result.before.depth} -> ${result.after.depth}, ${result.after.monsters} monsters`
}

const commands = { smoke, play, loop }
if (!commands[command]) {
  console.error(`unknown command "${command}" — expected one of ${Object.keys(commands).join(', ')}`)
  process.exit(2)
}

try {
  console.log(`${command} @ ${URL}`)
  console.log(`PASS ${command}: ${await commands[command]()}`)
} catch (error) {
  console.error(`FAIL ${command}: ${error.message}`)
  process.exit(1)
}
