import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage()
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)))
await page.goto('http://127.0.0.1:5277/', { waitUntil: 'load' })
await page.waitForFunction(() => globalThis.motion?.view != null, null, { timeout: 30000 })
await page.waitForTimeout(2000)
console.log(await page.evaluate(() => {
  const m = globalThis.motion
  const model = m.view.group.children[0]
  const bones = []
  model.traverse((c) => { if (c.isBone) bones.push(c) })
  const named = {}
  for (const b of bones.slice(0, 60)) named[b.name] = 1
  const world = (name) => {
    const b = bones.find((x) => x.name === name)
    if (!b) return null
    const v = new b.position.constructor()
    b.getWorldPosition(v)
    return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]
  }
  return JSON.stringify({
    boneCount: bones.length,
    boneNames: Object.keys(named).slice(0, 45),
    groupPos: m.view.group.position.toArray().map((v) => +v.toFixed(3)),
    groupRot: [m.view.group.rotation.x, m.view.group.rotation.y, m.view.group.rotation.z].map((v) => +v.toFixed(3)),
    modelScale: model.scale.toArray(),
    modelRot: [model.rotation.x, model.rotation.y, model.rotation.z].map((v) => +v.toFixed(3)),
    modelChildren: model.children.map((c) => `${c.type}:${c.name}`),
    head: world('head'), hips: world('hips'), footl: world('footl'), rootBone: world('root'),
  }, null, 2)
}))
await browser.close()
