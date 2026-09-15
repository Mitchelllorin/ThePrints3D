/**
 * WALK THE BEAT — drive the app like a user and come back with what is broken.
 *
 * The bugs that make this app feel broken are not the ones unit tests catch.
 * They are: a control that renders but cannot be clicked, a panel that is
 * closed but still in the tab order, two pieces of text sitting on top of each
 * other, a preset that loads and leaves you with no floor. None of those fail a
 * vitest run, and all of them are obvious within ten seconds of using the app.
 *
 * So this drives it. Launch screen, into the workspace, through a preset —
 * screenshotting each stop and asserting a handful of things a person would
 * notice immediately:
 *
 *   error     — anything thrown at the page or logged as a console error
 *   offscreen — interactive controls parked outside the viewport but still
 *               focusable (a closed drawer that kept its tab stops)
 *   overlap   — visible text sitting on top of other visible text
 *   deadEnd   — a stage that produced no usable next action
 *
 * Run it against a dev server:
 *   node scripts/walk-the-beat.mjs --url http://127.0.0.1:5190/
 *
 * Exits nonzero when an error or dead end shows up, so it can become a gate.
 * For now the value is the report: run it, fix what it names, run it again.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const URL = flag('--url', 'http://127.0.0.1:5190/')
const SHOT = flag('--shots', 'ui-shots/beat')
const HEADED = args.includes('--headed')
mkdirSync(SHOT, { recursive: true })

const findings = []
const note = (stage, kind, msg) => findings.push({ stage, kind, msg })

const browser = await chromium.launch({ headless: !HEADED })
// 360x640 is the smallest common Android and the build rules say to test it
// FIRST, not at the end. If it works here it works everywhere.
const VIEWPORT = { width: Number(flag('--w', 360)), height: Number(flag('--h', 640)) }
const page = await browser.newPage({ viewport: VIEWPORT, isMobile: true, hasTouch: true })

let stage = 'boot'
page.on('pageerror', (e) => note(stage, 'error', String(e).split('\n')[0].slice(0, 200)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/DevTools|source map|favicon/i.test(t)) return
  note(stage, 'error', t.slice(0, 200))
})

/** Every interactive control, with where it actually sits. */
const controls = () => page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button,[role=button],a[href],input,select,textarea')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ')
    out.push({
      label: label.slice(0, 48),
      x: Math.round(r.x), y: Math.round(r.y),
      onScreen: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
      // An inert or aria-hidden subtree is correctly out of the tab order.
      reachable: !el.closest('[inert],[aria-hidden="true"]'),
    })
  }
  return out
})

/**
 * Visible text sitting on top of other visible text.
 *
 * Leaf elements only, and both sides have to be opaque enough to actually read
 * — a faint watermark under a label still counts, because if you can see it
 * through the label it is the bug this exists to catch.
 */
const overlaps = () => page.evaluate(() => {
  const boxes = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue
    const txt = (el.textContent || '').trim()
    if (txt.length < 2) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (+cs.opacity < 0.08) continue
    // Inert subtrees are behind a gate — covered by an overlay and unreachable.
    // Counting them reports the workspace 'colliding' with the launch screen
    // that is painted opaque on top of it.
    if (el.closest('[inert],[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue
    boxes.push({ t: txt.slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height, el })
  }
  const hits = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox <= 2 || oy <= 2) continue
      const frac = (ox * oy) / Math.min(a.w * a.h, b.w * b.h)
      if (frac < 0.35) continue
      hits.push(`"${a.t}" over "${b.t}" (${Math.round(frac * 100)}%)`)
    }
  }
  return [...new Set(hits)]
})

/**
 * The build-rule checks — C:/Dev/CLAUDE.md, made executable.
 *
 * These are the rules that cost the most review time, so they should not
 * depend on me remembering them: 48px tap targets 8px apart, no type under
 * 13px, and four z-index values with no fifth.
 */
const ruleChecks = () => page.evaluate(() => {
  const out = { touch: [], type: [], zindex: [] }
  const ALLOWED_Z = new Set(['0', '10', '20', '30', 'auto'])

  const tappable = []
  for (const el of document.querySelectorAll('button,[role=button],a[href],select,input')) {
    if (el.closest('[inert],[aria-hidden="true"]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue
    const label = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 34)
    if (r.width < 48 || r.height < 48) {
      out.touch.push(`"${label}" is ${Math.round(r.width)}x${Math.round(r.height)}, under 48x48`)
    }
    const fs = parseFloat(cs.fontSize)
    if (label && fs < 13) out.type.push(`"${label}" at ${fs}px, under 13px`)
    tappable.push({ label, r })
  }

  // 8px apart. Only pairs that actually crowd each other, not every pair.
  for (let i = 0; i < tappable.length; i++) {
    for (let j = i + 1; j < tappable.length; j++) {
      const a = tappable[i].r, b = tappable[j].r
      const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right))
      const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom))
      if (dx === 0 && dy === 0) continue                 // overlap: reported elsewhere
      const gap = dx === 0 ? dy : dy === 0 ? dx : Math.hypot(dx, dy)
      if (gap < 8) out.touch.push(`"${tappable[i].label}" and "${tappable[j].label}" are ${Math.round(gap)}px apart, under 8px`)
    }
  }

  for (const el of document.querySelectorAll('body *')) {
    const z = getComputedStyle(el).zIndex
    if (ALLOWED_Z.has(z)) continue
    // A private stacking context may order its own children; those are small
    // numbers on an element whose parent isolates.
    const parent = el.parentElement
    if (parent && getComputedStyle(parent).isolation === 'isolate') continue
    const cls = (el.className || '').toString().split(' ')[0].slice(0, 30)
    out.zindex.push(`${el.tagName.toLowerCase()}.${cls} has z-index ${z}`)
  }
  return {
    touch: [...new Set(out.touch)],
    type: [...new Set(out.type)],
    zindex: [...new Set(out.zindex)],
  }
})

async function inspect(name) {
  await page.screenshot({ path: `${SHOT}/${name}.png` })
  const cs = await controls()
  for (const c of cs) {
    if (!c.onScreen && c.reachable && c.label) {
      note(stage, 'offscreen', `"${c.label}" at (${c.x},${c.y}) is off-screen but still reachable`)
    }
  }
  for (const o of await overlaps()) note(stage, 'overlap', o)
  const rules = await ruleChecks()
  for (const m of rules.touch) note(stage, 'touch', m)
  for (const m of rules.type) note(stage, 'type', m)
  for (const m of rules.zindex) note(stage, 'zindex', m)
  return cs
}

/** Click a control by visible label, only if it is actually on screen. */
async function clickOnScreen(re, what) {
  const handle = await page.evaluateHandle((src) => {
    const rx = new RegExp(src)
    for (const el of document.querySelectorAll('button,[role=button]')) {
      const t = (el.innerText || el.getAttribute('aria-label') || '').trim()
      if (!rx.test(t)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      if (!(r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight)) continue
      return el
    }
    return null
  }, re.source)
  const el = handle.asElement()
  if (!el) {
    note(stage, 'deadEnd', `no on-screen control matching ${what ?? re}`)
    return false
  }
  await el.click()
  return true
}

// ── the beat ───────────────────────────────────────────────────────────────
stage = 'launch'
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(5000)
await inspect('01-launch')
await clickOnScreen(/^Launch$/, 'Launch')

stage = 'workspace'
await page.waitForTimeout(5000)
await inspect('02-workspace')

stage = 'preset'
// The preset panel asks one question at a time now: pick the plan, then pick
// how it opens. Drive both steps.
await clickOnScreen(/Two-Bed Bungalow/, 'a preset name')
await page.waitForTimeout(800)
await clickOnScreen(/Show it built/, 'the built option')
await page.waitForTimeout(10_000)
const afterPreset = await inspect('03-preset')

// Did the preset actually produce a model?
const model = await page.evaluate(() => {
  const s = window.__appStore?.getState?.()
  if (!s) return { store: false }
  const d = (s.drawings ?? [])[0]
  return {
    store: true,
    drawings: (s.drawings ?? []).length,
    status: d?.status ?? null,
    parsedWalls: (d?.parsedWalls ?? []).length,
    rooms: (d?.parsedRooms ?? []).length,
    storeKeys: Object.keys(s).filter((k) => /built|floor|storey|model|wall/i.test(k)),
  }
})
console.log('\nMODEL AFTER PRESET: ' + JSON.stringify(model, null, 2))
if (model.store && model.parsedWalls === 0) {
  // Practice mode strips the walls ON PURPOSE — that is what a preset is for.
  // So this is only a dead end if the app also failed to offer a way to put
  // them back; otherwise it is the designed starting point.
  const canTrace = afterPreset.some((c) => c.onScreen && /trace|draw wall/i.test(c.label))
  note(stage, canTrace ? 'note' : 'deadEnd',
    canTrace ? 'preset has 0 walls (practice mode) — tracing is offered'
             : 'preset loaded with 0 walls and no way to add any')
}

console.log('\nON-SCREEN CONTROLS AFTER PRESET:')
console.log(afterPreset.filter((c) => c.onScreen && c.label).map((c) => '  ' + c.label).join('\n'))

// ── report ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70))
const byKind = {}
for (const f of findings) (byKind[f.kind] ??= []).push(f)
for (const kind of ['error', 'deadEnd', 'overlap', 'touch', 'type', 'zindex', 'offscreen', 'note']) {
  const list = byKind[kind] ?? []
  console.log(`\n${kind.toUpperCase()} (${list.length})`)
  const seen = new Set()
  for (const f of list) {
    if (seen.has(f.msg)) continue
    seen.add(f.msg)
    console.log(`  [${f.stage}] ${f.msg}`)
  }
}
console.log(`\nshots in ${SHOT}/`)
await browser.close()
process.exit(findings.some((f) => f.kind === 'error' || f.kind === 'deadEnd') ? 1 : 0)
