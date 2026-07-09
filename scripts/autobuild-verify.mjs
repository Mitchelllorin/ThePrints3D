// Can the app build the whole model straight from a preset print, on its own?
// Runs the full auto-flow per preset: load -> processWithSeeds (detect walls) ->
// buildModel (frame + show 3D), then reports detected wall count, whether a
// framed buildResult was produced, and any page errors.
// Run: node scripts/autobuild-verify.mjs   (dev server on 5173 or 5180)
import { chromium } from 'playwright'

const url = process.env.UI_URL ?? 'http://localhost:5173/'
const PRESETS = ['Easy Starter Cottage', 'Medium Family House', 'Hard Mixed-Use Core']

const browser = await chromium.launch({ channel: 'chrome' }) // use installed Chrome (no bundled-browser download)

async function run(name) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: new RegExp(name, 'i') }).first().dispatchEvent('click').catch((e) => errors.push('preset: ' + e.message))
  await page.waitForTimeout(5000)

  const result = await page.evaluate(async () => {
    const store = window.__appStore
    const s = store.getState()
    const d = s.drawings[0]
    if (!d) return { error: 'no drawing' }
    // Detect the rest straight from the print (no seed needed — full pass).
    if (s.processWithSeeds) { try { await s.processWithSeeds(d.id) } catch (e) { /* noop */ } }
    // Build the 3D model from whatever was detected.
    if (s.buildModel) s.buildModel()
    await new Promise((r) => setTimeout(r, 500))
    const s2 = store.getState()
    const walls = (s2.drawings[0].parsedWalls ?? [])
    const br = s2.buildResult
    return {
      detectedWalls: walls.length,
      auto: walls.filter((w) => w.source === 'auto').length,
      builtFraming: !!br,
      framedWalls: br?.walls?.length ?? br?.wallCount ?? null,
      view: s2.view,
      modelStatus: s2.model?.status,
    }
  }).catch((e) => ({ error: String(e) }))

  await ctx.close()
  return { name, result, errors: errors.length }
}

const rows = []
for (const p of PRESETS) rows.push(await run(p))
await browser.close()

console.log('\n=== Auto-build from print (preset -> detect -> build) ===')
for (const r of rows) {
  console.log(`\n${r.name}  (pageerrors: ${r.errors})`)
  console.log('  ', JSON.stringify(r.result))
}
console.log('\nDone.')
