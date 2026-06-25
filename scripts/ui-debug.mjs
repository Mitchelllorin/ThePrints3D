import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.UI_URL ?? 'http://localhost:5174/'
mkdirSync('ui-shots', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(2500)
console.log('loaded. body text sample:', (await page.locator('body').innerText().catch(() => '')).slice(0, 120).replace(/\n/g, ' | '))

// Load a preset — dispatch the click directly (bypasses actionability quirks).
const btn = page.getByRole('button', { name: /Easy Starter Cottage/i }).first()
console.log('preset button count:', await btn.count().catch(() => 0))
await btn.dispatchEvent('click').catch((e) => console.log('dispatch err:', e.message))
await page.waitForTimeout(4500)
console.log('Get started still visible:', await page.getByText(/Get started/i).count().catch(() => 0))
await page.screenshot({ path: 'ui-shots/phone-ws.png' })

// Open the Build drawer (the trace workflow chrome) and shoot it.
const buildTab = page.getByText(/^Build$/i).first()
if (await buildTab.count().catch(() => 0)) {
  await buildTab.dispatchEvent('click').catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'ui-shots/phone-build.png' })
}
console.log('shots saved')

await ctx.close()
await browser.close()
