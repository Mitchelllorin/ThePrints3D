/**
 * screenshot-print-verify — what does the pipeline ACTUALLY get off a screenshot?
 *
 * Three complaints came off a real phone session with a screenshot of a plan:
 *
 *   1. "is it even looking for text" — the sheet said KITCHEN, BEDROOM in plain
 *      letters and nothing in the model knew it
 *   2. "same size wall interior and exterior" — every wall coming out one
 *      thickness, exterior maybe right, nothing consistent
 *   3. "still not recognising openings and framing them"
 *
 * All three are answerable with facts rather than opinion, because two real
 * screenshots of plans are already sitting in data/test-prints/. This runs the
 * SAME `processDrawing` the app runs over them and prints what came back: the
 * words, the scale and where it came from, the spread of wall thicknesses, and
 * the openings. No pass/fail — the numbers are the point.
 *
 * Run: node scripts/screenshot-print-verify.mjs      (dev server on 5180)
 */
import { chromium } from 'playwright'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const SHOTS = ['screenshot-adu-71sqm.png', 'screenshot-studio-1bed.png']

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)) })

await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 120000 })
await page.waitForTimeout(2000)

/**
 * Run the real pipeline on one screenshot. Imported through the dev server so
 * this is the app's own module graph, not a reimplementation of it.
 */
const run = `async (name) => {
  const t0 = performance.now()
  const { processDrawing } = await import('/src/services/drawingProcessor.ts')
  const res = await fetch('/data/test-prints/' + name)
  const blob = await res.blob()
  const file = new File([blob], name, { type: 'image/png' })
  const drawing = { id: 'diag-' + name, name, type: 'floor-plan', file, pageCount: 1, currentPage: 1,
    previewUrl: null, rasterUrl: null, rasterWidth: null, rasterHeight: null,
    parsedWalls: [], parsedRooms: [], parsedOpenings: [], parsedText: [], parsedSymbols: [],
    parsedAnnotationCandidates: [], parseProgress: 0, floorNumber: null, status: 'pending',
    scaleMmPerPx: null, scaleNotation: null, scaleConfidence: 'fallback' }
  let patch, err = null
  try { patch = await processDrawing(drawing, () => {}) } catch (e) { err = String(e && e.message || e); patch = {} }
  const walls = patch.parsedWalls || []
  const text = patch.parsedText || []
  const openings = patch.parsedOpenings || []

  // Thickness spread — the whole of complaint 2. If every wall lands in one
  // bucket the classifier has nothing to tell interior from exterior with.
  const mm = walls.map(w => Math.round(w.finishedMm || 0)).filter(Boolean).sort((a,b)=>a-b)
  const buckets = {}
  for (const v of mm) { const k = Math.round(v / 25) * 25; buckets[k] = (buckets[k]||0)+1 }
  const roles = {}
  for (const w of walls) { const k = w.wallType || w.wallRole || 'unset'; roles[k] = (roles[k]||0)+1 }

  return {
    ms: Math.round(performance.now() - t0),
    error: err,
    rasterPx: (patch.rasterWidth||0) + 'x' + (patch.rasterHeight||0),
    scale: patch.scaleMmPerPx ? patch.scaleMmPerPx.toFixed(3) + ' mm/px (' + patch.scaleConfidence + ')' : 'NONE',
    scaleNotation: patch.scaleNotation || '—',
    words: text.length,
    sampleWords: text.slice(0, 14).map(t => (t.text||'').trim()).filter(Boolean),
    rooms: (patch.parsedRooms||[]).length,
    walls: walls.length,
    thicknessMm: { min: mm[0] ?? null, max: mm[mm.length-1] ?? null, distinct: Object.keys(buckets).length, buckets },
    roles,
    openings: openings.length,
    openingKinds: openings.reduce((a,o)=>{a[o.type||'?']=(a[o.type||'?']||0)+1;return a},{}),
    symbols: (patch.parsedSymbols||[]).length,
  }
}`

for (const name of SHOTS) {
  console.log('\n' + '='.repeat(72))
  console.log(name)
  console.log('='.repeat(72))
  const r = await page.evaluate(`(${run})(${JSON.stringify(name)})`).catch((e) => ({ error: e.message }))
  if (r.error) console.log('ERROR:', r.error)
  console.log(`raster            ${r.rasterPx}        (${r.ms} ms)`)
  console.log(`scale             ${r.scale}   notation: ${r.scaleNotation}`)
  console.log(`WORDS READ        ${r.words}`)
  console.log(`  sample          ${JSON.stringify(r.sampleWords)}`)
  console.log(`rooms             ${r.rooms}`)
  console.log(`walls             ${r.walls}`)
  console.log(`  thickness mm    min ${r.thicknessMm?.min}  max ${r.thicknessMm?.max}  distinct buckets: ${r.thicknessMm?.distinct}`)
  console.log(`  spread          ${JSON.stringify(r.thicknessMm?.buckets)}`)
  console.log(`  classified as   ${JSON.stringify(r.roles)}`)
  console.log(`OPENINGS          ${r.openings}  ${JSON.stringify(r.openingKinds)}`)
  console.log(`symbols           ${r.symbols}`)
}

console.log('\n=== ERRORS ===')
console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)')
await browser.close()
