/**
 * opening-match-verify — WHY does a detected opening not get framed?
 *
 * From the phone, on a screenshot print: "it did detect a couple openings on
 * the inside that it framed over but the outside walls it didn't."
 *
 * Framing an opening takes two steps and only the first is visible in a count.
 * Detection finds the gap; then `LiveWallsLayer.openingsByWall` has to decide
 * WHICH wall the opening belongs to, and it does that by projecting the
 * opening's centre onto each wall run and demanding
 *
 *     t within [-0.02, 1.02]      — the point lies ON the run, not past its end
 *     perp < max(thick*2.5, 28)   — and close to its centreline
 *
 * An opening that was never bridged by `rejoinAcrossOpenings` sits in the GAP
 * between two collinear runs, which means it is off the end of both: t > 1.02
 * for one and t < -0.02 for the other. Every test fails, the opening matches no
 * wall, and it is silently dropped — detected, listed, and never framed.
 *
 * This replays that exact test in pixel space (t is affine-invariant, and the
 * perp threshold scales with the transform, so the verdict is the same one the
 * layer reaches) and reports, per opening, whether it landed and why not.
 *
 * Run: node scripts/opening-match-verify.mjs      (dev server on 5180)
 */
import { chromium } from 'playwright'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const SHOT = process.env.SHOT ?? 'screenshot-adu-71sqm.png'

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 160)) })

await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 120000 })
await page.waitForTimeout(1500)

const run = `async (name) => {
  const { processDrawing } = await import('/src/services/drawingProcessor.ts')
  const { modelWalls } = await import('/src/services/modelWalls.ts')
  const res = await fetch('/data/test-prints/' + name)
  const file = new File([await res.blob()], name, { type: 'image/png' })
  const drawing = { id: 'om-' + name, name, type: 'floor-plan', file, pageCount: 1, currentPage: 1,
    previewUrl: null, rasterUrl: null, rasterWidth: null, rasterHeight: null,
    parsedWalls: [], parsedRooms: [], parsedOpenings: [], parsedText: [], parsedSymbols: [],
    parsedAnnotationCandidates: [], parseProgress: 0, floorNumber: null, status: 'pending',
    scaleMmPerPx: null, scaleNotation: null, scaleConfidence: 'fallback' }
  const patch = await processDrawing(drawing, () => {})
  const full = { ...drawing, ...patch }

  // The SAME walls the framing layer builds from.
  const walls = modelWalls([full]).map(x => x.wall)
  const scale = patch.scaleMmPerPx || 0

  const rows = (patch.parsedOpenings || []).map((op) => {
    const ang = op.angle ?? (op.orientation === 'vertical' ? Math.PI/2 : 0)
    // nearestWall's own test, in pixel units.
    let best = -1, bestScore = Infinity, bestT = 0, nearestAny = Infinity, nearestAnyT = 0, nearestAnyThick = 0
    walls.forEach((w, i) => {
      const dx = w.x2 - w.x1, dz = w.y2 - w.y1
      const len2 = dx*dx + dz*dz
      if (len2 < 1e-6) return
      const t = ((op.x - w.x1)*dx + (op.y - w.y1)*dz) / len2
      const fx = w.x1 + t*dx, fy = w.y1 + t*dz
      const perp = Math.hypot(op.x - fx, op.y - fy)
      const thresh = Math.max((w.thickness || 8) * 2.5, 28)
      // How close it came IGNORING the t-range gate — this is the number that
      // says "it is the right wall, it just sits past the end of it".
      if (perp < nearestAny) { nearestAny = perp; nearestAnyT = t; nearestAnyThick = w.thickness }
      if (t < -0.02 || t > 1.02) return
      if (perp < thresh && perp < bestScore) { best = i; bestScore = perp; bestT = t }
    })
    return {
      type: op.type, widthPx: Math.round(op.widthPx),
      widthMm: op.widthMm == null ? null : Math.round(op.widthMm),
      matched: best >= 0,
      t: +bestT.toFixed(2),
      // The closest wall by perpendicular distance, whatever its t said.
      nearestPerpPx: Math.round(nearestAny),
      nearestT: +nearestAnyT.toFixed(2),
      nearestThickPx: Math.round(nearestAnyThick),
    }
  })

  const th = walls.map(w => w.thickness).filter(Boolean).sort((a,b)=>a-b)
  return {
    scale, walls: walls.length,
    medianThickPx: th.length ? Math.round(th[Math.floor(th.length/2)]) : 0,
    maxThickPx: th.length ? Math.round(th[th.length-1]) : 0,
    openings: rows,
  }
}`

console.log(`\n${SHOT}`)
console.log('='.repeat(78))
const r = await page.evaluate(`(${run})(${JSON.stringify(SHOT)})`)
console.log(`scale ${r.scale ? r.scale.toFixed(3) + ' mm/px' : 'NONE'} · ${r.walls} walls · thickness median ${r.medianThickPx}px, max ${r.maxThickPx}px\n`)
console.log('  type    widthPx  widthMm  FRAMED?   t     nearest wall: perp   t     thick')
for (const o of r.openings) {
  console.log(
    `  ${String(o.type).padEnd(7)} ${String(o.widthPx).padStart(6)}  ${String(o.widthMm ?? '—').padStart(7)}  ` +
    `${(o.matched ? 'yes' : 'NO ').padEnd(8)} ${String(o.t).padStart(5)}   ` +
    `${String(o.nearestPerpPx).padStart(12)}  ${String(o.nearestT).padStart(6)}  ${String(o.nearestThickPx).padStart(5)}`,
  )
}
const missed = r.openings.filter((o) => !o.matched)
console.log(`\n${r.openings.length - missed.length} of ${r.openings.length} openings would be framed.`)
if (missed.length) {
  const pastEnd = missed.filter((o) => o.nearestT < -0.02 || o.nearestT > 1.02).length
  console.log(`Of the ${missed.length} that would not: ${pastEnd} sit PAST THE END of their nearest wall (t outside 0..1)`)
  console.log('— which is an opening in a gap that was never bridged, not a detection failure.')
}
console.log('\n=== ERRORS ===')
console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)')
await browser.close()
