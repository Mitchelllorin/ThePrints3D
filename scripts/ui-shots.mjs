import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.UI_URL ?? 'http://localhost:5173/'
mkdirSync('ui-shots', { recursive: true })

const targets = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]

const browser = await chromium.launch()
for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: t.viewport,
    deviceScaleFactor: t.deviceScaleFactor,
    isMobile: t.isMobile,
    hasTouch: t.hasTouch,
  })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `ui-shots/${t.name}-landing.png` })

  // Drop into the workspace via a preset.
  await page.getByText(/Easy Starter Cottage/i).first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `ui-shots/${t.name}-workspace.png` })

  // Open each edge drawer in turn to see menu sizing.
  for (const tab of ['Build', 'Settings', 'Place']) {
    const el = page.getByText(new RegExp(`^${tab}$`, 'i')).first()
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 1500 }).catch(() => {})
      await page.waitForTimeout(900)
      await page.screenshot({ path: `ui-shots/${t.name}-drawer-${tab.toLowerCase()}.png` })
    }
  }
  await ctx.close()
  console.log(`shot ${t.name}`)
}
await browser.close()
console.log('done')
