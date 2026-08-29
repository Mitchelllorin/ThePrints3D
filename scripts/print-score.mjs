/**
 * print-score — grade the engine against what the architect printed on the sheet.
 *
 * THE PROBLEM THIS FIXES. Everything else in scripts/ scores the engine on
 * drawings we made: coverage-verify and autobuild-verify run the three practice
 * presets, and the wall model's IoU of 0.783 was measured on synthetic plans we
 * generated ourselves. Those numbers are useful for catching regressions and
 * they are worth nothing in a room with a builder in it, because we wrote both
 * the question and the answer.
 *
 * So this grades against the DRAWING'S OWN PRINTED NUMBERS. A permit set states
 * its scale in the title block, its overall size on the dimension strings, its
 * room sizes in the room labels, and its openings in the door and window
 * schedules. Those are the architect's claims, not ours, and anyone can check
 * them against the sheet with a straightedge. data/test-prints/truth.json is
 * nothing but a transcription of them.
 *
 * WHAT IT REPORTS, and why each line is the one a builder would ask for:
 *
 *   SHEET      did it even open the right page? A ten-page set has one floor
 *              plan, and scoring the foundation detail as though it were the
 *              plan hides every other failure behind a wall count.
 *   SIZE       the building's overall dimensions in feet against the ones on
 *              the dimension string. This is the number that matters: get it
 *              wrong and every quantity in the takeoff is wrong by the same
 *              factor, and it is the one number a builder can check in a
 *              second. It grades scale and footprint together, because being
 *              right about the building is what "the scale is right" means.
 *   ROOMS      how many of the named rooms it found, by name.
 *   OPENINGS   against the schedule count, where the sheet has one.
 *   WALLS      what it found and how it typed them.
 *
 * NO GRADE IS INVENTED. Where the sheet does not state something the key holds
 * null and that line reads "not stated" rather than being scored against a
 * number we made up. A harness that flatters the engine is worse than none,
 * because it is the one that lets us say something in a pitch that is not true.
 *
 * Run: node scripts/print-score.mjs                 (dev server on 5180)
 *      SHEET=bungalow-ukiah-adu.pdf node scripts/print-score.mjs
 *      JSON=1 node scripts/print-score.mjs > baseline.json
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const truth = JSON.parse(fs.readFileSync('data/test-prints/truth.json', 'utf8'))
const sheets = process.env.SHEET
  ? truth.sheets.filter((s) => s.file === process.env.SHEET)
  : truth.sheets
if (sheets.length === 0) throw new Error(`no sheet matching SHEET=${process.env.SHEET}`)

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
// A cold dev server transforms the whole module graph before the app exists —
// measured at ninety seconds — so this waits far longer than it looks like it should.
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 240000 })
await page.waitForTimeout(1000)

/**
 * The REAL pipeline, entered the way an upload enters it: a File, and nothing
 * else. No page override, no seeded scale, no pre-parsed anything — if the app
 * needs to pick the sheet and read the scale off it, then that is part of what
 * is being graded.
 */
const run = `async (name) => {
  const t0 = performance.now()
  const { processDrawing } = await import('/src/services/drawingProcessor.ts')
  const res = await fetch('/data/test-prints/' + name)
  const blob = await res.blob()
  const type = name.endsWith('.pdf') ? 'application/pdf' : 'image/png'
  const file = new File([blob], name, { type })
  const drawing = { id: 'score-' + name, name, type: 'floor-plan', file, pageCount: 1, currentPage: 1,
    previewUrl: null, rasterUrl: null, rasterWidth: null, rasterHeight: null,
    parsedWalls: [], parsedRooms: [], parsedOpenings: [], parsedText: [], parsedSymbols: [],
    parsedAnnotationCandidates: [], parseProgress: 0, floorNumber: null, status: 'pending',
    scaleMmPerPx: null, scaleNotation: null, scaleConfidence: 'fallback' }
  let patch
  try { patch = await processDrawing(drawing, () => {}) }
  catch (e) { return { err: String((e && e.message) || e) } }
  if (patch.status === 'error') return { err: patch.errorMessage }

  const walls = patch.parsedWalls || []
  const scale = patch.scaleMmPerPx
  const MM_PER_FT = 304.8

  /**
   * The building's own extent, from the walls — not the raster's, which is the
   * whole sheet including the title block and the notes column.
   */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const w of walls) {
    x0 = Math.min(x0, w.x1, w.x2); x1 = Math.max(x1, w.x1, w.x2)
    y0 = Math.min(y0, w.y1, w.y2); y1 = Math.max(y1, w.y1, w.y2)
  }
  const spanPx = walls.length ? { w: x1 - x0, h: y1 - y0 } : null
  const footprintFt = spanPx && scale
    ? { width: (spanPx.w * scale) / MM_PER_FT, height: (spanPx.h * scale) / MM_PER_FT }
    : null

  const roles = {}
  for (const w of walls) roles[w.wallType || 'unknown'] = (roles[w.wallType || 'unknown'] || 0) + 1

  return {
    ms: Math.round(performance.now() - t0),
    page: patch.currentPage, pageCount: patch.pageCount,
    raster: [patch.rasterWidth, patch.rasterHeight],
    scaleMmPerPx: scale, scaleConfidence: patch.scaleConfidence, scaleNotation: patch.scaleNotation,
    walls: walls.length, returns: walls.filter(w => w.isReturn).length, roles,
    footprintFt,
    openings: (patch.parsedOpenings || []).length,
    openingKinds: (patch.parsedOpenings || []).reduce((a, o) => { a[o.type || '?'] = (a[o.type || '?'] || 0) + 1; return a }, {}),
    roomNames: (patch.parsedRooms || []).map(r => r.name).filter(Boolean),
    rooms: (patch.parsedRooms || []).length,
    roomAreasSqM: (patch.parsedRooms || []).map(r => r.areaSqM).filter(a => a != null).map(a => Math.round(a * 10) / 10),
    words: (patch.parsedText || []).length,
  }
}`

/** Loose match: a plan writes 'BEDROOM #1' and OCR may return 'BEDROOM 1'. */
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')
const foundName = (want, got) => got.some((g) => {
  const a = norm(want), b = norm(g)
  return a === b || (a.length >= 4 && (b.includes(a) || a.includes(b)))
})

const pct = (got, want) => (Math.abs(got - want) / want) * 100
const fmtFt = (ft) => {
  const whole = Math.floor(ft)
  const inches = Math.round((ft - whole) * 12)
  return inches === 12 ? `${whole + 1}'-0"` : `${whole}'-${inches}"`
}

const results = []
for (const s of sheets) {
  const r = await page.evaluate(`(${run})(${JSON.stringify(s.file)})`).catch((e) => ({ err: e.message }))
  results.push({ file: s.file, truth: s, got: r })

  if (process.env.JSON) continue
  console.log('\n' + '='.repeat(74))
  console.log(s.title)
  console.log(`${s.file}   [${s.difficulty}]`)
  console.log('='.repeat(74))
  if (r.err) { console.log(`  FAILED TO PROCESS: ${r.err}`); continue }

  console.log(`  read in ${(r.ms / 1000).toFixed(1)}s   raster ${r.raster.join('x')}`)

  // SHEET
  const sheetOk = r.page === s.page
  console.log(`  SHEET     picked page ${r.page} of ${r.pageCount}` +
    (s.page ? `   expected ${s.page}   ${sheetOk ? 'RIGHT SHEET' : '*** WRONG SHEET ***'}` : ''))

  // SIZE
  if (s.footprintFt && r.footprintFt) {
    const ew = pct(r.footprintFt.width, s.footprintFt.width)
    const eh = pct(r.footprintFt.height, s.footprintFt.height)
    console.log(`  SIZE      measured ${fmtFt(r.footprintFt.width)} x ${fmtFt(r.footprintFt.height)}` +
      `   sheet says ${fmtFt(s.footprintFt.width)} x ${fmtFt(s.footprintFt.height)}`)
    console.log(`            off by ${ew.toFixed(1)}% x ${eh.toFixed(1)}%` +
      `   (scale ${r.scaleMmPerPx ? r.scaleMmPerPx.toFixed(2) : '—'} mm/px, ${r.scaleConfidence})`)
  } else if (s.footprintFt) {
    console.log(`  SIZE      could not measure (no scale or no walls) — sheet says ` +
      `${fmtFt(s.footprintFt.width)} x ${fmtFt(s.footprintFt.height)}`)
  } else {
    console.log(`  SIZE      not stated on this sheet — not scored`)
  }

  // ROOMS
  if (s.rooms && s.rooms.length) {
    const hits = s.rooms.filter((rm) => foundName(rm.name, r.roomNames))
    console.log(`  ROOMS     named ${hits.length} of ${s.rooms.length}   (found ${r.rooms} regions, ${r.words} words read)`)
    const missed = s.rooms.filter((rm) => !foundName(rm.name, r.roomNames)).map((rm) => rm.name)
    if (missed.length) console.log(`            missed: ${missed.join(', ')}`)
    if (r.roomNames.length) console.log(`            got: ${r.roomNames.slice(0, 10).join(', ')}`)
  } else {
    console.log(`  ROOMS     no named rooms in the key — not scored`)
  }

  // OPENINGS
  const wantOpenings = (s.doorMarks ?? 0) + (s.windowMarks ?? 0)
  if (s.doorMarks != null || s.windowMarks != null) {
    console.log(`  OPENINGS  found ${r.openings} ${JSON.stringify(r.openingKinds)}` +
      `   schedule lists ${wantOpenings} (${s.doorMarks ?? '?'} door, ${s.windowMarks ?? '?'} window)`)
  } else {
    console.log(`  OPENINGS  no schedule on this sheet — not scored   (found ${r.openings})`)
  }

  // WALLS
  console.log(`  WALLS     ${r.walls}` + (r.returns ? ` (${r.returns} returns)` : '') + `   typed ${JSON.stringify(r.roles)}`)
  if (s.wallLegend) console.log(`            sheet legend says ${s.wallLegend.exterior} exterior / ${s.wallLegend.interior} interior`)
}

if (process.env.JSON) {
  console.log(JSON.stringify({ when: new Date().toISOString(), results }, null, 2))
} else {
  console.log('\n' + '='.repeat(74))
  const scored = results.filter((x) => !x.got.err)
  const rightSheet = scored.filter((x) => x.got.page === x.truth.page).length
  const sized = scored.filter((x) => x.truth.footprintFt && x.got.footprintFt)
  const within10 = sized.filter((x) =>
    pct(x.got.footprintFt.width, x.truth.footprintFt.width) <= 10 &&
    pct(x.got.footprintFt.height, x.truth.footprintFt.height) <= 10).length
  const roomWant = scored.reduce((n, x) => n + (x.truth.rooms?.length ?? 0), 0)
  const roomGot = scored.reduce((n, x) =>
    n + (x.truth.rooms ?? []).filter((rm) => foundName(rm.name, x.got.roomNames ?? [])).length, 0)
  console.log(`WHAT WE CAN HONESTLY CLAIM, over ${results.length} real sheets never trained on:`)
  console.log(`  processed without error   ${scored.length} of ${results.length}`)
  console.log(`  opened the right sheet    ${rightSheet} of ${results.length}`)
  console.log(`  building size within 10%  ${within10} of ${sized.length} sheets that state one`)
  console.log(`  room names read           ${roomGot} of ${roomWant}`)
  if (pageErrors.length) console.log(`  page errors: ${[...new Set(pageErrors)].slice(0, 5).join(' | ')}`)
  console.log('='.repeat(74))
}

await browser.close()
