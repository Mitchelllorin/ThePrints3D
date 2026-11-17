/**
 * breakit-shots — the camera sweep, photographed at 360×640.
 *
 * The order (BREAK-IT §4) says tests passing is not enough: the sweep has to be
 * seen. This drives the real app in a real browser at phone size, taps a proven
 * preset, pushes the ramp, and captures the four states the order asks for:
 *
 *   01-ramp-strip.png   the dashboard as it lands — a slim strip, not a column
 *   02-preset.png       a preset chosen
 *   03-sweep-mid.png    the camera moving and everything else fading
 *   04-card.png         the part alone, the failure card up
 *
 * It also measures the page: the card must leave at least two thirds of the
 * screen to the canvas, the strip must be gone at the break, and the card must
 * not touch the part's band. The part's own projected box is asserted in
 * src/services/arena/bench.test.ts (projectBenchBox) because it is a property of
 * the camera maths, not of the DOM.
 *
 * Usage (against the dev server, which must already be running — this script
 * never starts one):
 *
 *     node scripts/breakit-shots.mjs
 *     APP_URL=http://127.0.0.1:5173/ node scripts/breakit-shots.mjs
 *
 * Exits non-zero if a shot or a check fails.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/'
const OUT = process.env.SHOT_DIR ?? 'docs/breakit'

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
})

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

const shots = []
async function shot(name) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path })
  shots.push(path)
  console.log(`shot: ${path}`)
}

/** Tap the first visible control whose accessible name matches, if there is one. */
async function tapIfThere(locator, ms = 2000) {
  try {
    const el = locator.first()
    await el.waitFor({ state: 'visible', timeout: ms })
    await el.click()
    return true
  } catch {
    return false
  }
}

try {
  await mkdir(OUT, { recursive: true })

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)

  // The front door. The app warms the workspace behind it, so this is one tap.
  if (!(await tapIfThere(page.getByRole('button', { name: /^launch$/i }), 4000))) {
    throw new Error('launch screen never offered a Launch button')
  }
  await page.waitForTimeout(1200)

  // Any coaching card is transient; close it if it is in the way.
  await tapIfThere(page.getByRole('button', { name: /^(skip|got it|close|done)$/i }), 600)

  // The rail's arena mark. The rail is present on the workspace at every size.
  if (!(await tapIfThere(page.locator('[data-tour="rail-arena"]'), 6000))) {
    throw new Error('rail-arena control not found')
  }

  await page.locator('#arena-strip').waitFor({ state: 'visible', timeout: 8000 })
  await shot('01-ramp-strip')

  // A preset, then the push that runs it. The presets are generic by order §6.
  await page.locator('[data-testid="ramp-preset"]').first().click()
  await shot('02-preset')

  await page.locator('[data-testid="ramp-push"]').click()

  // The card mounts at the instant of the break, which is when the sweep starts.
  const card = page.locator('#bench-fail-card')
  await card.waitFor({ state: 'visible', timeout: 12000 })
  await shot('03-sweep-mid')

  await page.waitForTimeout(1200)
  await shot('04-card')

  const measured = await page.evaluate(() => {
    const H = window.innerHeight
    const W = window.innerWidth
    const cardEl = document.getElementById('bench-fail-card')
    const stripEl = document.getElementById('arena-strip')
    const c = cardEl ? cardEl.getBoundingClientRect() : null
    return {
      W, H,
      card: c ? { left: c.left, top: c.top, right: c.right, bottom: c.bottom, height: c.height } : null,
      stripVisible: !!stripEl && stripEl.getBoundingClientRect().height > 0,
      // The opaque chrome at the foot is the card (the strip must be gone).
      canvasShare: c ? (H - (H - c.top)) / H : 0,
    }
  })

  console.log('\n=== MEASURED ===')
  console.log(JSON.stringify(measured, null, 2))

  const problems = []
  if (!measured.card) problems.push('failure card not found')
  if (measured.stripVisible) problems.push('the strip is still on screen at the break')
  if (measured.card && measured.canvasShare < 2 / 3) {
    problems.push(`card leaves ${(measured.canvasShare * 100).toFixed(1)}% of the screen to the canvas, needs ≥ 66.7%`)
  }
  if (measured.card && measured.card.height > measured.H / 3) {
    problems.push(`card is ${(measured.card.height / measured.H * 100).toFixed(1)}% of the screen tall, needs ≤ 33%`)
  }
  if (measured.card && measured.card.left < 0) problems.push('card runs off the left edge')

  if (errors.length) console.log('\n=== PAGE ERRORS ===\n' + errors.join('\n'))
  if (problems.length) {
    console.error('\n=== FAILED ===\n' + problems.join('\n'))
    process.exitCode = 1
  } else {
    console.log('\nOK — strip gone, card up, canvas keeps two thirds.')
  }
  console.log(`\n${shots.length} shots in ${OUT}/`)
} finally {
  await browser.close()
}
