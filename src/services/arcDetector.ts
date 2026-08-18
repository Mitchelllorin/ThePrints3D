/**
 * THE MOST DISTINCTIVE MARK ON A FLOOR PLAN IS THE ONE WE NEVER READ.
 *
 * Doors are currently found as GAPS between two correctly-detected walls. That
 * makes the clearest symbol on the sheet depend on the least reliable one: on a
 * screenshot, wall lines are a few pixels of line weight and fragment badly, so
 * the doors go with them. On the ADU capture in data/test-prints/ the detector
 * found two openings where the drawing shows six.
 *
 * But every one of those doors is also drawn as a quarter-circle swing, and an
 * arc is unmistakable in a way a wall is not. A wall is a dark rectangle among
 * hundreds of dark rectangles; a circular arc is the only curve on an otherwise
 * straight-line drawing. It is worth four separate things:
 *
 *   WHERE the door is       - the arc's centre is the hinge
 *   HOW WIDE it is          - the radius IS the door width
 *   WHICH WAY the wall runs - the arc's straight edge lies along it
 *   WHAT THE SCALE IS       - a door leaf is 700-900mm nearly everywhere, so a
 *                             radius in pixels converts straight to mm/px
 *
 * That last one matters most. Scale is the error that poisons everything
 * downstream (see scaleInference), and a door is a far better ruler than a wall
 * thickness, because a door's real width barely varies while a "wall" on a
 * screenshot is whatever line weight the drawing was published at.
 *
 * HOW IT WORKS. Gradient-based circular Hough, the standard answer and cheap
 * enough here. At a point on a circle the intensity gradient points along the
 * radius, so the centre must lie at distance r to one side or the other. Every
 * edge pixel therefore votes for just two centres per candidate radius rather
 * than a whole ring, which keeps it O(pixels x radii). Peaks in the accumulator
 * are candidate centres; each is then CHECKED by walking the circle and
 * measuring how much of it is actually inked, because a door swing is a quarter
 * of a circle and a dot, a fixture or the end of a bath is not.
 *
 * Pure: numbers in, numbers out, no DOM. Same RasterLike as rasterNormalize.
 */

import type { RasterLike } from './rasterNormalize'
import { grayHistogram, otsuThreshold } from './rasterNormalize'

export interface DetectedArc {
  /** Hinge point - the centre of the circle the swing is part of. */
  cx: number
  cy: number
  /** Radius in pixels. For a door swing this is the leaf width. */
  r: number
  /** How much of the FULL circle is inked, 0..1. A quarter swing is ~0.25. */
  coverage: number
  /** Angular extent actually drawn, in degrees. */
  sweepDeg: number
  /** Where the drawn part starts and ends, in degrees (0 = +x, y down). */
  startDeg: number
  endDeg: number
  /** Fraction of the swept span that is inked - how clean the arc is. */
  solidity: number
}

export interface ArcDetectorOptions {
  minRadiusPx?: number
  maxRadiusPx?: number
  radiusStepPx?: number
  /** A swing is a quarter circle; allow a generous band around that. */
  minSweepDeg?: number
  maxSweepDeg?: number
  /** Of the swept span, how much must actually be inked to accept it. */
  minSolidity?: number
  /** Gradient magnitude below this is not an edge. */
  edgeThreshold?: number
  maxResults?: number
}

/** Grey value at a pixel, Rec.601. Off-image reads as paper. */
function grayAt(img: RasterLike, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 255
  const o = (y * img.width + x) * 4
  return 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]
}

/**
 * Walk a candidate circle and report the longest continuous inked run on it.
 *
 * This is what separates a swing from a coincidence. The Hough stage will
 * happily nominate the centre of anything roughly round - a toilet bowl, the
 * end of a bath, the middle of a dining table - so the answer is checked
 * against the drawing: step around the circle, note which steps are inked, and
 * keep the longest unbroken stretch. A door swing gives about ninety degrees of
 * solid arc; a full circle gives three hundred and sixty; noise gives a scatter
 * of short pieces that never joins up.
 */
/** Share of a circle of radius `rad` about (cx,cy) that lands on ink. */
function ringInkRatio(img: RasterLike, cx: number, cy: number, rad: number, inkLevel: number): number {
  if (rad < 2) return 0
  const steps = Math.max(48, Math.round(2 * Math.PI * rad))
  let on = 0
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * 2 * Math.PI
    const x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a)
    if (
      grayAt(img, Math.round(x), Math.round(y)) <= inkLevel ||
      grayAt(img, Math.round(x + 0.5), Math.round(y)) <= inkLevel ||
      grayAt(img, Math.round(x), Math.round(y + 0.5)) <= inkLevel
    ) on++
  }
  return on / steps
}

/**
 * A CIRCLE IS THIN. That is the property that separates one from everything
 * else round-ish on a plan, and the check this detector lives or dies by.
 *
 * Walking a candidate circle and asking "is there ink here" is not enough: a
 * straight wall that runs tangent to the circle hugs it for a surprising
 * distance, so a plain rectangle nominated twenty-six arcs. But a wall is ink
 * at every radius near the tangent point, while a drawn arc is ink at ITS
 * radius and paper a few pixels either side. Comparing the ring against the
 * rings just inside and outside it is what tells them apart — and it also
 * pins the radius, because the contrast peaks at the true one.
 */
function ringContrast(img: RasterLike, cx: number, cy: number, r: number, inkLevel: number): number {
  const on = ringInkRatio(img, cx, cy, r, inkLevel)
  const inner = ringInkRatio(img, cx, cy, r - 4, inkLevel)
  const outer = ringInkRatio(img, cx, cy, r + 4, inkLevel)
  return on - Math.max(inner, outer)
}

/**
 * LEAST-SQUARES CIRCLE THROUGH THE INK ITSELF (Kasa fit).
 *
 * Neither the vote cloud nor the ring metric can pin a QUARTER circle, and the
 * reason is geometric rather than a matter of tuning: slide the centre along
 * the arc's bisector and grow the radius to match, and the new circle still
 * passes through every drawn pixel almost exactly. On a 30px swing that
 * degeneracy showed up as centre (43,43) radius 26 — a 13% error in the one
 * number the whole feature exists to provide.
 *
 * Fitting all of the arc's pixels at once resolves it, because the fit has to
 * satisfy the two ENDS as well as the middle, and those are what the shifted
 * circle gets wrong. Kasa minimises |x^2 + y^2 + Dx + Ey + F| over the points,
 * which is linear and so needs no iteration — three sums and a 3x3 solve.
 *
 * It is biased toward small radii when a fit is one-sided, which is why the
 * coarse Hough stage still matters: it supplies a centre good enough that the
 * points gathered around it belong to one arc and nothing else.
 */
function fitCircle(pts: { x: number; y: number }[]): { cx: number; cy: number; r: number } | null {
  const n = pts.length
  if (n < 8) return null
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y
    sx += p.x; sy += p.y; sz += z
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y
    sxz += p.x * z; syz += p.y * z
  }
  // Normal equations for D, E, F.
  const a11 = sxx, a12 = sxy, a13 = sx
  const a21 = sxy, a22 = syy, a23 = sy
  const a31 = sx, a32 = sy, a33 = n
  const b1 = -sxz, b2 = -syz, b3 = -sz
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31)
  if (Math.abs(det) < 1e-9) return null
  const D =
    (b1 * (a22 * a33 - a23 * a32) -
      a12 * (b2 * a33 - a23 * b3) +
      a13 * (b2 * a32 - a22 * b3)) / det
  const E =
    (a11 * (b2 * a33 - a23 * b3) -
      b1 * (a21 * a33 - a23 * a31) +
      a13 * (a21 * b3 - b2 * a31)) / det
  const F =
    (a11 * (a22 * b3 - b2 * a32) -
      a12 * (a21 * b3 - b2 * a31) +
      b1 * (a21 * a32 - a22 * a31)) / det
  const cx = -D / 2, cy = -E / 2
  const rsq = cx * cx + cy * cy - F
  if (!(rsq > 0)) return null
  return { cx, cy, r: Math.sqrt(rsq) }
}

/** Ink pixels lying in an annulus about a coarse centre — the arc's own points. */
function inkNearRing(
  img: RasterLike, cx: number, cy: number, r: number, inkLevel: number, band = 4,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const lo = Math.max(0, Math.floor(cy - r - band)), hi = Math.min(img.height - 1, Math.ceil(cy + r + band))
  const xl = Math.max(0, Math.floor(cx - r - band)), xh = Math.min(img.width - 1, Math.ceil(cx + r + band))
  for (let y = lo; y <= hi; y++) {
    for (let x = xl; x <= xh; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d < r - band || d > r + band) continue
      if (grayAt(img, x, y) <= inkLevel) pts.push({ x, y })
    }
  }
  return pts
}

function measureArc(
  img: RasterLike,
  cx: number,
  cy: number,
  r: number,
  inkLevel: number,
  minSweepDeg: number,
  maxSweepDeg: number,
  minSolidity: number,
): DetectedArc | null {
  // Reject before doing the expensive walk: if the neighbouring rings are as
  // inked as this one, whatever is here is not a thin curve.
  if (ringContrast(img, cx, cy, r, inkLevel) < 0.12) return null

  const steps = Math.max(72, Math.round(2 * Math.PI * r))
  const hit: boolean[] = new Array(steps)
  let inked = 0
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * 2 * Math.PI
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    // Half-pixel tolerance: a stroke has width, and the circle being walked is
    // an approximation of where its centreline runs.
    const on =
      grayAt(img, Math.round(x), Math.round(y)) <= inkLevel ||
      grayAt(img, Math.round(x + 0.5), Math.round(y)) <= inkLevel ||
      grayAt(img, Math.round(x), Math.round(y + 0.5)) <= inkLevel
    hit[s] = on
    if (on) inked++
  }
  if (inked === 0) return null

  // Longest continuous run, wrapping - a swing can straddle zero degrees.
  let bestLen = 0
  let bestStart = 0
  let len = 0
  let start = 0
  for (let s = 0; s < steps * 2; s++) {
    const k = s % steps
    if (hit[k]) {
      if (len === 0) start = k
      len++
      if (len > bestLen) {
        bestLen = len
        bestStart = start
      }
    } else {
      len = 0
    }
  }
  if (bestLen > steps) bestLen = steps

  const sweepDeg = (bestLen / steps) * 360
  if (sweepDeg < minSweepDeg || sweepDeg > maxSweepDeg) return null

  let spanInked = 0
  for (let s = 0; s < bestLen; s++) if (hit[(bestStart + s) % steps]) spanInked++
  const solidity = spanInked / bestLen
  if (solidity < minSolidity) return null

  const startDeg = (bestStart / steps) * 360
  return {
    cx,
    cy,
    r,
    coverage: inked / steps,
    sweepDeg,
    startDeg,
    endDeg: (startDeg + sweepDeg) % 360,
    solidity,
  }
}

/**
 * Find circular arcs. Strongest first.
 *
 * Deliberately reports ARCS, not doors. Deciding which of them is a door swing
 * needs the walls and the rest of the plan and belongs to the caller - a
 * detector that quietly decides what it found is impossible to test and
 * impossible to reuse for anything else. A round table reads the same way here,
 * and knowing where the round tables are is also useful.
 */
export function detectArcs(img: RasterLike, options: ArcDetectorOptions = {}): DetectedArc[] {
  const {
    minRadiusPx = 8,
    maxRadiusPx = Math.round(Math.min(img.width, img.height) / 6),
    radiusStepPx = 2,
    minSweepDeg = 55,
    maxSweepDeg = 200,
    minSolidity = 0.6,
    edgeThreshold = 24,
    maxResults = 64,
  } = options

  const W = img.width
  const H = img.height
  if (W < 8 || H < 8 || maxRadiusPx <= minRadiusPx) return []

  // Ink is "darker than Otsu", measured on THIS image rather than assumed - the
  // same reasoning as rasterNormalize, and the reason a screenshot works here.
  const inkLevel = otsuThreshold(grayHistogram(img), 128)

  // Edge pixels and their gradient direction (Sobel).
  const ex: number[] = []
  const ey: number[] = []
  const enx: number[] = []
  const eny: number[] = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -grayAt(img, x - 1, y - 1) - 2 * grayAt(img, x - 1, y) - grayAt(img, x - 1, y + 1) +
        grayAt(img, x + 1, y - 1) + 2 * grayAt(img, x + 1, y) + grayAt(img, x + 1, y + 1)
      const gy =
        -grayAt(img, x - 1, y - 1) - 2 * grayAt(img, x, y - 1) - grayAt(img, x + 1, y - 1) +
        grayAt(img, x - 1, y + 1) + 2 * grayAt(img, x, y + 1) + grayAt(img, x + 1, y + 1)
      const mag = Math.hypot(gx, gy)
      if (mag < edgeThreshold) continue
      ex.push(x)
      ey.push(y)
      enx.push(gx / mag)
      eny.push(gy / mag)
    }
  }
  if (ex.length === 0) return []

  const radii: number[] = []
  for (let r = minRadiusPx; r <= maxRadiusPx; r += radiusStepPx) radii.push(r)

  const acc = new Float32Array(W * H)
  for (const r of radii) {
    for (let k = 0; k < ex.length; k++) {
      // The centre lies along the gradient normal, either side: a stroke drawn
      // dark on light has its gradient pointing outward on one edge and inward
      // on the other, so both directions are voted for.
      let xi = Math.round(ex[k] + enx[k] * r)
      let yi = Math.round(ey[k] + eny[k] * r)
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) acc[yi * W + xi] += 1
      xi = Math.round(ex[k] - enx[k] * r)
      yi = Math.round(ey[k] - eny[k] * r)
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) acc[yi * W + xi] += 1
    }
  }

  /**
   * SMOOTH THE VOTES BEFORE BELIEVING THEM.
   *
   * Each edge pixel votes for one rounded integer centre, so a real arc does
   * not pile its votes on one cell — it sprays them over a small cloud, and the
   * single tallest cell can sit several pixels off the true centre. That is
   * fatal here: the verification then walks circles about the wrong point, no
   * radius fits the stroke all the way round, and a genuine 90-degree swing
   * either reads at the wrong radius or is missed. A 3x3 blur gathers each
   * cloud back onto its middle, which is where the arc actually is.
   */
  const smooth = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += acc[(y + dy) * W + x + dx]
      smooth[y * W + x] = sum
    }
  }

  // Local maxima only: one nomination per cloud, rather than every cell in it.
  const peaks: { i: number; v: number }[] = []
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x
      const v = smooth[i]
      if (v <= 0) continue
      let isMax = true
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (smooth[(y + dy) * W + x + dx] > v) { isMax = false; break }
        }
      }
      if (isMax) peaks.push({ i, v })
    }
  }
  peaks.sort((a, b) => b.v - a.v)

  const out: DetectedArc[] = []
  const taken: { x: number; y: number }[] = []

  for (const p of peaks.slice(0, 4000)) {
    if (out.length >= maxResults) break
    const cx = p.i % W
    const cy = (p.i / W) | 0

    // One arc per neighbourhood: a real arc lights up a cluster of centres, and
    // without this the same swing is reported a dozen times.
    let clash = false
    for (const t of taken) {
      if (Math.hypot(t.x - cx, t.y - cy) < Math.max(6, minRadiusPx)) {
        clash = true
        break
      }
    }
    if (clash) continue

    /**
     * A FULL CIRCLE DISQUALIFIES THE WHOLE CENTRE, not just that radius.
     *
     * A round table nominates a strong centre, and if the radius that matches
     * it is rejected for sweeping too far, the search simply moves to a
     * slightly wrong radius that clips the same circle and reports a
     * respectable-looking 66-degree "swing". Checking every radius first, and
     * dropping the centre outright when any of them is nearly closed, stops
     * that: whatever is drawn here is round, and round is not a door.
     */
    let closed = false
    for (const r of radii) {
      if (ringInkRatio(img, cx, cy, r, inkLevel) > 0.82) { closed = true; break }
    }
    if (closed) { taken.push({ x: cx, y: cy }); continue }

    /**
     * THE VOTE CLOUD IS BIASED, SO REFINE AGAINST THE INK INSTEAD.
     *
     * A full circle sprays votes symmetrically about its centre and the peak
     * lands where it should. A QUARTER of a circle only has a quarter of the
     * evidence, all of it on one side, so the cloud is lopsided and its peak
     * drifts toward the drawn part — measured at about 3px on a 30px swing,
     * which then reads as a 26px radius. For a detector whose whole value is
     * that the radius is a ruler, that is not close enough.
     *
     * The accumulator is a good way to find WHERE to look and a poor way to
     * decide exactly where something is. So take the peak as a hint and then
     * hill-climb (cx, cy, r) against ringContrast, which measures the drawing
     * rather than the votes: alternate between the best radius at this centre
     * and the best centre at this radius until neither improves.
     */
    let bcx = cx, bcy = cy, bestR = 0, bestContrast = -1
    for (let pass = 0; pass < 3; pass++) {
      let improved = false
      for (const r of radii) {
        const c = ringContrast(img, bcx, bcy, r, inkLevel)
        if (c > bestContrast) { bestContrast = c; bestR = r; improved = true }
      }
      if (!bestR) break
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const c = ringContrast(img, bcx + dx, bcy + dy, bestR, inkLevel)
          if (c > bestContrast) { bestContrast = c; bcx += dx; bcy += dy; improved = true }
        }
      }
      if (!improved) break
    }
    // Refine against the arc's own pixels — see fitCircle for why the coarse
    // answer cannot be trusted for the radius.
    let fcx = bcx, fcy = bcy, fr = bestR
    if (bestR) {
      const fit = fitCircle(inkNearRing(img, bcx, bcy, bestR, inkLevel))
      if (fit && Math.hypot(fit.cx - bcx, fit.cy - bcy) <= 12 && fit.r >= minRadiusPx && fit.r <= maxRadiusPx) {
        fcx = Math.round(fit.cx); fcy = Math.round(fit.cy); fr = Math.round(fit.r)
      }
    }
    const bestFit = fr
      ? measureArc(img, fcx, fcy, fr, inkLevel, minSweepDeg, maxSweepDeg, minSolidity)
      : null
    if (bestFit) {
      out.push(bestFit)
      taken.push({ x: bestFit.cx, y: bestFit.cy })
    } else {
      taken.push({ x: cx, y: cy })
    }
  }

  return out.sort((a, b) => b.solidity * b.sweepDeg - a.solidity * a.sweepDeg)
}

/**
 * Door leaf widths that cover most residential work. 2'6", 2'8" and 3'0" are
 * the common ones; the rest are the usual outliers.
 */
export const COMMON_DOOR_LEAF_MM = [686, 762, 813, 864, 914]

/**
 * Scale implied by a door swing, in mm per pixel.
 *
 * A door leaf is one of the few genuinely standard dimensions on a drawing, so
 * the radius of the swing IS the leaf width and one confidently-detected arc
 * fixes the scale - without knowing what a single wall is made of, and without
 * depending on line weight, which is what makes wall-thickness inference fail
 * on a screenshot.
 */
export function scaleFromDoorArc(radiusPx: number, leafMm = 813): number | null {
  if (!(radiusPx > 0) || !(leafMm > 0)) return null
  return leafMm / radiusPx
}
