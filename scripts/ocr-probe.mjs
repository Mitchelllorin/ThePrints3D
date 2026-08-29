/**
 * ocr-probe — does the text reader actually run, and if not, why not?
 *
 * `ocrRaster` swallows every failure and returns [] by design: OCR that fails
 * must cost the words, never the build. Correct, and it means a total failure
 * looks exactly like a blank drawing from the outside. This takes the lid off —
 * same image, same call, but the error is printed instead of eaten.
 */
import { chromium } from 'playwright'
const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5180/'
const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const net = []
page.on('requestfailed', (r) => net.push(`FAILED ${r.failure()?.errorText}  ${r.url().slice(0, 110)}`))
page.on('response', (r) => { if (r.status() >= 400) net.push(`HTTP ${r.status()}  ${r.url().slice(0, 110)}`) })
page.on('console', (m) => { if (m.type() === 'error') net.push('console: ' + m.text().slice(0, 160)) })

await page.goto(URL_, { waitUntil: 'commit', timeout: 90000 })
await page.waitForFunction(() => !!window.__appStore?.getState, null, { timeout: 120000 })

const out = await page.evaluate(async () => {
  const t0 = performance.now()
  const res = await fetch('/data/test-prints/screenshot-adu-71sqm.png')
  const blob = await res.blob()
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = bmp.width; c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  const img = c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height)

  // 1. the app's own wrapper (swallows errors)
  const { ocrRaster } = await import('/src/services/ocr.ts')
  let viaApp = null, appErr = null
  try { viaApp = (await ocrRaster(img)).length } catch (e) { appErr = String(e.message || e) }

  // 2. how long does the reader itself take, against its own 25s timeout?
  const t1 = performance.now()
  const second = (await ocrRaster(img)).length
  const ocrMs = Math.round(performance.now() - t1)

  return { size: bmp.width + 'x' + bmp.height, viaApp, appErr, second, ocrMs, ms: Math.round(performance.now() - t0) }
})

console.log('image                ', out.size, `(${out.ms} ms total)`)
console.log('words via ocrRaster  ', out.viaApp, out.appErr ? '  ERR: ' + out.appErr : '')
console.log('warm re-read         ', out.second, 'words in', out.ocrMs, 'ms   (its own timeout is 25000 ms)')
console.log('\n--- network / console ---')
console.log(net.length ? [...new Set(net)].join('\n') : '(clean)')
await browser.close()
