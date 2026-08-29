// Does a doorway READ OFF THE PRINT get framed, and do wide doors come as a pair?
//
// Three things this measures, none of which a unit test can see because they
// only exist once the scene has been built:
//   1. headers/kings/jacks/cripples over DETECTED openings (not just placed ones)
//   2. a wide door rendering as two leaves rather than one slab
//   3. plan symbols (the floor marks) going away once the model is standing
// Run: node scripts/opening-framing-verify.mjs      (dev server on 5180)
import { chromium } from 'playwright'

const url = process.env.UI_URL ?? 'http://localhost:5180/'
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3000)

// Practice presets carry no openings on purpose, so turn practice OFF first —
// this diagnostic is precisely about openings that came off the drawing.
await page.evaluate(() => window.__floorplanLocalStore?.getState?.().setPracticeMode?.(false))
for (const b of await page.getByRole('button', { name: 'Easy Starter Cottage', exact: true }).all()) {
  await b.dispatchEvent('click').catch(() => {})
}
await page.waitForFunction(() => (window.__appStore?.getState?.().drawings ?? []).length > 0, { timeout: 30000 })
await page.waitForTimeout(2500)

// Build, so there is framing to inspect at all.
await page.evaluate(() => window.__appStore.getState().buildForMe?.())
await page.waitForTimeout(4000)

const report = await page.evaluate(() => {
  const s = window.__appStore.getState()
  const scene = window.__scene
  const counts = {}
  let meshes = 0
  scene?.traverse?.((o) => {
    if (!o.isMesh) return
    meshes++
    const info = o.userData?.info ?? o.parent?.userData?.info ?? ''
    if (!info) return
    const key = String(info).split('·')[0].trim()
    counts[key] = (counts[key] ?? 0) + 1
  })
  const detected = s.drawings.flatMap((d) => d.parsedOpenings)
  return {
    modelStatus: s.model.status,
    printVisible: s.floorplanOverlay.visible,
    detectedOpenings: detected.length,
    detectedDoors: detected.filter((o) => o.type === 'door').length,
    detectedWindows: detected.filter((o) => o.type === 'window').length,
    detectedWidthsMm: detected.map((o) => o.widthMm).slice(0, 12),
    placedObjects: s.placedObjects.length,
    placedOpenings: s.placedObjects.filter((o) => o.type === 'door' || o.type === 'window').length,
    totalMeshes: meshes,
    framingKinds: Object.fromEntries(
      Object.entries(counts).filter(([k]) => /head|king|jack|cripple|sill|stud|trimmer|plate/i.test(k)),
    ),
  }
})

console.log(JSON.stringify(report, null, 2))
console.log('errors:', errors.slice(0, 6))
await browser.close()
