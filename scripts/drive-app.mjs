/**
 * drive-app — open the app the way a phone does and report what is actually
 * on screen.
 *
 * The Chrome extension is not connected, and "it looks fine to me" is not a
 * thing that can be said about a build the user has already found buggy. So
 * this drives the real app in a real browser at a real phone size, and prints
 * what it finds rather than what it hopes.
 */
import { chromium } from 'playwright'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const OUT = process.env.SHOT_DIR ?? '.'

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },        // Pixel-ish portrait
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
})

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

/** Everything a finger could actually hit, in DOM order. */
async function controls() {
  return page.evaluate(() => {
    const out = []
    const els = document.querySelectorAll('button, [role="button"], a, input, select')
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 40),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
      })
    }
    return out
  })
}

console.log('=== TITLE ===')
console.log(await page.title())

console.log('\n=== VISIBLE TEXT ===')
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 2500))

console.log('\n=== CONTROLS ===')
for (const c of await controls()) {
  console.log(`  [${c.tag}] "${c.text}"  @${c.x},${c.y} ${c.w}x${c.h}`)
}

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')

await page.screenshot({ path: `${OUT}/app-01-open.png` })
console.log(`\nshot: ${OUT}/app-01-open.png`)

await browser.close()
