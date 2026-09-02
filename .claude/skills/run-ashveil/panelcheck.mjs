import { chromium } from 'playwright'
const OUT = process.env.OUT
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const errors = []
async function shot(name, viewport, steps = async () => {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 640, hasTouch: viewport.width < 640 })
  const page = await context.newPage()
  page.on('pageerror', (e) => { console.error('PAGEERROR', name, String(e)); errors.push(`${name}: ${e}`) })
  page.on('console', (m) => { if (m.type() === 'error') { console.error('CONSOLE', name, m.text()); errors.push(`${name}: ${m.text()}`) } })
  await page.goto('http://127.0.0.1:5277/', { waitUntil: 'load' })
  await page.waitForFunction(() => globalThis.motion != null, null, { timeout: 30000 })
  await page.waitForTimeout(2500)
  await steps(page)
  await page.waitForTimeout(900)
  const state = await page.evaluate(() => JSON.stringify({
    controlsHidden: document.getElementById('controls').hidden,
    readoutHidden: document.getElementById('readout').hidden,
    expanded: document.getElementById('panel-toggle').getAttribute('aria-expanded'),
    stored: (() => { try { return localStorage.getItem('ashveil.motion.panel') } catch { return 'blocked' } })(),
    summary: document.getElementById('summary').textContent,
  }))
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(name.padEnd(24), state)
  await context.close()
}
await shot('panel-phone-default', { width: 390, height: 780 })
await shot('panel-phone-open', { width: 390, height: 780 }, async (p) => p.click('#panel-toggle'))
await shot('panel-desktop-default', { width: 1280, height: 760 })
await shot('panel-desktop-closed', { width: 1280, height: 760 }, async (p) => p.click('#panel-toggle'))
if (errors.length) { console.error('ERRORS\n' + errors.join('\n')); process.exitCode = 1 }
await browser.close()
