// Quantify "find the rest" wall-detection coverage on the three practice presets.
// Loads each preset against the running dev server, reads the auto-detected wall
// count from the exposed store, then seeds one trace + runs processWithSeeds and
// re-reads — so we can see the coverage before/after the seed pass and watch for
// runaway false walls. Run: node scripts/coverage-verify.mjs  (dev server on 5180)
import { chromium } from 'playwright'

const url = process.env.UI_URL ?? 'http://localhost:5180/'
const PRESETS = ['Easy Starter Cottage', 'Medium Family House', 'Hard Mixed-Use Core']

const browser = await chromium.launch()

async function measure(name) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: new RegExp(name, 'i') }).first().dispatchEvent('click').catch((e) => errors.push('preset: ' + e.message))
  await page.waitForTimeout(5000)

  const before = await page.evaluate(() => {
    const s = window.__appStore?.getState?.()
    const d = s?.drawings?.[0]
    if (!d) return null
    const walls = d.parsedWalls ?? []
    return { total: walls.length, auto: walls.filter((w) => w.source === 'auto').length, user: walls.filter((w) => w.source === 'user').length }
  })

  // Seed one trace across the first detected wall, then run the seed pass.
  const after = await page.evaluate(async () => {
    const store = window.__appStore
    const s = store.getState()
    const d = s.drawings[0]
    if (!d) return null
    const w0 = (d.parsedWalls ?? []).find((w) => w.source === 'auto')
    if (w0 && s.addUserTrace) {
      s.addUserTrace({ id: 'seed-cov', points: [[w0.x1, w0.y1], [w0.x2, w0.y2]], layer: 'framing' })
    }
    if (s.processWithSeeds) { try { await s.processWithSeeds(d.id) } catch { /* ignore */ } }
    const d2 = store.getState().drawings[0]
    const walls = d2.parsedWalls ?? []
    return { total: walls.length, auto: walls.filter((x) => x.source === 'auto').length, user: walls.filter((x) => x.source === 'user').length }
  }).catch(() => null)

  await ctx.close()
  return { name, before, after, errors: errors.length }
}

const rows = []
for (const p of PRESETS) rows.push(await measure(p))
await browser.close()

console.log('\n=== Find-the-rest coverage ===')
for (const r of rows) {
  console.log(`\n${r.name}  (pageerrors: ${r.errors})`)
  console.log('  auto-detected on load :', r.before ? `${r.before.auto} walls (total ${r.before.total})` : 'n/a')
  console.log('  after seed pass       :', r.after ? `${r.after.auto} auto + ${r.after.user} user = ${r.after.total} total` : 'n/a')
}
console.log('\nDone.')
