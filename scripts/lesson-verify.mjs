/**
 * lesson-verify — does the app actually SAY the lesson, and does the button
 * actually fix the sheet?
 *
 * The unit tests prove the store learns. They cannot prove the coach opens its
 * mouth. So this drives the real app at phone size, seeds a sheet read at half
 * scale, corrects three walls the way a user's thumb would, and then reports
 * what is on screen and what the walls measure before and after the tap.
 */
import { chromium } from 'playwright'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const OUT = process.env.SHOT_DIR ?? '.'

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
})
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(URL, { waitUntil: "commit", timeout: 90000 })
await page.waitForTimeout(4000)

/** A sheet read at HALF its true scale — every wall measures half what it is. */
await page.evaluate(() => {
  const SCALE = 5, TRUE = 2
  const t = (mm) => mm / (SCALE * TRUE)
  const wall = (mm, x) => ({
    x1: x, y1: 0, x2: x, y2: 400, thickness: t(mm),
    source: 'auto', detectionConfidence: 0.8, finishedMm: t(mm) * SCALE,
  })
  const type = (id, name, mm, usage) => ({
    id, name, thicknessMm: mm, layers: [], loadBearing: usage === 'exterior',
    usage, markupTag: id, color: '#94a3b8',
  })
  const EXT = type('EXT', 'Exterior', 250, 'exterior')
  const INT = type('INT', 'Interior', 120, 'interior')
  const PT = type('PT', 'Partition', 75, 'partition')
  const walls = [wall(250, 10), wall(120, 20), wall(75, 30)]

  const st = window.__appStore.getState()
  window.__appStore.setState({
    drawings: [{
      id: 'd1', name: 'plan.pdf', type: 'floor_plan', status: 'ready',
      parsedWalls: walls, parsedRooms: [], parsedOpenings: [], parsedText: [],
      parsedSymbols: [], parsedAnnotationCandidates: [], parseProgress: 100,
      scaleMmPerPx: SCALE, scaleConfidence: 'inferred', uploadedAt: Date.now(),
    }],
    selectedDrawingId: 'd1',
    floorplanOverlay: { ...st.floorplanOverlay, drawingId: 'd1', calibrationMode: false },
    detectedWallTypes: walls.map((w) => ({
      wallId: `${w.x1},${w.y1}`, wallType: PT, confidence: 0.8, fromSeed: false,
    })),
    projectWallTypes: [EXT, INT, PT],
    corrections: [], correctionCount: 0,
  })
  const fp = window.__floorplanLocalStore
  fp.setState({ tutorialActive: false, buildDrawerOpen: false, askDrawerOpen: false, settingsDrawerOpen: false, activePanel: null, traceMode: false })
})
await page.waitForTimeout(600)

const bubbleText = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('[role="status"]')]
  if (!els.length) return '(no bubble)'
  return els.map((el, i) => '#' + i + ' ' + el.innerText.split(String.fromCharCode(10)).join(' | ')).join('   ||   ')
})
const wallsNow = () => page.evaluate(() =>
  window.__appStore.getState().drawings[0].parsedWalls.map((w) => ({
    px: +w.thickness.toFixed(2), mm: Math.round(w.finishedMm ?? 0), type: w.wallType ?? '(none)',
  })))
const scaleNow = () => page.evaluate(() => {
  const d = window.__appStore.getState().drawings[0]
  return { mmPerPx: d.scaleMmPerPx, confidence: d.scaleConfidence }
})

console.log('=== BEFORE ANY CORRECTION ===')
console.log('bubble:', await bubbleText())

// Three taps: "no, that one's exterior", "that one's interior", "that's a partition".
await page.evaluate(() => {
  const a = window.__appStore.getState()
  a.correctElement('10,0', 'EXT')
  a.correctElement('20,0', 'INT')
  a.correctElement('30,0', 'PT')
})
await page.waitForTimeout(600)

console.log('\n=== AFTER 3 CORRECTIONS (the lesson should be on screen) ===')
console.log('store lesson:', await page.evaluate(() => {
  const l = window.__appStore.getState().correctionLessons()[0]
  return l ? l.id + ' / ' + l.actionLabel : '(none)'
}))
console.log('bubble @0.6s:', await bubbleText())
await page.waitForTimeout(2500)
console.log('bubble @3.1s:', await bubbleText())
console.log('scale :', JSON.stringify(await scaleNow()))
console.log('walls :', JSON.stringify(await wallsNow()))
await page.screenshot({ path: `${OUT}/lesson-01-said.png` })

const btn = page.locator('[role="status"] button', { hasText: /Fix the scale|Re-read/ })
const found = await btn.count()
console.log('\naction button on screen:', found ? await btn.first().innerText() : '(NONE — the coach cannot be acted on)')
if (found) await btn.first().click()
await page.waitForTimeout(800)

console.log('\n=== AFTER THE TAP ===')
console.log('scale :', JSON.stringify(await scaleNow()))
console.log('walls :', JSON.stringify(await wallsNow()))
console.log('corrections written:', await page.evaluate(() => window.__appStore.getState().corrections.length))
console.log('bubble:', await bubbleText())
await page.screenshot({ path: `${OUT}/lesson-02-applied.png` })

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
await browser.close()
