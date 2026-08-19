/**
 * Answers "does this machine still hold 60fps" by playing the real game in real
 * Chrome and measuring what each frame cost.
 *
 *   npm run perf                 # measure, compare against the baseline
 *   npm run perf -- --record     # make the current numbers the baseline
 *
 * Why CPU time per frame rather than an fps counter: rAF is paced by the
 * compositor, so on an idle machine it reads 60 whether a frame costs 2ms or 15,
 * and on a busy one it reads 48 for reasons that have nothing to do with the game.
 * Measured 48fps on an *empty page* on this machine. Frame cost is the honest
 * signal, and 16.67ms is the number that has to hold.
 *
 * The GPU is a real one: headless Chrome on macOS reaches ANGLE Metal, and the
 * run aborts if it ever finds itself on a software rasteriser instead.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const BASELINE = join(ROOT, 'perf', 'baseline.json')

const FRAME_BUDGET_MS = 1000 / 60
/** Wall-clock noise on a shared machine is real; a regression worth acting on is not this small. */
const REGRESSION_TOLERANCE = 0.3
/** Draw calls are deterministic given the same run, so they get almost no slack. */
const SCENE_TOLERANCE = 0.02
/**
 * A frame may still be missed now and then — a garbage collection has to land
 * somewhere. This is the line past which it stops being now and then.
 */
const HITCH_CEILING = 0.01

/** Fixed so the fill rate is part of the baseline rather than a property of the window. */
const VIEWPORT = { width: 1600, height: 900 }
const PREVIEW_PORT = 5277

const args = process.argv.slice(2)
const record = args.includes('--record')
const keepOpen = args.includes('--headed')
const seed = Number(readFlag('--seed') ?? 7)
const frames = Number(readFlag('--frames') ?? 2400)

function readFlag(name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  ...expandPlaywright(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

function expandPlaywright() {
  const cache = join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(cache)) return []
  return readdirSync(cache)
    .filter((entry) => entry.startsWith('chromium-'))
    .flatMap((entry) => [
      join(cache, entry, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      join(cache, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(cache, entry, 'chrome-linux', 'chrome'),
    ])
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      'No Chrome found. Install Chrome, or set CHROME_PATH to a Chromium binary.\n' +
        'Playwright\'s cached Chromium works: npx playwright install chromium',
    )
  }
  return found
}

async function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: 'inherit', ...options })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
    child.on('error', reject)
  })
}

/** Waits for a URL to answer, so the browser is never pointed at a server still starting. */
async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await sleep(150)
  }
  throw new Error(`server never came up at ${url}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A CDP session over the debugger websocket. Node 22 ships the client, so nothing to install. */
async function attach(port) {
  const deadline = Date.now() + 20_000
  let target = null
  while (Date.now() < deadline && !target) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = tabs.find((tab) => tab.type === 'page')
    } catch {}
    if (!target) await sleep(100)
  }
  if (!target) throw new Error('chrome never exposed a page target')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('could not attach to chrome'))
  })

  let nextId = 0
  const pending = new Map()
  socket.onmessage = (message) => {
    const parsed = JSON.parse(message.data)
    const resolver = pending.get(parsed.id)
    if (resolver) {
      pending.delete(parsed.id)
      resolver(parsed)
    }
  }

  const send = (method, params = {}) => {
    const id = ++nextId
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve) => pending.set(id, resolve))
  }

  return {
    send,
    close: () => socket.close(),
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.result?.exceptionDetails) {
        throw new Error(result.result.exceptionDetails.exception?.description ?? 'page threw')
      }
      return result.result?.result?.value
    },
  }
}

async function measure() {
  const chrome = findChrome()
  const profile = await mkdtemp(join(tmpdir(), 'ashveil-perf-'))
  const port = 9422

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    // Pixel ratio is part of the workload; a retina display would double the fill.
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    // A throttled or backgrounded renderer stops measuring the game and starts
    // measuring the scheduler.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank',
  ]
  if (!keepOpen) chromeArgs.unshift('--headless=new')

  const browser = spawn(chrome, chromeArgs, { stdio: 'ignore' })
  let session = null
  try {
    session = await attach(port)
    const url = `http://127.0.0.1:${PREVIEW_PORT}/?seed=${seed}&frames=${frames}`
    await session.send('Page.enable')
    await session.send('Page.navigate', { url })

    const estimate = Math.round((frames + 180) / 60) + 40
    process.stdout.write(`measuring ${frames} frames at seed ${seed} (~${estimate}s)`)
    const deadline = Date.now() + estimate * 1000 + 60_000
    while (Date.now() < deadline) {
      const report = await session.evaluate('JSON.stringify(globalThis.__ashveilPerf ?? null)')
      if (report && report !== 'null') {
        process.stdout.write('\n')
        return JSON.parse(report)
      }
      process.stdout.write('.')
      await sleep(2000)
    }
    throw new Error('the harness never finished; run with --headed to watch it')
  } finally {
    session?.close()
    browser.kill()
    // Chrome writes its profile on the way out, so removing it early races.
    await new Promise((resolve) => browser.on('exit', resolve))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

function format(report) {
  const lines = [
    `renderer        ${report.renderer}`,
    `viewport        ${report.viewport.width}x${report.viewport.height} @${report.viewport.pixelRatio}x`,
    `frames          ${report.frames} (seed ${report.seed}, ${report.policy})`,
    `workload        depth ${report.workload.depth}, ${report.workload.monstersKilled} kills, level ${report.workload.level}`,
    '',
    `                    p50      p95      p99      max`,
    row('sim advance', report.advanceMs),
    row('present', report.presentMs),
    row('whole frame', report.frameMs),
    '',
    `draw calls      ${report.scene.drawCalls} (worst ${report.scene.worstDrawCalls})`,
    `triangles       ${report.scene.triangles}`,
    `budget          ${FRAME_BUDGET_MS.toFixed(2)}ms per frame at 60fps`,
    `headroom        ${(100 - (report.frameMs.p99 / FRAME_BUDGET_MS) * 100).toFixed(1)}% spare at p99`,
    `missed frames   ${report.overBudget.count} of ${report.frames} (${(report.overBudget.share * 100).toFixed(2)}%)`,
    '',
    'worst frames    tick     ms    sync effects overlay   hud  render  programs  heapMb  depth',
    ...report.worstFrames
      .slice(0, 8)
      .map((frame) => {
        const phases = frame.phases ?? {}
        const cell = (value) => (value ?? 0).toFixed(1).padStart(8)
        return (
          `                ${String(frame.tick).padStart(5)}${frame.ms.toFixed(1).padStart(7)}` +
          `${cell(phases.sync)}${cell(phases.effects)}${cell(phases.overlay)}${cell(phases.hud)}${cell(phases.render)}` +
          `${String(frame.programs ?? 0).padStart(10)}${String(frame.heapMb ?? 0).padStart(8)}` +
          `${String(frame.depth ?? 0).padStart(7)}`
        )
      }),
  ]
  return lines.join('\n')
}

function row(label, stats) {
  const cell = (value) => `${value.toFixed(2)}ms`.padStart(9)
  return `${label.padEnd(16)}${cell(stats.p50)}${cell(stats.p95)}${cell(stats.p99)}${cell(stats.max)}`
}

function compare(report, baseline) {
  const failures = []
  const notes = []

  if (report.softwareRasterised) {
    failures.push(`software rasteriser (${report.renderer}) — the numbers mean nothing`)
  }

  // The 60fps claim, and the one that needs no baseline to be true: all but the
  // worst percent of frames fit the budget, and that last percent is counted too.
  if (report.frameMs.p99 >= FRAME_BUDGET_MS) {
    failures.push(
      `p99 frame ${report.frameMs.p99.toFixed(2)}ms does not fit the ${FRAME_BUDGET_MS.toFixed(2)}ms budget`,
    )
  }
  if (report.overBudget.share > HITCH_CEILING) {
    failures.push(
      `${(report.overBudget.share * 100).toFixed(2)}% of frames missed the budget, over the ` +
        `${(HITCH_CEILING * 100).toFixed(1)}% ceiling`,
    )
  }

  if (!baseline) {
    notes.push('no baseline recorded yet — run `npm run perf -- --record`')
    return { failures, notes }
  }

  const sameWorkload =
    baseline.workload.ticks === report.workload.ticks &&
    baseline.workload.depth === report.workload.depth &&
    baseline.workload.monstersKilled === report.workload.monstersKilled
  const sameViewport =
    baseline.viewport.width === report.viewport.width &&
    baseline.viewport.height === report.viewport.height &&
    baseline.viewport.pixelRatio === report.viewport.pixelRatio

  if (!sameViewport) {
    notes.push(
      `viewport changed (${baseline.viewport.width}x${baseline.viewport.height} → ` +
        `${report.viewport.width}x${report.viewport.height}); fill rate is not comparable`,
    )
    return { failures, notes }
  }

  if (!sameWorkload) {
    // Gameplay moved, so a slower frame may be a bigger fight rather than slower code.
    notes.push(
      'the bot played a different run than the baseline ' +
        `(depth ${baseline.workload.depth}→${report.workload.depth}, ` +
        `kills ${baseline.workload.monstersKilled}→${report.workload.monstersKilled}). ` +
        'Timings are not comparable; re-record after checking the change was intended.',
    )
    return { failures, notes }
  }

  for (const [label, path] of [
    ['p99 frame', (r) => r.frameMs.p99],
    ['p95 frame', (r) => r.frameMs.p95],
    ['p50 frame', (r) => r.frameMs.p50],
  ]) {
    const before = path(baseline)
    const after = path(report)
    if (after > before * (1 + REGRESSION_TOLERANCE)) {
      failures.push(
        `${label} ${before.toFixed(2)}ms → ${after.toFixed(2)}ms ` +
          `(+${(((after - before) / before) * 100).toFixed(0)}%)`,
      )
    }
  }

  // Hitches ratchet: whatever the game does today, it may not start doing more of it.
  const hitchAllowance = Math.max(baseline.overBudget.share * 2, baseline.overBudget.share + 0.005)
  if (report.overBudget.share > hitchAllowance) {
    failures.push(
      `missed frames ${(baseline.overBudget.share * 100).toFixed(2)}% → ` +
        `${(report.overBudget.share * 100).toFixed(2)}% of frames`,
    )
  }

  for (const [label, path] of [
    ['draw calls', (r) => r.scene.drawCalls],
    ['triangles', (r) => r.scene.triangles],
  ]) {
    const before = path(baseline)
    const after = path(report)
    if (after > before * (1 + SCENE_TOLERANCE)) {
      failures.push(`${label} ${before} → ${after} (+${(((after - before) / before) * 100).toFixed(0)}%)`)
    }
  }

  return { failures, notes }
}

async function main() {
  await run('npm', ['run', 'assets'])
  await run('npx', ['vite', 'build', '--config', 'perf/vite.config.ts'])

  const preview = spawn(
    'npx',
    ['vite', 'preview', '--config', 'perf/vite.config.ts', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  )

  let report
  try {
    await waitForServer(`http://127.0.0.1:${PREVIEW_PORT}/`)
    report = await measure()
  } finally {
    preview.kill()
  }

  console.log(`\n${format(report)}\n`)

  const stamped = { ...report, machine: { cpu: cpus()[0]?.model ?? 'unknown', platform: process.platform } }

  if (record) {
    writeFileSync(BASELINE, `${JSON.stringify(stamped, null, 2)}\n`)
    console.log(`baseline recorded at perf/baseline.json (${stamped.machine.cpu})`)
    return
  }

  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null
  if (baseline?.machine && baseline.machine.cpu !== stamped.machine.cpu) {
    console.log(`note: baseline was recorded on ${baseline.machine.cpu}, this is ${stamped.machine.cpu}`)
  }

  const { failures, notes } = compare(report, baseline)
  for (const note of notes) console.log(`note: ${note}`)

  if (failures.length > 0) {
    console.error('\nFAIL')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  console.log('PASS — the frame fits in the 60fps budget')
}

await main()
