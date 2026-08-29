/**
 * corpus-keep-verify — is the corpus keeping the pertinent half and shedding the
 * rest, and can the user actually SEE what is kept?
 *
 * Two claims, neither of which a unit test can reach (there is no IndexedDB and
 * no canvas in the node runner):
 *
 *   1. a full-size detection raster is stored cut down to reading size, and the
 *      correction coordinate space (width/height) is NOT cut down with it
 *   2. Settings → "What this app keeps" states the counts, and Forget everything
 *      actually empties the database
 *
 * Run: node scripts/corpus-keep-verify.mjs        (dev server on 5180)
 */
import { chromium } from 'playwright'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const browser = await chromium.launch({ timeout: 60000 })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

/**
 * Seed a print with a REAL raster at real detection size — 3900x2600 is roughly
 * what RASTER_SCALE 1.5 produces from a 36x24" sheet. Line art on white, because
 * that is what compresses (and what resamples) like a drawing.
 */
const seed = `async () => {
  const W = 3900, H = 2600
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  g.strokeStyle = '#111'; g.lineWidth = 6
  for (let i = 0; i < 40; i++) {
    g.strokeRect(80 + i * 44, 80 + i * 30, W - 300 - i * 80, H - 300 - i * 55)
  }
  const raster = await new Promise((r) => c.toBlob(r, 'image/png'))
  const rasterUrl = URL.createObjectURL(raster)
  // A "source file" of a few megabytes, the way a real PDF arrives.
  const file = new File([new Uint8Array(3 * 1024 * 1024)], 'ground-floor.pdf', { type: 'application/pdf' })

  const SCALE = 5
  const t = (mm) => mm / (SCALE * 2)
  const wall = (mm, x) => ({ x1: x, y1: 0, x2: x, y2: 400, thickness: t(mm), source: 'auto', detectionConfidence: 0.8, finishedMm: t(mm) * SCALE })
  const type = (id,name,mm,usage)=>({id,name,thicknessMm:mm,layers:[],loadBearing:false,usage,markupTag:id,color:'#94a3b8'})
  const EXT=type('EXT','Exterior',250,'exterior'),INT=type('INT','Interior',120,'interior'),PT=type('PT','Partition',75,'partition')
  const walls=[wall(250,10),wall(120,20),wall(75,30)]
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
  return { rasterBytesIn: raster.size, sourceBytesIn: file.size, W, H }
}`

/** Read the corpus straight out of IndexedDB — no app code in the way. */
const readCorpus = `async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('theprints3d-corpus')
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const all = (store) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly').objectStore(store).getAll()
    tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error)
  })
  const sheets = await all('sheets')
  return {
    count: sheets.length,
    corrections: (await all('corrections')).length,
    sheets: sheets.map(s => ({
      name: s.name, seenCount: s.seenCount,
      measuredAt: s.width + 'x' + s.height,
      storedAt: s.rasterWidth ? s.rasterWidth + 'x' + s.rasterHeight : '(none)',
      rasterBytes: s.raster ? s.raster.size : 0,
      sourceBytes: s.source ? s.source.size : 0,
    })),
  }
}`

await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
// A cold dev server compiles on first request; wait for the store, not the clock.
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 120000 })
await page.waitForTimeout(1500)
// A clean database, so the numbers below are this run's.
await page.evaluate(() => indexedDB.deleteDatabase('theprints3d-corpus'))
await page.waitForTimeout(500)

const seeded = await page.evaluate('(' + seed + ')()')
await page.waitForTimeout(2500)
await page.evaluate(() => {
  const a = window.__appStore.getState()
  a.correctElement('10,0', 'EXT'); a.correctElement('20,0', 'INT')
})
await page.waitForTimeout(2500)

console.log('=== WHAT CAME IN ===')
console.log(`raster handed over: ${(seeded.rasterBytesIn / 1024 / 1024).toFixed(2)} MB at ${seeded.W}x${seeded.H}`)
console.log(`source handed over: ${(seeded.sourceBytesIn / 1024 / 1024).toFixed(2)} MB`)

const stored = await page.evaluate('(' + readCorpus + ')()')
console.log('\n=== WHAT GOT KEPT ===')
console.log(JSON.stringify(stored, null, 2))
const s0 = stored.sheets[0]
if (s0) {
  const cut = 1 - s0.rasterBytes / seeded.rasterBytesIn
  console.log(`\nraster cut by ${(cut * 100).toFixed(1)}%  (${(s0.rasterBytes / 1024 / 1024).toFixed(2)} MB kept)`)
  console.log(`coordinate space still ${s0.measuredAt} — corrections keep meaning what they meant: ${s0.measuredAt === seeded.W + 'x' + seeded.H ? 'YES' : 'NO'}`)
}

// ── the surface ──
await page.evaluate(() => window.__floorplanLocalStore.setState({ settingsDrawerOpen: true }))
await page.waitForTimeout(900)
const header = page.getByRole('button', { name: /What this app keeps/i }).first()
console.log('\n=== THE PANEL ===')
console.log('section visible in Settings:', await header.isVisible().catch(() => false))
await header.click({ timeout: 5000 }).catch((e) => console.log('click failed:', e.message))
await page.waitForTimeout(1500)
console.log('reads:\n' + (await page.evaluate(() => {
  const h = [...document.querySelectorAll('button')].find((b) => /What this app keeps/i.test(b.textContent || ''))
  const body = h?.parentElement
  return body ? body.innerText : '(section not found)'
})))

// ── forget everything: two taps, then the database is empty ──
const forget = page.getByRole('button', { name: /Forget everything/i }).first()
await forget.click({ timeout: 5000 }).catch((e) => console.log('forget click failed:', e.message))
await page.waitForTimeout(400)
console.log('\nafter one tap the button says:', await page.getByRole('button', { name: /Forget everything|erase it all/i }).first().innerText().catch(() => '(gone)'))
await page.getByRole('button', { name: /erase it all/i }).first().click({ timeout: 5000 }).catch((e) => console.log('confirm failed:', e.message))
await page.waitForTimeout(1500)
console.log('corpus after erasing:', JSON.stringify(await page.evaluate('(' + readCorpus + ')()')))

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
