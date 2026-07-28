// Diagnose door/window DISAPPEARING.
//
// A door renders as a thin 0.06m panel sitting ON the wall centreline, so it is
// only visible through the opening the wall cuts for it. If openingsByWall fails
// to match the door to a wall, no opening is cut and the door is buried inside
// solid framing — which is exactly what "it disappeared" looks like.
//
// This seeds a known rectangle of user walls, drops a door at the exact midpoint
// of each one, and re-runs LiveWallsLayer's matching maths to report per wall
// whether the opening would be cut, and if not, WHICH gate rejected it.
// Run: node scripts/door-verify.mjs      (dev server on 5180)
import { chromium } from 'playwright'

const url = process.env.UI_URL ?? 'http://localhost:5180/'
const browser = await chromium.launch({ channel: 'chrome' })
// Desktop viewport: the preset buttons sit off-screen on a phone and this
// diagnostic is about geometry, not layout.
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3000)
// The preset button lives inside a retracted edge drawer, so it is off-viewport
// and a real click never lands — dispatchEvent bypasses that check.
for (const b of await page.getByRole('button', { name: 'Easy Starter Cottage', exact: true }).all()) {
  await b.dispatchEvent('click').catch(() => {})
}
await page.waitForFunction(() => (window.__appStore?.getState?.().drawings ?? []).length > 0, { timeout: 30000 })
await page.waitForTimeout(3000)

const report = await page.evaluate(() => {
  const s = window.__appStore.getState()
  const drawing = s.drawings[0]
  const id = drawing.id
  const rw = drawing.rasterWidth ?? 1400, rh = drawing.rasterHeight ?? 900

  // Seed a clean rectangle of user walls (what tracing produces).
  const m = 0.2
  const x1 = Math.round(rw * m), x2 = Math.round(rw * (1 - m))
  const y1 = Math.round(rh * m), y2 = Math.round(rh * (1 - m))
  const mk = (ax, ay, bx, by) => ({ x1: ax, y1: ay, x2: bx, y2: by, thickness: 8, level: 0 })
  s.addUserTracedWalls(id, [
    mk(x1, y1, x2, y1), mk(x2, y1, x2, y2), mk(x2, y2, x1, y2), mk(x1, y2, x1, y1),
  ])

  const st = window.__appStore.getState()
  const d2 = st.drawings.find((d) => d.id === id)
  const overlay = st.floorplanOverlay
  const imageWidth = d2.rasterWidth ?? 1400, imageHeight = d2.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = (overlay.rotationDeg * Math.PI) / 180
  const pixelToWorld = (px, py) => {
    const lx = ((px / imageWidth) - 0.5) * overlayW
    const lz = ((py / imageHeight) - 0.5) * overlayD
    const c = Math.cos(rotRad), sn = Math.sin(rotRad)
    return { x: overlay.position[0] + (lx * c + lz * sn), z: overlay.position[1] + (-lx * sn + lz * c) }
  }

  const all = []
  for (const dd of st.drawings) for (const w of dd.parsedWalls) if (w.source === 'user') all.push(w)
  const wsegs = all.map((w) => {
    const p = pixelToWorld(w.x1, w.y1), q = pixelToWorld(w.x2, w.y2)
    return { ax: p.x, az: p.z, dx: q.x - p.x, dz: q.z - p.z, thick: w.thickness, level: w.level ?? 0 }
  })
  const mPerPx = (overlayW / imageWidth + overlayD / imageHeight) / 2

  // Drop a door at the midpoint of every wall, then match it back.
  const out = []
  wsegs.forEach((target, wi) => {
    const mid = { x: target.ax + target.dx / 2, z: target.az + target.dz / 2 }
    const oid = 'diag-door-' + wi
    window.__appStore.getState().addPlacedObject({
      id: oid, type: 'door', x: mid.x, z: mid.z, rotationY: 0,
      scaleX: 1, scaleZ: 1, scaleY: 1, label: 'Door',
    })
    const placed = window.__appStore.getState().placedObjects.find((o) => o.id === oid)
    const objLevel = placed?.level ?? 0

    let best = -1, bestScore = Infinity, why = []
    wsegs.forEach((sg, i) => {
      const len2 = sg.dx * sg.dx + sg.dz * sg.dz
      if (len2 < 1e-6) return
      const t = ((mid.x - sg.ax) * sg.dx + (mid.z - sg.az) * sg.dz) / len2
      const fx = sg.ax + t * sg.dx, fz = sg.az + t * sg.dz
      const perp = Math.hypot(mid.x - fx, mid.z - fz)
      const thresh = Math.max((sg.thick || 8) * 2.5, 28) * mPerPx
      const levelOk = sg.level === objLevel, tOk = t >= -0.02 && t <= 1.02, perpOk = perp < thresh
      if (i === wi) why = [{ self: true, level: sg.level, objLevel, t: +t.toFixed(3), perp: +perp.toFixed(4), thresh: +thresh.toFixed(4), levelOk, tOk, perpOk }]
      if (levelOk && tOk && perpOk && perp < bestScore) { bestScore = perp; best = i }
    })
    out.push({ wall: wi, placedLevel: placed?.level, matched: best, matchedSelf: best === wi, gate: why[0] })
  })

  return {
    wallCount: all.length,
    wallLevels: all.map((w) => w.level ?? 0),
    mPerPx: +mPerPx.toFixed(5),
    overlayScale: overlay.scale,
    raster: [imageWidth, imageHeight],
    results: out,
  }
})

console.log(JSON.stringify(report, null, 2))
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none')
const bad = (report.results ?? []).filter((r) => !r.matchedSelf)
console.log(bad.length === 0
  ? `RESULT: all ${report.results.length} doors matched their own wall — opening cut, door visible`
  : `RESULT: ${bad.length}/${report.results.length} doors did NOT match their wall → buried/invisible`)

await ctx.close()
await browser.close()
