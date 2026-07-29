// Why is door/window placement STILL intermittent after the rayToWall fix?
//
// rayToWall only raycasts `placementWalls` — walls on the ACTIVE level. If
// activeLevel does not match the level of the walls you can see, the ray hits
// nothing and it falls back to rayToGround — the original y=0 parallax bug.
// activeLevel persists across layer switches, so it can silently be 1 while you
// are working on the ground floor. That would look exactly like "intermittent,
// no rhyme or reason".
//
// This clicks the SAME screen point twice — once with activeLevel matching the
// walls, once not — and reports where the door landed each time. No screen
// projection needed: the two results only differ if activeLevel is the cause.
//
// Run: node scripts/place-matrix.mjs      (dev server on 5180)
import { chromium } from 'playwright'

const url = process.env.UI_URL ?? 'http://localhost:5180/'
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))
const plog = []
page.on('console', (m) => { const t = m.text(); if (t.includes('PLACE-DBG')) plog.push(t) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3000)
for (const b of await page.getByRole('button', { name: 'Easy Starter Cottage', exact: true }).all()) {
  await b.dispatchEvent('click').catch(() => {})
}
await page.waitForFunction(() => (window.__appStore?.getState?.().drawings ?? []).length > 0, { timeout: 30000 })
await page.waitForTimeout(2500)

// Walls on LEVEL 0 ONLY.
await page.evaluate(() => {
  const S = () => window.__appStore.getState()
  const d = S().drawings[0]
  const mk = (ax, ay, bx, by) => ({ x1: ax, y1: ay, x2: bx, y2: by, thickness: 8, level: 0 })
  S().clearTracingForDrawing(d.id)
  S().addUserTracedWalls(d.id, [
    mk(300, 200, 900, 200), mk(900, 200, 900, 700),
    mk(900, 700, 300, 700), mk(300, 700, 300, 200),
  ])
})
await page.waitForTimeout(1200)

const box = await page.locator('canvas').first().boundingBox()
// A spread of points over the model — we do not need to know which is on a wall,
// only whether the SAME point behaves differently as activeLevel changes.
const POINTS = [[0.42, 0.34], [0.55, 0.30], [0.38, 0.55], [0.62, 0.52], [0.50, 0.62]]

const measure = async (level, fx, fy) => {
  await page.evaluate((lv) => {
    const S = window.__appStore.getState()
    for (const o of [...S.placedObjects]) S.removePlacedObject?.(o.id)
    window.__floorplanLocalStore.getState().setActiveLevel?.(lv)
    window.__floorplanLocalStore.getState().armPlaceExclusive('door')
  }, level)
  await page.waitForTimeout(250)
  const armedBefore = await page.evaluate(() => window.__floorplanLocalStore.getState().placeObjectType)
  const sx = box.x + fx * box.width, sy = box.y + fy * box.height
  await page.mouse.move(sx, sy)
  const afterMove = await page.evaluate(() => window.__floorplanLocalStore.getState().placeObjectType)
  await page.mouse.down()
  const afterDown = await page.evaluate(() => window.__floorplanLocalStore.getState().placeObjectType)
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(350)
  const afterUp = await page.evaluate(() => window.__floorplanLocalStore.getState().placeObjectType)
  const trace = { armedBefore, afterMove, afterDown, afterUp, log: plog.splice(0) }
  return page.evaluate(() => {
    const S = window.__appStore.getState()
    const o = S.placedObjects[S.placedObjects.length - 1]
    if (!o) return { placed: false }
    const d = S.drawings[0], ov = S.floorplanOverlay
    const iw = d.rasterWidth, ih = d.rasterHeight, [ow, od] = ov.scale
    const rot = ov.rotationDeg * Math.PI / 180
    const p2w = (px, py) => {
      const lx = ((px / iw) - 0.5) * ow, lz = ((py / ih) - 0.5) * od
      const c = Math.cos(rot), s = Math.sin(rot)
      return { x: ov.position[0] + (lx * c + lz * s), z: ov.position[1] + (-lx * s + lz * c) }
    }
    const walls = d.parsedWalls.filter((x) => x.source === 'user')   // all are level 0
    let best = Infinity
    for (const w of walls) {
      const a = p2w(w.x1, w.y1), b = p2w(w.x2, w.y2)
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz
      let t = ((o.x - a.x) * dx + (o.z - a.z) * dz) / L2
      t = Math.max(0, Math.min(1, t))
      best = Math.min(best, Math.hypot(o.x - (a.x + t * dx), o.z - (a.z + t * dz)))
    }
    return { placed: true, x: +o.x.toFixed(2), z: +o.z.toFixed(2), objLevel: o.level, perp: +best.toFixed(3) }
  }).then((r) => ({ ...r, trace }))
}

const rows = []
for (const [fx, fy] of POINTS) {
  const atMatching = await measure(0, fx, fy)   // activeLevel 0 == the walls
  const atMismatch = await measure(1, fx, fy)   // activeLevel 1 != the walls
  rows.push({
    point: `${fx},${fy}`,
    activeLevel0: atMatching,
    activeLevel1: atMismatch,
    differs: atMatching.placed && atMismatch.placed
      && (Math.abs(atMatching.x - atMismatch.x) > 0.05 || Math.abs(atMatching.z - atMismatch.z) > 0.05),
  })
}

console.log(JSON.stringify(rows, null, 1))
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none')
const diff = rows.filter((r) => r.differs).length
const missed0 = rows.filter((r) => r.activeLevel0.placed && r.activeLevel0.perp > 0.28).length
const missed1 = rows.filter((r) => r.activeLevel1.placed && r.activeLevel1.perp > 0.28).length
console.log(`activeLevel changed the landing spot on ${diff}/${rows.length} identical clicks`)
console.log(`missed the wall (>0.28m): activeLevel 0 -> ${missed0}/${rows.length} | activeLevel 1 -> ${missed1}/${rows.length}`)
await ctx.close(); await browser.close()
