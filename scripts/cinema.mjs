/**
 * CINEMA — render the shot library to video files.
 *
 * Drives the real app in a real browser, steps the shot clock by hand, and
 * shutters one PNG per frame; ffmpeg turns the sequence into an mp4. What comes
 * out is footage of the actual product, because the thing on camera is the same
 * build a user installs — no pre-rendered scene, no mock-up, no model that was
 * touched up to look better than what the app produces.
 *
 *   node scripts/cinema.mjs --url http://localhost:5173/
 *   node scripts/cinema.mjs --only hero,explode --headed
 *   node scripts/cinema.mjs --stills          # key frames as PNGs, for listings
 *
 * WHY IT STEPS THE CLOCK INSTEAD OF RECORDING THE SCREEN.
 *
 * A screen recording runs at whatever rate the machine manages, and a
 * screenshot through CDP costs tens of milliseconds — so a real-time capture of
 * a WebGL scene on a laptop is a juddering five frames a second, and the only
 * fixes are a faster machine or a shorter shot. Here, scene time and capture
 * time are unrelated: the recorder advances the shot by exactly 1/60s, waits
 * for that frame to actually render, and takes as long as it needs over the
 * screenshot. Every output file is a clean 60fps whatever the hardware did,
 * and the same command produces the same frames on any machine.
 *
 * THE ONE THING THAT MUST NOT BE GOT WRONG is shuttering before the new pose
 * has rendered — it yields the previous frame, which on a slow move is
 * invisible and everywhere else is a stutter nobody can trace from the file.
 * So the page hands back a rendered-frame counter and every shutter waits on
 * it. See `__cinema.rendered()`.
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const has = (n) => args.includes(n)

const URL_ = flag('--url', 'http://localhost:5173/')
const OUT = flag('--out', 'media/cinema')
const FPS = Number(flag('--fps', 60))
const ONLY = flag('--only', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const SCALE = Number(flag('--scale', 1.5))
const HEADED = has('--headed')
const STILLS = has('--stills')
const KEEP = has('--keep-frames')
const GIF = has('--gif')

/**
 * Base frame sizes, multiplied by --scale for the real output.
 *
 * 1280x720 at scale 1.5 is 1920x1080 — the size everything downstream wants,
 * arrived at by rendering the scene at device-pixel-ratio 1.5 rather than by
 * upscaling a small render, so the geometry is genuinely sharp at 1080p.
 */
const FRAMES = {
  wide: { width: 1280, height: 720 },
  vertical: { width: 720, height: 1280 },
  square: { width: 900, height: 900 },
}

/** Preset plan → the label on its card in the app. */
const PLAN_LABEL = {
  easy: 'Two-Bed Bungalow',
  medium: 'Three-Bed Ranch',
  hard: 'Two-Storey with Garage',
}

const log = (...m) => console.log(...m)

function ffmpeg(ffArgs, what) {
  const r = spawnSync('ffmpeg', ffArgs, { encoding: 'utf8' })
  if (r.error) throw new Error(`ffmpeg not found on PATH — needed to encode ${what}`)
  if (r.status !== 0) {
    const tail = (r.stderr || '').trim().split('\n').slice(-6).join('\n')
    throw new Error(`ffmpeg failed on ${what}:\n${tail}`)
  }
}

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    // Headless Chromium falls back to SwiftShader for WebGL, which renders
    // everything correctly and slowly. That is an acceptable trade here —
    // capture is already decoupled from real time, so slow frames cost wall
    // clock and change nothing about the output. --headed borrows the real GPU
    // when one is available and is several times quicker.
    '--use-gl=angle',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
})

const manifest = []
let failures = 0

try {
  // One page per shot: the viewport differs per aspect, the preset plan differs
  // per shot, and unloading between takes is the only way to be certain shot N
  // did not inherit a stray panel or a half-consumed camera preset from N-1.
  const first = await openPage(FRAMES.wide)
  const catalogue = await first.evaluate(() => window.__cinema.list())
  await first.context().close()

  const wanted = ONLY ? catalogue.filter((s) => ONLY.includes(s.id)) : catalogue
  if (ONLY) {
    const missing = ONLY.filter((id) => !catalogue.some((s) => s.id === id))
    for (const m of missing) log(`  ! no shot "${m}" in the library`)
  }
  log(`\nrendering ${wanted.length} shot(s) at ${FPS}fps into ${OUT}/\n`)

  for (const entry of wanted) {
    try {
      await renderShot(entry)
    } catch (err) {
      failures++
      log(`  ✗ ${entry.id}: ${err.message}`)
    }
  }
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))

log('\n' + '='.repeat(64))
for (const m of manifest) {
  log(`  ${m.id.padEnd(15)} ${m.frames} frames  ${m.width}x${m.height}  ${m.seconds}s  ${m.file}`)
}
if (failures) log(`\n${failures} shot(s) failed`)
log(`\nmanifest: ${join(OUT, 'manifest.json')}`)
process.exit(failures ? 1 : 0)

// ── the work ───────────────────────────────────────────────────────────────

/**
 * Open the app at a given frame size and get it to a built model.
 *
 * Everything here is the ordinary user path — Launch, pick a plan, show it
 * built — rather than injecting state through the store. Driving the real path
 * means the footage cannot show a model the app could not actually produce,
 * and it means this script breaks loudly when that path breaks, which is worth
 * more than a capture that keeps working over a front door that does not.
 */
async function openPage(frame, plan = 'medium') {
  const ctx = await browser.newContext({
    viewport: { width: frame.width, height: frame.height },
    deviceScaleFactor: SCALE,
    // Never a mobile context: the app opens closer and steeper on phone widths
    // and the storyboards are composed for the desktop framing. A vertical
    // shot is a tall DESKTOP window, not a phone.
    isMobile: false,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await click(page, /^Launch$/)
  await page.waitForTimeout(1500)

  const label = PLAN_LABEL[plan] ?? PLAN_LABEL.medium
  if (!(await click(page, new RegExp(label)))) {
    throw new Error(`preset "${label}" not offered — did the workspace open?`)
  }
  await page.waitForTimeout(600)
  if (!(await click(page, /Show it built/))) {
    throw new Error('"Show it built" not offered after picking the plan')
  }

  await page.waitForFunction(() => typeof window.__cinema?.measure === 'function', { timeout: 60_000 })

  /**
   * WAIT FOR GEOMETRY, NOT FOR A STATUS FLAG.
   *
   * `model.status` stays 'idle' down the preset path even once a complete
   * building is standing in the scene — the flag tracks the BUILD pipeline a
   * traced drawing goes through, and a preset does not go through it. Waiting
   * on it waits out the full timeout on a scene that finished a minute ago.
   *
   * So poll what a shot actually needs: something to point the camera at. The
   * measured radius grows as storeys and the roof arrive and then stops, so
   * three identical readings in a row means the model is done, whatever any
   * flag says.
   */
  const settled = await page.waitForFunction(() => {
    const w = window
    const r = window.__cinema.measure().radius
    w.__cineLast = w.__cineLast ?? []
    w.__cineLast.push(Math.round(r * 100))
    if (w.__cineLast.length > 3) w.__cineLast.shift()
    const [a, b, c] = w.__cineLast
    return w.__cineLast.length === 3 && a === b && b === c && r > 1.01 ? r : false
  }, null, { timeout: 90_000, polling: 400 }).then((h) => h.jsonValue()).catch(() => null)

  if (!settled) throw new Error('no model in the scene — the preset never built')
  // One more beat so shadows and any late material swap have landed.
  await page.waitForTimeout(800)

  if (errors.length) log(`  ! page errors during setup: ${errors.slice(0, 3).join(' | ')}`)
  return page
}

/** Click the first on-screen control whose label matches. */
async function click(page, re) {
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
  if (!el) return false
  await el.click()
  return true
}

async function renderShot(entry) {
  const t0 = Date.now()
  const page = await openPage(FRAMES.wide, entry.plan)

  // The shot's own aspect decides the frame. Re-opening rather than resizing:
  // a resize mid-session updates the camera's projection aspect but the
  // auto-frame has already been spent, so the model sits off-centre for the
  // whole take and nothing on screen says why.
  const aspect = FRAMES[entry.aspect] ? entry.aspect : 'wide'
  let target = page
  if (aspect !== 'wide') {
    await page.context().close()
    target = await openPage(FRAMES[aspect], entry.plan)
  }

  const frame = FRAMES[aspect]
  const width = Math.round(frame.width * SCALE)
  const height = Math.round(frame.height * SCALE)

  const armed = await target.evaluate((id) => window.__cinema.arm(id), entry.id)
  if (!armed.ok) throw new Error(armed.reason ?? 'arm failed')
  // The fallback radius is 8 and means measureFrame() found no model at all.
  // Failing here rather than rendering is deliberate: a take of an empty grid
  // looks like a successful run until somebody opens the file.
  if (!armed.radius || armed.radius <= 1.01) {
    throw new Error(`measured radius ${armed.radius} — the scene looks empty`)
  }

  /**
   * FIT TO THE MODEL AT ITS WIDEST, NOT AS IT SITS.
   *
   * Pose the shot at its peak explode, let it render there, and measure again.
   * The director then interpolates the framing between assembled and apart by
   * the live explode value, so the opening stays tight and nothing leaves the
   * frame at full separation. Skipped when a shot never explodes — there is
   * nothing to measure a second time.
   */
  if (armed.peakExplode > 0.02) {
    const before = await target.evaluate((at) => {
      window.__cinema.seek(at)
      return window.__cinema.rendered()
    }, armed.peakAt)
    await target.waitForFunction((n) => window.__cinema.rendered() >= n + 3, before, { timeout: 15_000 })
    const apart = await target.evaluate(() => window.__cinema.refit())
    log(`    refit at ${armed.peakExplode.toFixed(2)} explode: radius ${apart.toFixed(1)}`)
  }

  const frameDir = join(OUT, `.frames-${entry.id}`)
  rmSync(frameDir, { recursive: true, force: true })
  mkdirSync(frameDir, { recursive: true })

  const total = Math.round(entry.duration * FPS)
  log(`  ${entry.id} — ${entry.title} · ${entry.duration}s · ${total} frames · ${width}x${height} · r=${armed.radius.toFixed(1)}`)

  const stills = STILLS ? [0.12, 0.5, 0.88].map((p) => Math.round(total * p)) : []

  for (let i = 0; i < total; i++) {
    const t = i / FPS
    // Seek, then wait for the page to actually paint it. Two frames rather than
    // one: the bridge's counter ticks in its own useFrame, which runs BEFORE
    // the one that puts the pose on the camera, so the first tick after a seek
    // can still belong to the old pose.
    const before = await target.evaluate((time) => {
      window.__cinema.seek(time)
      return window.__cinema.rendered()
    }, t)
    await target.waitForFunction((n) => window.__cinema.rendered() >= n + 2, before, { timeout: 15_000 })

    const path = join(frameDir, `${String(i).padStart(5, '0')}.png`)
    await target.screenshot({ path, animations: 'disabled' })

    if (stills.includes(i)) {
      const still = join(OUT, `still-${entry.id}-${String(i).padStart(5, '0')}.png`)
      await target.screenshot({ path: still, animations: 'disabled' })
    }
    if (i % 60 === 0 && i) process.stdout.write(`    ${i}/${total}\r`)
  }

  await target.evaluate(() => window.__cinema.strike())
  await target.context().close()

  const mp4 = join(OUT, `${entry.id}.mp4`)
  ffmpeg([
    '-y', '-framerate', String(FPS),
    '-i', join(frameDir, '%05d.png'),
    // yuv420p and even dimensions, or the file plays in ffplay and nowhere
    // else — Safari, Windows' player and most social uploaders all reject
    // 4:4:4 h264, and they reject it silently.
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    mp4,
  ], `${entry.id}.mp4`)

  if (GIF) {
    // Two passes through ffmpeg: a palette built from the whole clip, then the
    // encode against it. A single-pass gif of a 3D render bands horribly —
    // the default 216-colour web palette cannot hold a soft gradient.
    const pal = join(frameDir, 'palette.png')
    ffmpeg(['-y', '-i', mp4, '-vf', 'fps=24,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff', pal], 'gif palette')
    ffmpeg([
      '-y', '-i', mp4, '-i', pal,
      '-lavfi', 'fps=24,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
      join(OUT, `${entry.id}.gif`),
    ], `${entry.id}.gif`)
  }

  if (!KEEP) rmSync(frameDir, { recursive: true, force: true })

  manifest.push({
    id: entry.id,
    title: entry.title,
    plan: entry.plan,
    frames: total,
    fps: FPS,
    seconds: entry.duration,
    width,
    height,
    radius: Number(armed.radius.toFixed(2)),
    file: mp4,
    renderedIn: `${Math.round((Date.now() - t0) / 1000)}s`,
  })
  log(`    ✓ ${mp4}  (${Math.round((Date.now() - t0) / 1000)}s)`)
}
