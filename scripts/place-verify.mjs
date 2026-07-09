// Diagnose object placement: load a preset, arm a placement, click the canvas,
// and report whether placedObjects grew + any console/page errors.
// Run: node scripts/place-verify.mjs   (dev server on 5173)
import { chromium } from 'playwright'

const url = process.env.UI_URL ?? 'http://localhost:5173/'
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3500)
await page.getByRole('button', { name: /Easy Starter Cottage/i }).first().dispatchEvent('click').catch((e) => errors.push('preset: ' + e.message))
await page.waitForTimeout(4500)

// Arm a placement directly on the loaded print (no build — matches how the user
// places: pick from the tray, tap the plan).
const armed = await page.evaluate(() => {
  const local = window.__floorplanLocalStore.getState()
  const before = window.__appStore.getState().placedObjects.length
  local.setPlaceObjectType?.('device-box')
  return { before, placeType: window.__floorplanLocalStore.getState().placeObjectType, hasSetter: typeof local.setPlaceObjectType }
})
await page.waitForTimeout(1000)

// Click the centre of the canvas (where the plan sits) to place.
const box = await page.locator('canvas').first().boundingBox()
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(60)
  await page.mouse.up()
}
await page.waitForTimeout(800)

const after = await page.evaluate(() => {
  const s = window.__appStore.getState()
  return {
    placed: s.placedObjects.length,
    last: s.placedObjects[s.placedObjects.length - 1] ?? null,
    stillArmed: window.__floorplanLocalStore.getState().placeObjectType,
  }
})

console.log('armed:', JSON.stringify(armed))
console.log('after click:', JSON.stringify(after))

// Isolate: does a DIRECT store add render? (store/render vs click path)
const direct = await page.evaluate(() => {
  const s = window.__appStore.getState()
  s.addPlacedObject?.({ id: 'diag-1', type: 'chair', x: 0, z: 0, rotationY: 0, scaleX: 1, scaleZ: 1, scaleY: 1, label: 'Chair' })
  return window.__appStore.getState().placedObjects.length
})
console.log('after direct addPlacedObject:', direct)
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none')
console.log(after.placed > armed.before ? 'RESULT: CLICK PLACED OK' : 'RESULT: CLICK PLACED NOTHING')
console.log(direct > 0 ? 'RESULT: STORE ADD OK' : 'RESULT: STORE ADD FAILED')

await ctx.close()
await browser.close()
