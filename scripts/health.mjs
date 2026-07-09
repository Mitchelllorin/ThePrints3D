import { chromium } from 'playwright'
const url = 'http://localhost:5173/'
const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext()).newPage()
const errs = []
p.on('pageerror', e => errs.push('PAGEERR: ' + e.message))
p.on('console', m => { if (m.type()==='error') errs.push('CON: ' + m.text().slice(0,220)) })
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(7000)
const info = await p.evaluate(() => ({
  hasStore: typeof window.__appStore,
  bodyLen: document.body.innerText.length,
  canvas: document.querySelectorAll('canvas').length,
}))
console.log('info:', JSON.stringify(info))
console.log('errors:', errs.length ? errs.slice(0,8) : 'none')
await b.close()
