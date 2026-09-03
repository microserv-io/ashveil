import { chromium } from 'playwright'

const OUT = process.env.OUT ?? '/tmp'
const URL = process.env.URL ?? 'http://127.0.0.1:5277/'

const browser = await chromium.launch({
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction(() => document.querySelector('canvas') !== null, null, { timeout: 30000 })
await page.waitForTimeout(3000)

async function shot(name, { state, speed }) {
  await page.selectOption('#state', state)
  await page.evaluate((value) => {
    const input = document.getElementById('speed')
    input.value = String(value)
    input.dispatchEvent(new Event('input'))
  }, speed)
  await page.click('#recenter')
  await page.waitForTimeout(2200)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`wrote ${OUT}/${name}.png`)
}

await shot('procedural-walk', { state: 'moving', speed: 1.6 })
await shot('procedural-run', { state: 'moving', speed: 5.5 })
await shot('procedural-idle', { state: 'idle', speed: 0 })

if (errors.length) {
  console.error(`FAIL console errors:\n${errors.join('\n')}`)
  await browser.close()
  process.exit(1)
}
console.log('PASS no console errors')
await browser.close()
