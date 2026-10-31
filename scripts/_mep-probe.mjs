// Scratch probe for the MEP workflow review — phone-size, real app.
import { chromium } from 'playwright'
const OUT = process.env.SHOT_DIR
const steps = JSON.parse(process.env.STEPS ?? '[]')
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(4000)
const launch = p.locator('button', { hasText: /^Launch$/ }).first()
if (await launch.count()) { await launch.click(); await p.waitForTimeout(4000) }
await p.evaluate(async () => {
  const { useAppStore } = await import('/src/store/useAppStore.ts')
  const s = useAppStore.getState()
  s.startDrawnProject({ widthMm: 12000, depthMm: 9000, wallTypeKey: 'wood-2x6', floor: 'slab', name: 'Probe' })
  useAppStore.getState().standWalls()
})
await p.waitForTimeout(5000)
const controls = async () => p.evaluate(() => [...document.querySelectorAll('button,[role=button]')].filter((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
  return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight
}).map((el) => { const r = el.getBoundingClientRect(); return `(${Math.round(r.x)},${Math.round(r.y)}) ${(el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 40)}` }))
let i = 0
const shot = async (name) => { await p.screenshot({ path: `${OUT}/${String(i++).padStart(2, '0')}-${name}.png` }); console.log(`\n=== ${name} ===\n` + (await controls()).join('\n')) }
await shot('start')
for (const st of steps) {
  try {
    if (st.click) await p.locator(st.sel ?? 'button:visible, [role=button]:visible', { hasText: new RegExp(st.click) }).first().click({ timeout: 5000 })
    if (st.label) await p.getByLabel(new RegExp(st.label)).first().click({ timeout: 5000 })
    if (st.tap) await p.mouse.click(st.tap[0], st.tap[1])
    if (st.js) await p.evaluate(st.js)
    if (st.jsFile) await p.evaluate((await import('node:fs')).readFileSync(st.jsFile, 'utf8'))
  } catch (e) { console.log('STEP FAILED', JSON.stringify(st), e.message.split('\n')[0]) }
  await p.waitForTimeout(st.wait ?? 1500)
  await shot(st.name ?? 'step')
}
console.log('\nERRORS:', errors.slice(0, 5).join('\n') || 'none')
await b.close()
