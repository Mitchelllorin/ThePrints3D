/**
 * returns-overlay — did the returns sweep land on a wall, or on the sofa?
 *
 * "do you know the term 'return' in construction? like a wall return? its
 * missing those everytime". `wallReturns` looks for them, and the only honest
 * way to judge what it found is to LOOK: a count proves nothing, because the
 * first version of the filter happily rescued 49 segments that turned out to be
 * a hatched band along the bottom of the sheet.
 *
 * So this draws them. Every wall the main ladder found goes down in blue, every
 * segment marked `isReturn` goes down in red, over the print itself, and the
 * PNG lands in a file you can open. Every tightening of the filter in
 * `wallReturns` came from looking at one of these — the cabinets, the toilet,
 * the bed — not from a number going down.
 *
 * Run: node scripts/returns-overlay.mjs            (dev server on 5180)
 *      SHOT=screenshot-studio-1bed.png node scripts/returns-overlay.mjs
 *      OUT_DIR=. node scripts/returns-overlay.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const OUT = process.env.OUT_DIR ?? '.'
const SHOTS = process.env.SHOT ? [process.env.SHOT] : ['screenshot-adu-71sqm.png', 'screenshot-studio-1bed.png']

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
// A cold dev server has to transform the whole module graph before the app
// exists — measured at ninety seconds, so this waits far longer than it looks.
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 240000 })
await page.waitForTimeout(1000)

const run = `async (name) => {
  const { processDrawing } = await import('/src/services/drawingProcessor.ts')
  const res = await fetch('/data/test-prints/' + name)
  const blob = await res.blob()
  const file = new File([blob], name, { type: 'image/png' })
  const drawing = { id: 'ov-' + name, name, type: 'floor-plan', file, pageCount: 1, currentPage: 1,
    previewUrl: null, rasterUrl: null, rasterWidth: null, rasterHeight: null,
    parsedWalls: [], parsedRooms: [], parsedOpenings: [], parsedText: [], parsedSymbols: [],
    parsedAnnotationCandidates: [], parseProgress: 0, floorNumber: null, status: 'pending',
    scaleMmPerPx: null, scaleNotation: null, scaleConfidence: 'fallback' }
  const t0 = performance.now()
  let patch = {}
  try { patch = await processDrawing(drawing, () => {}) } catch (e) { return { err: String(e && e.message || e) } }
  const ms = Math.round(performance.now() - t0)
  const walls = patch.parsedWalls || []
  const returns = walls.filter(w => w.isReturn)

  const url = patch.rasterUrl || URL.createObjectURL(blob)
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url })
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const g = c.getContext('2d')
  g.drawImage(img, 0, 0)
  const draw = (segs, colour, w) => { g.strokeStyle = colour; g.lineWidth = w
    for (const s of segs) { g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke() } }
  draw(walls.filter(w => !w.isReturn), 'rgba(0,110,255,0.55)', 2)
  draw(returns, 'rgba(255,0,0,0.95)', 3)

  return {
    ms, size: [c.width, c.height], walls: walls.length, returns: returns.length,
    scaleMmPerPx: patch.scaleMmPerPx,
    returnLenPx: returns.map(r => Math.round(Math.hypot(r.x2 - r.x1, r.y2 - r.y1))),
    png: c.toDataURL('image/png').slice(22),
  }
}`

for (const name of SHOTS) {
  const r = await page.evaluate(`(${run})(${JSON.stringify(name)})`).catch((e) => ({ err: e.message }))
  if (r.err) { console.log(name, 'ERROR:', r.err); continue }
  const out = `${OUT}/returns-${name}`
  fs.writeFileSync(out, Buffer.from(r.png, 'base64'))
  const mm = r.scaleMmPerPx ? r.returnLenPx.map((l) => Math.round(l * r.scaleMmPerPx)) : []
  console.log(`${name}  ${r.size.join('x')}  ${r.ms} ms`)
  console.log(`  walls ${r.walls}, of them RETURNS ${r.returns}`)
  console.log(`  return lengths  ${JSON.stringify(r.returnLenPx)} px  =  ${JSON.stringify(mm)} mm`)
  console.log(`  -> ${out}   (blue = the ladder's walls, red = returns)`)
}

await browser.close()
