/**
 * RUN THE RULER FROM THE COMMAND LINE.
 *
 * `__scorePrints()` already exists but only inside a DEV browser console, which
 * means measuring a detection change costs a manual page load, a console visit
 * and a squint at a table. That friction is why changes shipped unmeasured — a
 * 48% wall loss went through because re-running the numbers was a chore.
 *
 * This drives the real dev server in a real browser (canvas, workers, pdf.js
 * all present — none of which exist in node) and writes the table to stdout and
 * to JSON, so a run can be diffed against the run before it.
 *
 *   node scripts/score-corpus.mjs [--out baseline.json] [--only a.pdf,b.png]
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const out = flag('--out')
const only = flag('--only')?.split(',').filter(Boolean) ?? null
const url = flag('--url') ?? 'http://localhost:5180/'

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (/error|fail|warn/i.test(t) && !/DevTools|source map/i.test(t)) console.log('  [page]', t.slice(0, 160))
})

console.log(`loading ${url} ...`)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForFunction(() => typeof window.__scorePrints === 'function', { timeout: 60_000 })

console.log('scoring corpus (this rasterises real PDFs — allow a few minutes) ...')
// No timeout: rasterising four real permit sets legitimately takes minutes,
// and a harness that gives up early would report a failure the app never had.
page.setDefaultTimeout(0)
const rows = await page.evaluate((o) => window.__scorePrints(o ?? undefined), only)

console.table(rows)

/**
 * What did the wall steps actually DO?
 *
 * The end-of-pipeline numbers move for reasons that have nothing to do with the
 * step under test — OCR runs on a time budget, so room extraction is seeded
 * differently from run to run and enclosure wanders by one either way. Reading
 * the step's own log is the direct measurement: how many endpoints moved, and
 * whether the guard kept or rolled back the result.
 */
const events = await page.evaluate(() => {
  try {
    return (JSON.parse(localStorage.getItem('theprints3d.logs') ?? '[]'))
      .filter((r) => r.event.startsWith('drawing.walls.'))
      .map((r) => ({ event: r.event.replace('drawing.walls.', ''), ...r.context }))
  } catch { return [] }
})
if (events.length) {
  console.log('')
  console.log('wall steps:')
  console.table(events)
} else {
  console.log('')
  console.log('wall steps: none logged')
}

if (out) { writeFileSync(out, JSON.stringify({ rows, events }, null, 2)); console.log(`wrote ${out}`) }
await browser.close()
