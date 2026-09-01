import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = process.env.OUT
const SEQ = `${OUT}/seq`
rmSync(SEQ, { recursive: true, force: true })
mkdirSync(SEQ, { recursive: true })

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)))
await page.goto('http://127.0.0.1:5277/', { waitUntil: 'load' })
await page.waitForFunction(() => globalThis.motion != null, null, { timeout: 30000 })
await page.waitForTimeout(2000)

const set = async (id, value) => page.evaluate(([id, value]) => {
  const el = document.getElementById(id); el.value = String(value); el.dispatchEvent(new Event('input'))
}, [id, value])

await page.selectOption('#driver', process.env.DRIVER ?? 'procedural')
await page.selectOption('#state', 'moving')
await set('distance', 5)
await set('pitch', 14)
await set('speed', 1.6)
await page.click('#recenter')
await page.click('#panel-toggle')
await page.waitForTimeout(1200)

const FRAMES = Number(process.env.FRAMES ?? 84)
const INTERVAL = 80
const SWITCH = Math.floor(FRAMES / 2)
const started = Date.now()
for (let at = 0; at < FRAMES; at++) {
  if (at === SWITCH) await set('speed', 5.5)
  await page.screenshot({ path: `${SEQ}/f${String(at).padStart(3, '0')}.png` })
  const wait = started + (at + 1) * INTERVAL - Date.now()
  if (wait > 0) await page.waitForTimeout(wait)
}
console.log(`${FRAMES} frames over ${((Date.now() - started) / 1000).toFixed(1)}s`)
await browser.close()
