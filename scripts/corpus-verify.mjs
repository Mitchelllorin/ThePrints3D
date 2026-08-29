/**
 * corpus-verify — upload a print, teach it, close the app, come back.
 *
 * The claim the corpus makes is that a print is remembered by its own pixels:
 * open the same sheet again and the corrections you made on it last time are
 * already there, and the G.C. already knows what it got wrong. That claim can
 * only be checked across a real page reload against real IndexedDB, which is
 * what this does.
 */
import { chromium } from 'playwright'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const browser = await chromium.launch({ timeout: 60000 })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

/** Seed the SAME sheet every time: fixed bytes in, so the same hash out. */
const seed = `() => {
  const SCALE = 5
  const t = (mm) => mm / (SCALE * 2)
  const wall = (mm, x) => ({ x1: x, y1: 0, x2: x, y2: 400, thickness: t(mm), source: 'auto', detectionConfidence: 0.8, finishedMm: t(mm) * SCALE })
  const type = (id,name,mm,usage)=>({id,name,thicknessMm:mm,layers:[],loadBearing:false,usage,markupTag:id,color:'#94a3b8'})
  const EXT=type('EXT','Exterior',250,'exterior'),INT=type('INT','Interior',120,'interior'),PT=type('PT','Partition',75,'partition')
  const walls=[wall(250,10),wall(120,20),wall(75,30)]
  const raster = new Blob([new Uint8Array(Array.from({length: 4096}, (_, i) => (i * 37) % 251))], { type: 'image/png' })
  const rasterUrl = URL.createObjectURL(raster)
  const file = new File([raster], 'ground-floor.pdf', { type: 'application/pdf' })
  const st = window.__appStore.getState()
  window.__appStore.setState({
    drawings: [{ id: 'd' + Date.now(), name: 'ground-floor.pdf', type: 'floor_plan', status: 'ready',
      file, rasterUrl, parsedWalls: walls, parsedRooms: [], parsedOpenings: [], parsedText: [],
      parsedSymbols: [], parsedAnnotationCandidates: [], parseProgress: 100,
      scaleMmPerPx: SCALE, scaleConfidence: 'inferred', uploadedAt: Date.now() }],
    detectedWallTypes: walls.map(w => ({ wallId: w.x1 + ',' + w.y1, wallType: PT, confidence: 0.8, fromSeed: false })),
    projectWallTypes: [EXT, INT, PT],
  })
  const id = window.__appStore.getState().drawings[0].id
  window.__appStore.setState({ selectedDrawingId: id, floorplanOverlay: { ...st.floorplanOverlay, drawingId: id, calibrationMode: false } })
  window.__floorplanLocalStore.setState({ tutorialActive: false, buildDrawerOpen: false, askDrawerOpen: false, settingsDrawerOpen: false, activePanel: null, traceMode: false })
  return id
}`

/** Read the corpus straight out of IndexedDB — no app code in the way. */
const readCorpus = `async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('theprints3d-corpus')
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const db = await open()
  const all = (store) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly').objectStore(store).getAll()
    tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error)
  })
  const sheets = await all('sheets')
  const corrections = await all('corrections')
  return {
    sheets: sheets.map(s => ({ id: s.id, name: s.name, seenCount: s.seenCount,
      rasterBytes: s.raster ? s.raster.size : 0, sourceBytes: s.source ? s.source.size : 0,
      read: s.read,
      detected: s.detected ? { walls: s.detected.walls.length, rooms: s.detected.rooms.length,
        openings: s.detected.openings.length, symbols: s.detected.symbols.length, text: s.detected.text.length } : null })),
    corrections: corrections.map(c => ({ id: c.id, kind: c.kind, predicted: c.predicted, actual: c.actual, px: c.evidence && c.evidence.thicknessPx })),
  }
}`

const bubble = () => page.evaluate(() => {
  const el = document.querySelector('[role="status"]')
  return el ? el.innerText.split(String.fromCharCode(10)).join(' | ') : '(no bubble)'
})

// ── VISIT 1: see the print for the first time, and correct three walls ──
await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
await page.waitForTimeout(5000)
await page.evaluate('(' + seed + ')()')
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const a = window.__appStore.getState()
  a.correctElement('10,0', 'EXT'); a.correctElement('20,0', 'INT'); a.correctElement('30,0', 'PT')
})
await page.waitForTimeout(3000)

console.log('=== VISIT 1 ===')
console.log('in-session corrections:', await page.evaluate(() => window.__appStore.getState().corrections.length))
console.log('bubble:', await bubble())
console.log('corpus:', JSON.stringify(await page.evaluate('(' + readCorpus + ')()'), null, 2))

// ── VISIT 2: close the app entirely, open the same print again ──
await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
await page.waitForTimeout(5000)
console.log('\n=== VISIT 2 (fresh page, nothing corrected yet) ===')
console.log('corrections before opening the print:', await page.evaluate(() => window.__appStore.getState().corrections.length))
await page.evaluate('(' + seed + ')()')
await page.waitForTimeout(3500)
console.log('corrections after opening the SAME print:', await page.evaluate(() => window.__appStore.getState().corrections.length))
console.log('lesson without a single new tap:', await page.evaluate(() => {
  const l = window.__appStore.getState().correctionLessons()[0]
  return l ? l.id + ' / ' + l.actionLabel : '(none)'
}))
console.log('bubble @3.5s:', await bubble())
await page.waitForTimeout(4000)
console.log('bubble @7.5s:', await bubble())
// Poke an unrelated slice the bubble subscribes to. If the words change now,
// the G.C. simply never re-rendered when the corrections arrived.
await page.evaluate(() => { const st = window.__appStore.getState(); window.__appStore.setState({ floorplanOverlay: { ...st.floorplanOverlay } }) })
await page.waitForTimeout(1500)
console.log('bubble after a poke:', await bubble())
const after = await page.evaluate('(' + readCorpus + ')()')
console.log('corpus sheets:', after.sheets.length, '| seenCount:', after.sheets.map(s => s.seenCount).join(','), '| corrections:', after.corrections.length)

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
