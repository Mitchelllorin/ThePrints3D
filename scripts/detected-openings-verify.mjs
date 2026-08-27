// Does the framing YOU LOOK AT respond to openings read off the print?
//
// The takeoff has always framed detected doors and windows — headers, kings,
// jacks and cripples all land in the material list. The rendered framing is
// built by a different path (LiveWallsLayer), and it read only PLACED objects,
// so a doorway off the drawing was cut into nothing and the studs ran straight
// through it. Two paths, one answer each, and the one you look at was wrong.
//
// This measures it the only way that can't lie: build the same print twice in
// one session — once with its openings, once with them stripped — and compare
// the mesh count and the height histogram. Openings pull full-height studs out
// (y≈1.2) and add headers (y≈2.2), cripples over (y≈2.4) and sill framing
// (y≈0.4). If the two runs come back identical, the render is ignoring them.
//
// Run: node scripts/detected-openings-verify.mjs   (dev server on 5180)
// Note the 127.0.0.1: Vite binds IPv4 only, and Chrome resolves localhost to
// ::1 first, so a headless driver hangs on "localhost".
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.UI_URL ?? 'http://127.0.0.1:5180/'
mkdirSync('ui-shots', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)

// Practice presets ship with their openings stripped, and the flag that governs
// that is presetMode on the UI-settings store — NOT the practiceMode field on
// the floorplan local store, which nothing reads.
await page.evaluate(() => window.__uiSettingsStore.getState().set({ presetMode: 'ready' }))
await page.waitForTimeout(500)

// The preset button is in the DOM twice; one copy lives in the retracted left
// drawer, off-screen. Click the one a thumb would actually reach.
const loc = page.getByRole('button', { name: /Two.Bed Bungalow/i })
for (let i = 0; i < await loc.count(); i++) {
  const b = await loc.nth(i).boundingBox()
  if (b && b.x >= 0 && b.y >= 0) { await loc.nth(i).click(); break }
}
await page.waitForFunction(() => (window.__appStore?.getState?.().drawings ?? []).length > 0, { timeout: 60000 })
await page.waitForTimeout(3000)

const census = () => page.evaluate(() => {
  const scene = window.__scene
  let meshes = 0
  const byY = {}
  scene?.traverse((o) => {
    if (!o.isMesh) return
    meshes++
    const p = new o.position.constructor()
    o.getWorldPosition(p)
    const k = (Math.round(p.y * 10) / 10).toFixed(1)
    byY[k] = (byY[k] ?? 0) + 1
  })
  const d = window.__appStore.getState().drawings[0]
  return {
    meshes,
    openings: d.parsedOpenings.length,
    walls: d.parsedWalls.length,
    meshesByHeight: Object.fromEntries(Object.entries(byY).sort((a, b) => Number(a[0]) - Number(b[0]))),
  }
})

await page.evaluate(async () => { await window.__appStore.getState().buildForMe() })
await page.waitForTimeout(6000)
const withOpenings = await census()
await page.screenshot({ path: 'ui-shots/openings-with.png' })

await page.evaluate(async () => {
  const st = window.__appStore
  st.setState((s) => { s.drawings.forEach((d) => { d.parsedOpenings = [] }) })
  await st.getState().buildForMe()
})
await page.waitForTimeout(6000)
const without = await census()
await page.screenshot({ path: 'ui-shots/openings-without.png' })
await browser.close()

console.log('WITH OPENINGS   :', JSON.stringify(withOpenings))
console.log('WITHOUT OPENINGS:', JSON.stringify(without))
const headers = withOpenings.meshesByHeight['2.2'] ?? 0
const same = withOpenings.meshes === without.meshes
console.log(`\nheaders rendered: ${headers}   mesh delta: ${withOpenings.meshes - without.meshes}`)
console.log(same || headers === 0
  ? 'FAIL — the rendered framing is ignoring openings read off the print.'
  : 'PASS — detected openings are framed in the model, not just in the takeoff.')
