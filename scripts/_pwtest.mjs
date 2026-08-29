import { chromium } from 'playwright'
const url = 'http://127.0.0.1:5180/'
for (const [label, opts] of [
  ['chrome channel', { channel: 'chrome' }],
  ['chrome + no-proxy', { channel: 'chrome', args: ['--no-proxy-server','--proxy-bypass-list=<-loopback>'] }],
  ['bundled chromium', {} ],
]) {
  try {
    const b = await chromium.launch({ ...opts, timeout: 30000 })
    const p = await b.newPage()
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    console.log(label, '=> OK, title:', await p.title())
    await b.close()
  } catch (e) {
    console.log(label, '=> FAIL:', String(e.message).split('\n')[0])
  }
}
