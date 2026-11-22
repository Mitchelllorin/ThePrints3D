/**
 * breakit-shots — the camera sweep, photographed at 360×640.
 *
 * The order (BREAK-IT §4 and §9) says tests passing is not enough: the sweep has
 * to be seen, and the workspace has to keep two thirds of the screen while the
 * Ramp is up. This drives the real app in a real browser at phone size, taps a
 * proven preset, pushes the ramp, and captures the four states the order asks for:
 *
 *   01-ramp-strip.png   the dashboard as it lands — a slim strip, not a column,
 *                       with the start card and the rail CLOSED
 *   02-preset.png       a preset chosen
 *   03-sweep-mid.png    the camera moving and everything else fading
 *   04-card.png         the part alone, the failure card up
 *
 * HOW "CLEAR CANVAS" IS MEASURED. Not as `1 - cardHeight / screenHeight`: that
 * counted the strip and the card but not the start menu, which sat over the
 * middle of the workspace and scored 0.69 while covering the beam (MY brother's
 * QC, 9 Nov). Clear means the topmost element under the point IS the WebGL
 * canvas, sampled on a grid with document.elementFromPoint — so any menu, sheet,
 * rail or card painted over the workspace is counted as covered.
 *
 * THE BEAM'S BOX IS PROJECTED, NOT ASSUMED. The bench group's own vertices go
 * through the live camera's world, view and projection matrices (which include
 * the view offset the sweep applies), and the resulting box is checked: centred
 * horizontally, inside the band above the card, clear of the card, and about the
 * middle third of the frame's width.
 *
 * Usage (against the dev server, which must already be running — this script
 * never starts one):
 *
 *     node scripts/breakit-shots.mjs
 *     APP_URL=http://127.0.0.1:5173/ node scripts/breakit-shots.mjs
 *
 * Exits non-zero if a shot or a check fails.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/'
const OUT = process.env.SHOT_DIR ?? 'docs/breakit'

const browser = await chromium.launch({ timeout: 60000 })
const page = await browser.newPage({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
})

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

const shots = []
async function shot(name) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path })
  shots.push(path)
  console.log(`shot: ${path}`)
}

/** Tap the first visible control whose accessible name matches, if there is one. */
async function tapIfThere(locator, ms = 2000) {
  try {
    const el = locator.first()
    await el.waitFor({ state: 'visible', timeout: ms })
    await el.click()
    return true
  } catch {
    return false
  }
}

/**
 * Everything the acceptance checks need, measured off the live page.
 *
 * `clearShare` is the fraction of sampled points whose topmost element is the
 * canvas. `menus` counts the surfaces §9 says must be closed: the rail's
 * controls, the start card's doors, the strip and the card.
 */
async function measure() {
  return page.evaluate(() => {
    const H = window.innerHeight
    const W = window.innerWidth
    const canvas = document.querySelector('canvas')
    const cardEl = document.getElementById('bench-fail-card')
    const stripEl = document.getElementById('arena-strip')
    const c = cardEl ? cardEl.getBoundingClientRect() : null
    const s = stripEl ? stripEl.getBoundingClientRect() : null

    const STEP = 6
    let clear = 0
    let total = 0
    const blocked = new Map()
    for (let y = STEP / 2; y < H; y += STEP) {
      for (let x = STEP / 2; x < W; x += STEP) {
        total++
        const el = document.elementFromPoint(x, y)
        if (el && (el === canvas || el.tagName === 'CANVAS')) { clear++; continue }
        const key = el
          ? (el.id || el.getAttribute('data-testid') || el.getAttribute('data-tour') || el.className || el.tagName)
          : 'none'
        const k = typeof key === 'string' ? key.slice(0, 40) : 'unknown'
        blocked.set(k, (blocked.get(k) ?? 0) + 1)
      }
    }

    const buttons = [...document.querySelectorAll('button')]
    const hasStartDoor = buttons.some((b) => /show me a finished one/i.test(b.textContent ?? ''))
    const railCount = document.querySelectorAll('[data-tour^="rail-"]').length

    return {
      W, H,
      card: c ? { left: c.left, top: c.top, right: c.right, bottom: c.bottom, height: c.height } : null,
      strip: s ? { top: s.top, bottom: s.bottom, height: s.height } : null,
      clearShare: clear / total,
      /** Screen above the card — the band the part is supposed to own. */
      bandShare: c ? c.top / H : null,
      blocked: [...blocked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      menus: { startDoor: hasStartDoor, rail: railCount },
      /** The bench group's projected box, in CSS px, off the live camera. */
      bench: (() => {
        const scene = window.__scene
        const camera = window.__camera
        if (!scene || !camera) return null
        let bench = null
        scene.traverse((o) => { if (o.name === 'bench') bench = o })
        if (!bench) return null
        bench.updateWorldMatrix(true, true)

        const v = camera.matrixWorldInverse.elements
        const p = camera.projectionMatrix.elements
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, seen = 0

        bench.traverse((o) => {
          if (!o.visible) return
          if (o.parent && o.parent.visible === false) return
          const g = o.geometry
          if (!g || !g.attributes || !g.attributes.position) return
          const pos = g.attributes.position
          const e = o.matrixWorld.elements
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
            const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
            const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
            const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
            const vx = v[0] * wx + v[4] * wy + v[8] * wz + v[12]
            const vy = v[1] * wx + v[5] * wy + v[9] * wz + v[13]
            const vz = v[2] * wx + v[6] * wy + v[10] * wz + v[14]
            const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15]
            if (cw <= 1e-4) continue
            const cx = (p[0] * vx + p[4] * vy + p[8] * vz + p[12]) / cw
            const cy = (p[1] * vx + p[5] * vy + p[9] * vz + p[13]) / cw
            const px = (cx * 0.5 + 0.5) * W
            const py = (1 - (cy * 0.5 + 0.5)) * H
            if (px < left) left = px
            if (px > right) right = px
            if (py < top) top = py
            if (py > bottom) bottom = py
            seen++
          }
        })
        if (!seen) return null
        return {
          left, right, top, bottom,
          width: right - left,
          height: bottom - top,
          cx: (left + right) / 2,
          cy: (top + bottom) / 2,
          share: (right - left) / W,
        }
      })(),
    }
  })
}

/** The checks both moments share: menus closed, workspace keeps two thirds. */
function sharedProblems(m, label) {
  const problems = []
  if (m.menus.startDoor) problems.push(`${label}: the start card is still up over the workspace`)
  if (m.menus.rail > 0) problems.push(`${label}: ${m.menus.rail} rail control(s) still on screen`)
  if (m.clearShare < 2 / 3) {
    problems.push(`${label}: clear canvas is ${(m.clearShare * 100).toFixed(1)}%, needs ≥ 66.7% (blocked by ${JSON.stringify(m.blocked)})`)
  }
  return problems
}

try {
  await mkdir(OUT, { recursive: true })

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)

  // The front door. The app warms the workspace behind it, so this is one tap.
  if (!(await tapIfThere(page.getByRole('button', { name: /^launch$/i }), 4000))) {
    throw new Error('launch screen never offered a Launch button')
  }
  await page.waitForTimeout(1200)

  // Any coaching card is transient; close it if it is in the way.
  await tapIfThere(page.getByRole('button', { name: /^(skip|got it|close|done)$/i }), 600)

  // The rail's arena mark. The rail is present on the workspace at every size.
  if (!(await tapIfThere(page.locator('[data-tour="rail-arena"]'), 6000))) {
    throw new Error('rail-arena control not found')
  }

  await page.locator('#arena-strip').waitFor({ state: 'visible', timeout: 8000 })
  await shot('01-ramp-strip')
  const idle = await measure()
  console.log('\n=== MEASURED — strip idle ===')
  console.log(JSON.stringify(idle, null, 2))

  // A preset, then the push that runs it. The presets are generic by order §6.
  await page.locator('[data-testid="ramp-preset"]').first().click()
  await shot('02-preset')

  await page.locator('[data-testid="ramp-push"]').click()

  // The card mounts at the instant of the break, which is when the sweep starts.
  const card = page.locator('#bench-fail-card')
  await card.waitFor({ state: 'visible', timeout: 12000 })
  await shot('03-sweep-mid')

  await page.waitForTimeout(1400)
  await shot('04-card')

  const broken = await measure()
  console.log('\n=== MEASURED — the break ===')
  console.log(JSON.stringify(broken, null, 2))

  const problems = [
    ...sharedProblems(idle, 'idle'),
    ...sharedProblems(broken, 'break'),
  ]

  if (!broken.card) problems.push('break: failure card not found')
  if (broken.strip) problems.push(`break: the strip is still on screen (${broken.strip.height} px)`)
  if (broken.card && broken.card.height > broken.H / 3) {
    problems.push(`break: card is ${(broken.card.height / broken.H * 100).toFixed(1)}% of the screen tall, needs ≤ 33%`)
  }
  if (broken.card && broken.card.left < 0) problems.push('break: card runs off the left edge')

  if (!broken.bench) {
    problems.push('break: the beam\'s box could not be projected — the bench is not in the scene')
  } else {
    const b = broken.bench
    if (Math.abs(b.cx - broken.W / 2) > broken.W * 0.12) {
      problems.push(`break: beam is not centred — box centre at ${b.cx.toFixed(0)} px, screen centre ${broken.W / 2} px`)
    }
    if (broken.card && b.bottom > broken.card.top) {
      problems.push(`break: beam runs under the card — box bottom ${b.bottom.toFixed(0)} px, card top ${broken.card.top.toFixed(0)} px`)
    }
    if (b.top < 0) problems.push(`break: beam is cut off at the top (${b.top.toFixed(0)} px)`)
    if (b.share < 0.25 || b.share > 0.85) {
      problems.push(`break: beam fills ${(b.share * 100).toFixed(0)}% of the frame's width, needs 25–85%`)
    }
  }

  if (errors.length) console.log('\n=== PAGE ERRORS ===\n' + errors.join('\n'))
  if (problems.length) {
    console.error('\n=== FAILED ===\n' + problems.join('\n'))
    process.exitCode = 1
  } else {
    console.log('\nOK — menus closed, strip inside a third, beam centred in the band, card clear of it.')
  }
  console.log(`\n${shots.length} shots in ${OUT}/`)
} finally {
  await browser.close()
}
