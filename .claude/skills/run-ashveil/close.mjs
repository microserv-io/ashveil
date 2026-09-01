import { chromium } from 'playwright'
const OUT = process.env.OUT
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto('http://127.0.0.1:5277/', { waitUntil: 'load' })
await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 30000 })
await page.waitForTimeout(2500)
const set = async (id, value) => page.evaluate(([id, value]) => {
  const el = document.getElementById(id); el.value = String(value); el.dispatchEvent(new Event('input'))
}, [id, value])
await set('distance', 4.5)
await set('pitch', 16)
for (const [driver, state, speed, name] of JSON.parse(process.env.SHOTS)) {
  await page.selectOption('#driver', driver)
  await page.selectOption('#state', state)
  await set('speed', speed)
  await page.click('#recenter')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(name)
}
if (errors.length) console.error('ERRORS\n' + errors.join('\n'))
await browser.close()
