import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('http://127.0.0.1:5190/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(5000)
await p.locator('button', { hasText: /^Launch$/ }).first().click()
await p.waitForTimeout(6000)
const rows = await p.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g,' ').slice(0,34)
    const onScreen = r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
    out.push(`${onScreen ? 'ON ' : 'OFF'} (${Math.round(r.x)},${Math.round(r.y)}) op=${cs.opacity} ${t}`)
  }
  return out
})
console.log(rows.join('\n'))
await b.close()
