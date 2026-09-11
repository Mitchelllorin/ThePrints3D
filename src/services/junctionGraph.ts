/**
 * CORNERS FIRST, THEN THE WALLS BETWEEN THEM.
 *
 * The line-first detector reads the lines on a plan and then tries to join
 * them. On adu-71sqm that read 50+ segments that enclosed ZERO rooms across 42
 * threshold settings — the lines were read, they simply never closed. The
 * published engines (CubiCasa, RoomFormer, HEAT) go the other way round: find
 * the corners and the directions the walls leave them, then join two corners
 * whose arms face each other. A room closes because of how its walls were
 * built, not because a gap tolerance happened to be generous enough.
 *
 * This is the consumer of the model's `junctions` head: four heatmaps, north /
 * east / south / west, in the channel order `ops/train/synth.py` writes as
 * ARM_DIRS. Pure and synchronous so it can be tested without onnxruntime:
 *
 *   findJunctions          peaks in the heatmaps -> corners with an arm bitmask
 *   pairJunctions          join corners whose arms face each other, nearest first
 *   buildJunctionSkeleton  both, with the wall mask as a sanity check
 *
 * Everything here is in MASK pixels (256x256). Scaling to the raster is the
 * caller's job, exactly as it is for the wall mask.
 */

/** Arm bits, in the model's channel order. Must match ARM_N/E/S/W in synth.py. */
export const ARM_N = 1 << 0
export const ARM_E = 1 << 1
export const ARM_S = 1 << 2
export const ARM_W = 1 << 3

export interface Junction {
  x: number
  y: number
  /** Bitmask of ARM_N/E/S/W — which directions a wall leaves this corner in. */
  arms: number
  /** Peak heat, 0–1. */
  score: number
}

export interface JunctionOptions {
  /** A corner must peak at least this hot in some channel. */
  peakThreshold?: number
  /**
   * An arm counts at a lower bar than the peak. The corner is already
   * established by then; the question is only which ways its walls go, and a
   * T's weakest arm routinely comes back cooler than its other two.
   */
  armThreshold?: number
  /** Non-maximum suppression radius — the label Gaussian is sigma 2. */
  nmsRadius?: number
}

export function findJunctions(
  heat: ArrayLike<number>,
  width: number,
  height: number,
  opts: JunctionOptions = {},
): Junction[] {
  const peakT = opts.peakThreshold ?? 0.5
  const armT = opts.armThreshold ?? 0.35
  const r = Math.max(1, Math.round(opts.nmsRadius ?? 3))
  const plane = width * height
  if (heat.length < plane * 4) {
    throw new Error(`junction heatmaps too small: ${heat.length} values for 4x${width}x${height}`)
  }

  // One map of "is there a corner here at all", whichever way its arms go.
  const combined = new Float32Array(plane)
  for (let c = 0; c < 4; c++) {
    const off = c * plane
    for (let i = 0; i < plane; i++) {
      if (heat[off + i] > combined[i]) combined[i] = heat[off + i]
    }
  }

  const out: Junction[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const v = combined[i]
      if (v < peakT) continue

      let isPeak = true
      for (let dy = -r; dy <= r && isPeak; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue
          const j = ny * width + nx
          const n = combined[j]
          // Ties go to the pixel earlier in scan order, so a flat-topped peak
          // yields ONE corner rather than a patch of them.
          if (n > v || (n === v && j < i)) {
            isPeak = false
            break
          }
        }
      }
      if (!isPeak) continue

      // Sub-pixel position from the 3x3 around the peak, and the arms from the
      // hottest value each channel has there — an arm a pixel off is still an arm.
      let sw = 0
      let sx = 0
      let sy = 0
      const armHeat = [0, 0, 0, 0]
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = ny * width + nx
          const w = combined[j]
          sw += w
          sx += w * nx
          sy += w * ny
          for (let c = 0; c < 4; c++) {
            const h = heat[c * plane + j]
            if (h > armHeat[c]) armHeat[c] = h
          }
        }
      }
      let arms = 0
      for (let c = 0; c < 4; c++) if (armHeat[c] >= armT) arms |= 1 << c
      if (!arms) continue
      out.push({ x: sx / sw, y: sy / sw, arms, score: v })
    }
  }
  return out
}

export interface PairOptions {
  /** Two corners closer than this along the wall are the same corner twice. */
  minLengthPx?: number
  /** How far off the line a partner may sit, in pixels, before skew is allowed for. */
  alignTolPx?: number
  /**
   * Extra sideways slack per unit of length. Scans are rarely dead square, and
   * a 3° tilt walks the far end of a 200px wall ten pixels off the row.
   */
  maxSkewDeg?: number
}

export interface JunctionPair {
  /** Index of the corner whose EAST (axis 'h') or SOUTH (axis 'v') arm is used. */
  from: number
  /** Index of the corner whose WEST or NORTH arm meets it. */
  to: number
  axis: 'h' | 'v'
}

/**
 * Sideways offset costs this many times what the same distance along the wall
 * does. Between two candidates for one arm, the one on the row wins even when
 * it is a little further away.
 */
const ACROSS_PENALTY = 4

/**
 * Join corners whose arms face each other: A's east arm with the corner to its
 * east that has a west arm, A's south arm with the corner below it that has a
 * north arm.
 *
 * Every arm is used once, cheapest pairing first. That is what stops a wall
 * from leaping a T: A — T — B pairs A with T and T with B, and A's east arm is
 * spent before A — B is ever considered.
 *
 * `accept` vetoes a pairing BEFORE it can spend an arm, so a nearest partner
 * the evidence rules out leaves the arm free for the next one along.
 */
export function pairJunctions(
  junctions: readonly Junction[],
  opts: PairOptions = {},
  accept?: (a: Junction, b: Junction) => boolean,
): JunctionPair[] {
  const minLen = opts.minLengthPx ?? 3
  const tol = opts.alignTolPx ?? 3
  const skew = Math.tan(((opts.maxSkewDeg ?? 3) * Math.PI) / 180)

  const candidates: Array<JunctionPair & { cost: number }> = []
  for (let i = 0; i < junctions.length; i++) {
    const a = junctions[i]
    const facesEast = (a.arms & ARM_E) !== 0
    const facesSouth = (a.arms & ARM_S) !== 0
    if (!facesEast && !facesSouth) continue
    for (let j = 0; j < junctions.length; j++) {
      if (i === j) continue
      const b = junctions[j]
      if (facesEast && b.arms & ARM_W) {
        const along = b.x - a.x
        const across = Math.abs(b.y - a.y)
        if (along >= minLen && across <= tol + along * skew && (!accept || accept(a, b))) {
          candidates.push({ from: i, to: j, axis: 'h', cost: along + ACROSS_PENALTY * across })
        }
      }
      if (facesSouth && b.arms & ARM_N) {
        const along = b.y - a.y
        const across = Math.abs(b.x - a.x)
        if (along >= minLen && across <= tol + along * skew && (!accept || accept(a, b))) {
          candidates.push({ from: i, to: j, axis: 'v', cost: along + ACROSS_PENALTY * across })
        }
      }
    }
  }
  candidates.sort((p, q) => p.cost - q.cost)

  const spentFrom = { h: new Set<number>(), v: new Set<number>() }
  const spentTo = { h: new Set<number>(), v: new Set<number>() }
  const pairs: JunctionPair[] = []
  for (const c of candidates) {
    if (spentFrom[c.axis].has(c.from) || spentTo[c.axis].has(c.to)) continue
    spentFrom[c.axis].add(c.from)
    spentTo[c.axis].add(c.to)
    pairs.push({ from: c.from, to: c.to, axis: c.axis })
  }
  return pairs
}

/**
 * How much of the line between two points the wall mask backs up: the fraction
 * of it on wall, and the longest stretch that is not. Each sample looks at the
 * 3x3 around it, since a centreline a pixel off a thin wall is still on it.
 */
export function maskSupport(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  threshold = 0.5,
): { fraction: number; longestGapPx: number } {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const steps = Math.max(1, Math.ceil(len))
  const stepLen = len / steps
  let hits = 0
  let gap = 0
  let longest = 0
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const cx = Math.round(x1 + t * (x2 - x1))
    const cy = Math.round(y1 + t * (y2 - y1))
    let on = false
    for (let dy = -1; dy <= 1 && !on; dy++) {
      const py = cy + dy
      if (py < 0 || py >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx
        if (px < 0 || px >= width) continue
        if (mask[py * width + px] >= threshold) {
          on = true
          break
        }
      }
    }
    if (on) {
      hits++
      gap = 0
    } else if (++gap > longest) {
      longest = gap
    }
  }
  // steps+1 samples span `len`, so an all-miss line would otherwise read one
  // step longer than itself.
  return { fraction: hits / (steps + 1), longestGapPx: Math.min(longest * stepLen, len) }
}

export interface SkeletonOptions extends JunctionOptions, PairOptions {
  maskThreshold?: number
  /**
   * The longest stretch of a wall the mask may be missing. DOORS ARE WHY THIS
   * IS NOT ZERO: synth.py cuts door openings out of the wall mask but not out
   * of the corner labels, so the model is taught that a wall's arms run
   * straight across its doorway while the mask shows a hole there. Demanding
   * an unbroken mask would unpick every room with a door in it — which is
   * every room. The default clears the widest door synth.py draws: buildings
   * 85–189px across at 256, 26–62 ft wide, put a 3'-0" door at 4–22px.
   */
  maxGapPx?: number
  /** And the line must still be mostly wall — a door in it, not a room across it. */
  minSupport?: number
}

export interface JunctionSegment extends JunctionPair {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface JunctionSkeleton {
  junctions: Junction[]
  segments: JunctionSegment[]
}

/**
 * Corners out of the heatmaps, joined where their arms face each other and the
 * wall mask agrees there is a wall between them.
 *
 * The arms decide WHAT joins; the mask only vetoes. That split is the point:
 * the mask on its own is exactly what the line-first detector already had, and
 * it never closed a room.
 */
export function buildJunctionSkeleton(
  heat: ArrayLike<number>,
  mask: ArrayLike<number>,
  width: number,
  height: number,
  opts: SkeletonOptions = {},
): JunctionSkeleton {
  if (mask.length < width * height) {
    throw new Error(`wall mask too small: ${mask.length} values for ${width}x${height}`)
  }
  const junctions = findJunctions(heat, width, height, opts)
  const maskT = opts.maskThreshold ?? 0.5
  const maxGap = opts.maxGapPx ?? 24
  const minSupport = opts.minSupport ?? 0.3
  const pairs = pairJunctions(junctions, opts, (a, b) => {
    const s = maskSupport(mask, width, height, a.x, a.y, b.x, b.y, maskT)
    return s.longestGapPx <= maxGap && s.fraction >= minSupport
  })
  const segments = pairs.map((p) => ({
    ...p,
    x1: junctions[p.from].x,
    y1: junctions[p.from].y,
    x2: junctions[p.to].x,
    y2: junctions[p.to].y,
  }))
  return { junctions, segments }
}
