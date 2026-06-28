import { chromium } from 'playwright'
const url = 'http://localhost:5180/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message) })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
await page.getByRole('button', { name: /Easy Starter Cottage/i }).first().dispatchEvent('click').catch(() => {})
await page.waitForTimeout(4000)

// Lay a floor + roof, then build so the Edit toggle appears.
await page.evaluate(() => {
  const st = window.__appStore.getState(); const d = st.drawings[0]
  const w = d.rasterWidth ?? 1200, h = d.rasterHeight ?? 900
  st.addFloorsAreas?.([{ id: 'f1', x1: w*0.3, y1: h*0.3, x2: w*0.7, y2: h*0.7, elementType: 'I-Joist', size: '16', material: 'Engineered', level: 0 }])
  st.addRoofAreas([{ id: 'r1', x1: w*0.28, y1: h*0.28, x2: w*0.72, y2: h*0.72, elementType: 'gable', size: '6:12', material: 'Asphalt Shingle', level: 0 }])
  const s2 = window.__appStore.getState()
  for (const L of ['floors','roof']) if (s2.visibleLayers && !s2.visibleLayers.has(L)) s2.toggleTradeLayerVisible(L)
  s2.buildForMe?.()
  if (s2.closeAllPanels) window.__floorplanLocalStore.getState().closeAllPanels()
})
await page.waitForTimeout(3500)
const editBtn = page.getByRole('button', { name: /Edit/i })
console.log('Edit toggle visible:', await editBtn.count().catch(() => 0))
await page.screenshot({ path: 'ui-shots/edit-1-built.png' })

// Enter edit mode + hover a floor → cyan highlight.
await page.evaluate(() => {
  const fp = window.__floorplanLocalStore.getState()
  fp.setEditMode(true)
  fp.setEditHover({ kind: 'floor', id: 'f1' })
})
await page.waitForTimeout(900)
await page.screenshot({ path: 'ui-shots/edit-2-hover-floor.png' })
console.log('editMode:', await page.evaluate(() => window.__floorplanLocalStore.getState().editMode))

// Select a roof → amber highlight + ridge handle.
await page.evaluate(() => {
  const fp = window.__floorplanLocalStore.getState()
  fp.setEditHover(null); fp.setEditSelected({ kind: 'roof', id: 'r1' })
})
await page.waitForTimeout(900)
await page.screenshot({ path: 'ui-shots/edit-3-select-roof.png' })

// Move the floor via the underlying action (what the body-drag commits).
await page.evaluate(() => window.__appStore.getState().translateFloorsArea('f1', 120, 0))
await page.waitForTimeout(700)
await page.screenshot({ path: 'ui-shots/edit-4-moved-floor.png' })

// Exit edit mode → everything unlocks.
await page.evaluate(() => window.__floorplanLocalStore.getState().setEditMode(false))
await page.waitForTimeout(500)
console.log('after exit editMode:', await page.evaluate(() => window.__floorplanLocalStore.getState().editMode))
console.log('pageerrors:', errors.length)
console.log(errors.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL')
await ctx.close(); await browser.close()
