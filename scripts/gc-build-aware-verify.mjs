/**
 * gc-build-aware-verify — does the G.C. actually look at the MODEL?
 *
 * The unit tests prove the decision tree picks the right branch. They cannot
 * prove the bubble opens its mouth, that the context assembled from four store
 * slices maps onto the branch anyone intended, or that the button does the thing
 * it says. So this stands a model up in the real app, breaks it four different
 * ways, and prints what the G.C. says about each.
 *
 * Run: node scripts/gc-build-aware-verify.mjs      (dev server on 5180)
 */
import { chromium } from 'playwright'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const browser = await chromium.launch({ timeout: 60000 })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 120000 })
await page.waitForTimeout(2500)

/**
 * Stand a model up, then set exactly what this scenario has on each storey.
 * Walls are user-traced so the G.C. treats them as real, and the drawing is
 * calibrated + handled so the walk is not gated behind the scale question.
 */
const scene = `(opts) => {
  const SCALE = 5
  const wall = (lv, x) => ({ x1: x, y1: 0, x2: x, y2: 400, thickness: 12, source: 'user', level: lv, detectionConfidence: 0.9 })
  const area = (lv, i) => ({ id: 'a' + lv + '-' + i, x1: 0, y1: 0, x2: 400, y2: 400,
    elementType: 'joist', size: '16', material: 'wood', level: lv })
  const walls = [], floors = [], roofs = []
  for (const s of opts.storeys) {
    for (let i = 0; i < s.walls; i++) walls.push(wall(s.level, 10 + i * 10))
    for (let i = 0; i < s.floors; i++) floors.push(area(s.level, i))
    for (let i = 0; i < s.roofs; i++) roofs.push({ ...area(s.level, i), id: 'r' + s.level + '-' + i, elementType: 'gable', size: '6' })
  }
  const openings = []
  for (let i = 0; i < (opts.doors || 0); i++) {
    openings.push({ x: 50 + i * 40, y: 0, widthPx: 18, widthMm: 900, type: 'door', orientation: 'horizontal', confidence: 0.9 })
  }
  const st = window.__appStore.getState()
  const id = 'd-fixed'
  window.__appStore.setState({
    drawings: [{ id, name: 'plan.pdf', type: 'floor_plan', status: 'ready', file: null, rasterUrl: null,
      parsedWalls: walls, parsedRooms: [], parsedOpenings: openings, parsedText: [], parsedSymbols: [],
      parsedAnnotationCandidates: [], parseProgress: 100, scaleMmPerPx: SCALE, scaleConfidence: 'measured',
      uploadedAt: Date.now() }],
    selectedDrawingId: id,
    floorsAreas: floors,
    roofAreas: roofs,
    placedObjects: [],
    corrections: [],
    model: { ...st.model, status: 'ready' },
    floorplanOverlay: { ...st.floorplanOverlay, drawingId: id, calibrationMode: false },
  })
  window.__floorplanLocalStore.setState({
    tutorialActive: false, buildDrawerOpen: false, askDrawerOpen: false, settingsDrawerOpen: false,
    placeDrawerOpen: false, activePanel: null, traceMode: false, calibrationHandledIds: [id],
  })
}`

const bubble = () => page.evaluate(() => {
  const el = document.querySelector('[role="status"]')
  if (!el) return '(silent)'
  const btn = [...el.querySelectorAll('button')].map((b) => b.innerText.trim()).filter((t) => t && t !== '✕')
  return el.innerText.split('\n')[0].trim() + (btn.length ? `   [${btn.join('] [')}]` : '   (no button)')
})

const cases = [
  ['walls on level 2 with no deck under them',
   { storeys: [{ level: 0, walls: 8, floors: 1, roofs: 1 }, { level: 1, walls: 6, floors: 0, roofs: 0 }], doors: 1 }],
  ['level 2 deck down, nothing standing on it',
   { storeys: [{ level: 0, walls: 8, floors: 1, roofs: 1 }, { level: 1, walls: 0, floors: 1, roofs: 0 }], doors: 1 }],
  ['walls up, open to the sky',
   { storeys: [{ level: 0, walls: 8, floors: 1, roofs: 0 }], doors: 1 }],
  ['shell closed, no door in it',
   { storeys: [{ level: 0, walls: 8, floors: 1, roofs: 1 }], doors: 0 }],
  ['nothing wrong with it',
   { storeys: [{ level: 0, walls: 8, floors: 1, roofs: 1 }], doors: 2 }],
]

console.log('=== WHAT THE G.C. SAYS ABOUT THE MODEL ===\n')
for (const [label, opts] of cases) {
  await page.evaluate(`(${scene})(${JSON.stringify(opts)})`)
  await page.waitForTimeout(1500)
  const diag = await page.evaluate(() => {
    const a = window.__appStore.getState()
    const nodes = [...document.querySelectorAll('[role="status"]')].map((n) => n.innerText.split(String.fromCharCode(10))[0])
    return { walls: a.drawings[0]?.parsedWalls.map(w => w.level).join(''), floors: a.floorsAreas.map(f => f.level).join(''),
      roofs: a.roofAreas.map(r => r.level).join(''), openings: a.drawings[0]?.parsedOpenings.length, nodes }
  })
  console.log(label.padEnd(44) + '→ ' + (await bubble()))
  console.log('    store: walls@' + diag.walls + ' floors@' + diag.floors + ' roofs@' + diag.roofs + ' doors=' + diag.openings)
}

// The button has to do the thing it offers, not just say it.
console.log('\n=== DOES THE BUTTON WORK ===')
await page.evaluate(`(${scene})(${JSON.stringify({ storeys: [{ level: 0, walls: 8, floors: 1, roofs: 0 }], doors: 1 })})`)
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /Pull a roof/i }).first().click({ timeout: 5000 }).catch((e) => console.log('click failed:', e.message))
await page.waitForTimeout(900)
console.log('after "Pull a roof":', await page.evaluate(() => {
  const s = window.__floorplanLocalStore.getState()
  return `activeTraceLayer=${s.activeTraceLayer}  activePanel=${s.activePanel}`
}))

await page.evaluate(`(${scene})(${JSON.stringify({ storeys: [{ level: 0, walls: 8, floors: 1, roofs: 1 }], doors: 0 })})`)
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /Place a door/i }).first().click({ timeout: 5000 }).catch((e) => console.log('click failed:', e.message))
await page.waitForTimeout(900)
console.log('after "Place a door":', await page.evaluate(() => `placeDrawerOpen=${window.__floorplanLocalStore.getState().placeDrawerOpen}`))

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
