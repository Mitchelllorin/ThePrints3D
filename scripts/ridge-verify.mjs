// Verifies the roof ridge flow (Stage 1): inject a roof area, select it so the
// ridge handle renders, exercise setRoofRidge, and confirm no runtime errors and
// the pitch override sticks. Run: node scripts/ridge-verify.mjs  (dev server on 5180)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.UI_URL ?? 'http://localhost:5180/'
mkdirSync('ui-shots', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => { errors.push(e.message); console.log(`[pageerror] ${e.message}`) })
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text()}`) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

// Load the easy preset so there's a drawing + overlay to seat the roof on.
await page.getByRole('button', { name: /Easy Starter Cottage/i }).first().dispatchEvent('click').catch((e) => console.log('preset err:', e.message))
await page.waitForTimeout(4000)

// Inject a roof area covering the middle of the print, make 'roof' layer visible,
// and select it (so the ridge handle renders).
const injected = await page.evaluate(() => {
  const store = window.__appStore, local = window.__floorplanLocalStore
  if (!store || !local) return { ok: false, why: 'stores not exposed' }
  const st = store.getState()
  const d = st.drawings[0]
  if (!d) return { ok: false, why: 'no drawing after preset' }
  const w = d.rasterWidth ?? 1400, h = d.rasterHeight ?? 900
  const id = 'ridge-test-roof'
  st.addRoofAreas([{ id, x1: w * 0.25, y1: h * 0.25, x2: w * 0.75, y2: h * 0.75, elementType: 'gable', size: '6:12', material: 'Asphalt Shingle', level: 0 }])
  // ensure the roof layer is visible
  const s2 = store.getState()
  if (s2.visibleLayers && !s2.visibleLayers.has('roof') && s2.toggleTradeLayerVisible) s2.toggleTradeLayerVisible('roof')
  local.getState().selectAreaExclusive('roof', id)
  return { ok: true, w, h, pitch0: store.getState().roofAreas.find((a) => a.id === id)?.ridge?.pitch ?? null }
})
console.log('inject:', JSON.stringify(injected))
await page.waitForTimeout(1500)
await page.screenshot({ path: 'ui-shots/ridge-handle.png' })

// Exercise the commit path (what the drag does on release).
const after = await page.evaluate(() => {
  const store = window.__appStore
  store.getState().setRoofRidge('ridge-test-roof', { pitch: 1.0 })
  return store.getState().roofAreas.find((a) => a.id === 'ridge-test-roof')?.ridge?.pitch ?? null
})
await page.waitForTimeout(1200)
await page.screenshot({ path: 'ui-shots/ridge-steep.png' })
console.log('pitch after setRoofRidge(1.0):', after)

console.log('pageerrors:', errors.length)
console.log(errors.length === 0 && after === 1.0 && injected.ok ? 'RESULT: PASS' : 'RESULT: FAIL')

await ctx.close()
await browser.close()
