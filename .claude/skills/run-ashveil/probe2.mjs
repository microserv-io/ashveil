import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage()
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)))
await page.goto('http://127.0.0.1:5277/', { waitUntil: 'load' })
await page.waitForFunction(() => globalThis.motion != null, null, { timeout: 30000 })
await page.waitForTimeout(1500)
console.log('before', await page.evaluate(() => JSON.stringify({
  distance: document.getElementById('distance')?.value,
  camera: globalThis.motion.host.camera.position.toArray().map((v) => +v.toFixed(2)),
})))
await page.evaluate(() => {
  const el = document.getElementById('distance'); el.value = '5'; el.dispatchEvent(new Event('input'))
  const p = document.getElementById('pitch'); p.value = '14'; p.dispatchEvent(new Event('input'))
})
await page.waitForTimeout(1200)
console.log('after ', await page.evaluate(() => JSON.stringify({
  distance: document.getElementById('distance')?.value,
  camera: globalThis.motion.host.camera.position.toArray().map((v) => +v.toFixed(2)),
  actor: [globalThis.motion.actor.pos.x, globalThis.motion.actor.pos.y].map((v) => +v.toFixed(2)),
})))
await browser.close()
