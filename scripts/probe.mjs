import { chromium } from 'playwright'
const url = process.env.UI_URL ?? 'http://localhost:5180/'
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

console.log('--- buttons on screen ---')
console.log(JSON.stringify(await page.locator('button').allInnerTexts()).slice(0, 1500))

console.log('--- stores exposed ---')
console.log(await page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__'))))

console.log('--- app state ---')
console.log(JSON.stringify(await page.evaluate(() => {
  const s = window.__appStore?.getState?.()
  if (!s) return 'no __appStore'
  return {
    drawings: s.drawings.map((d) => ({ id: d.id, status: d.status, parsed: d.parsedWalls.length, user: d.parsedWalls.filter((w) => w.source === 'user').length, raster: [d.rasterWidth, d.rasterHeight], scale: d.scaleMmPerPx })),
    overlayDrawingId: s.floorplanOverlay.drawingId,
    overlayScale: s.floorplanOverlay.scale,
    placed: s.placedObjects.length,
    actions: ['addUserTracedWall', 'addUserTracedWalls', 'addPlacedObject'].filter((k) => typeof s[k] === 'function'),
  }
}), null, 2))
console.log('errors:', errors.slice(0, 5))
await ctx.close(); await browser.close()
