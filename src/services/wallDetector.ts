import type { ParsedWall } from '../types'
import { classifyLines } from './lineClassifier'
import type { ClassifiedLine, LineClassificationStats } from '../symbols/types'

// ─── Image processing utilities ───────────────────────────────────────────────

function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return gray
}

function stretchContrast(gray: Float32Array): Float32Array {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) {
    hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++
  }

  const total = gray.length
  const lowTarget = Math.max(1, Math.round(total * 0.02))
  const highTarget = Math.max(lowTarget + 1, Math.round(total * 0.98))

  let low = 0
  let accum = 0
  while (low < 255 && accum < lowTarget) {
    accum += hist[low]
    low++
  }

  let high = 255
  accum = total
  while (high > 0 && accum > highTarget) {
    accum -= hist[high]
    high--
  }

  if (high - low < 20) return gray.slice()

  const scale = 255 / (high - low)
  const stretched = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i++) {
    stretched[i] = Math.max(0, Math.min(255, (gray[i] - low) * scale))
  }
  return stretched
}

function blendGray(base: Float32Array, overlay: Float32Array, overlayWeight: number): Float32Array {
  const blended = new Float32Array(base.length)
  const baseWeight = 1 - overlayWeight
  for (let i = 0; i < base.length; i++) {
    blended[i] = base[i] * baseWeight + overlay[i] * overlayWeight
  }
  return blended
}

function gaussianBlur(src: Float32Array, width: number, height: number): Float32Array {
  // 5x5 Gaussian kernel σ≈1.0
  const kernel = [
    1, 4, 6, 4, 1,
    4, 16, 24, 16, 4,
    6, 24, 36, 24, 6,
    4, 16, 24, 16, 4,
    1, 4, 6, 4, 1,
  ]
  const kSum = 256
  const dst = new Float32Array(width * height)
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let sum = 0
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          sum += src[(y + ky) * width + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)]
        }
      }
      dst[y * width + x] = sum / kSum
    }
  }
  return dst
}

function sobelEdges(gray: Float32Array, width: number, height: number): Float32Array {
  const mag = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = gray[(y - 1) * width + (x - 1)]
      const tc = gray[(y - 1) * width + x]
      const tr = gray[(y - 1) * width + (x + 1)]
      const ml = gray[y * width + (x - 1)]
      const mr = gray[y * width + (x + 1)]
      const bl = gray[(y + 1) * width + (x - 1)]
      const bc = gray[(y + 1) * width + x]
      const br = gray[(y + 1) * width + (x + 1)]
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br
      mag[y * width + x] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return mag
}

// ─── Line segment extraction ──────────────────────────────────────────────────

/**
 * Scan each row for horizontal edge runs and each column for vertical runs.
 * Returns candidate wall segments.
 */
function findLineSegments(
  edges: Float32Array,
  width: number,
  height: number,
  threshold: number,
  minLength: number
): ParsedWall[] {
  const walls: ParsedWall[] = []

  // Horizontal runs
  for (let y = 1; y < height - 1; y++) {
    let runStart = -1
    for (let x = 0; x < width; x++) {
      const isEdge = edges[y * width + x] > threshold
      if (isEdge && runStart === -1) {
        runStart = x
      } else if (!isEdge && runStart !== -1) {
        const len = x - runStart
        if (len >= minLength) {
          walls.push({ x1: runStart, y1: y, x2: x, y2: y, thickness: 1 })
        }
        runStart = -1
      }
    }
    if (runStart !== -1) {
      const len = width - runStart
      if (len >= minLength) {
        walls.push({ x1: runStart, y1: y, x2: width, y2: y, thickness: 1 })
      }
    }
  }

  // Vertical runs
  for (let x = 1; x < width - 1; x++) {
    let runStart = -1
    for (let y = 0; y < height; y++) {
      const isEdge = edges[y * width + x] > threshold
      if (isEdge && runStart === -1) {
        runStart = y
      } else if (!isEdge && runStart !== -1) {
        const len = y - runStart
        if (len >= minLength) {
          walls.push({ x1: x, y1: runStart, x2: x, y2: y, thickness: 1 })
        }
        runStart = -1
      }
    }
    if (runStart !== -1) {
      const len = height - runStart
      if (len >= minLength) {
        walls.push({ x1: x, y1: runStart, x2: x, y2: height, thickness: 1 })
      }
    }
  }

  return walls
}

/**
 * Merge collinear segments that are close together (within gap px) into single segments.
 * Also detect parallel pairs (wall faces) and set estimated thickness.
 */
function mergeSegments(walls: ParsedWall[], gap: number): ParsedWall[] {
  if (walls.length === 0) return []

  // Separate horizontal and vertical
  const horiz = walls.filter((w) => Math.abs(w.y2 - w.y1) < Math.abs(w.x2 - w.x1))
  const vert = walls.filter((w) => Math.abs(w.y2 - w.y1) >= Math.abs(w.x2 - w.x1))

  const merged: ParsedWall[] = []

  // Group horizontal segments by approximate Y, merge overlapping/nearby runs
  merged.push(...mergeAxisAligned(horiz, 'h', gap))
  merged.push(...mergeAxisAligned(vert, 'v', gap))

  return merged
}

function mergeAxisAligned(
  segs: ParsedWall[],
  axis: 'h' | 'v',
  gap: number
): ParsedWall[] {
  if (segs.length === 0) return []

  // Group by row/col position (within ±2px)
  const groups = new Map<number, ParsedWall[]>()
  for (const seg of segs) {
    const key = axis === 'h' ? seg.y1 : seg.x1
    // Round to nearest 4px bucket (wider than the previous 2px bucket to tolerate
    // slight scan skew and sub-pixel quantisation of parallel wall faces).
    const bucket = Math.round(key / 4) * 4
    if (!groups.has(bucket)) groups.set(bucket, [])
    groups.get(bucket)!.push(seg)
  }

  const result: ParsedWall[] = []

  for (const [, group] of groups) {
    // Sort by start position
    const sorted =
      axis === 'h'
        ? group.sort((a, b) => a.x1 - b.x1)
        : group.sort((a, b) => a.y1 - b.y1)

    // Merge overlapping/close segments
    let cur = { ...sorted[0] }
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i]
      const curEnd = axis === 'h' ? cur.x2 : cur.y2
      const sStart = axis === 'h' ? s.x1 : s.y1
      const sEnd = axis === 'h' ? s.x2 : s.y2

      if (sStart <= curEnd + gap) {
        // Extend current segment
        if (axis === 'h') cur.x2 = Math.max(curEnd, sEnd)
        else cur.y2 = Math.max(curEnd, sEnd)
      } else {
        result.push(cur)
        cur = { ...s }
      }
    }
    result.push(cur)
  }

  // Now detect parallel pairs → set thickness.
  // maxSep = gap * 12 to handle thick walls (e.g. 150 mm concrete) that produce
  // widely-separated edge pairs.  Previously gap*5 missed walls >~20 px thick.
  detectWallPairs(result, axis, gap * 12)

  return result
}

/** A detected segment carrying the wall centerline derived from its face pair. */
export type DetectedSeg = ParsedWall & { centerX?: number; centerY?: number }

/**
 * Find parallel segment pairs that are close together (= two faces of a wall).
 * Sets thickness on the first segment of each pair from the face separation AND
 * records the wall *centerline* (`centerX`/`centerY`) — the midpoint between the
 * two faces — so the emitted wall sits flush on the real centre, not on a face.
 * The classifier still samples the original face position (which lies on ink);
 * the centre is applied only when the final ParsedWall is built. The partner
 * face keeps thickness 1 and is later dropped as a "dimension" line.
 */
export function detectWallPairs(segs: DetectedSeg[], axis: 'h' | 'v', maxSep: number): void {
  const paired = new Set<number>()
  for (let i = 0; i < segs.length; i++) {
    if (paired.has(i)) continue
    const a = segs[i]
    // Pair `a` with its NEAREST overlapping parallel partner — not just any face
    // within range. The old greedy match consumed EVERY nearby parallel face
    // (no break, last one wins), so a thin partition's face sitting close to a
    // thicker wall got swallowed by that wall and never emitted as its own wall
    // — exactly the "partitions sharing endpoints/overlaps" miss. Nearest-partner
    // pairing leaves the other faces free to pair with their own true partners.
    let bestJ = -1
    let bestSep = Infinity
    for (let j = i + 1; j < segs.length; j++) {
      if (paired.has(j)) continue
      const b = segs[j]
      if (axis === 'h') {
        const sep = Math.abs(b.y1 - a.y1)
        if (sep > maxSep) continue
        const overlapStart = Math.max(a.x1, b.x1)
        const overlapEnd = Math.min(a.x2, b.x2)
        if (overlapEnd - overlapStart > 20 && sep < bestSep) { bestSep = sep; bestJ = j }
      } else {
        const sep = Math.abs(b.x1 - a.x1)
        if (sep > maxSep) continue
        const overlapStart = Math.max(a.y1, b.y1)
        const overlapEnd = Math.min(a.y2, b.y2)
        if (overlapEnd - overlapStart > 20 && sep < bestSep) { bestSep = sep; bestJ = j }
      }
    }
    if (bestJ < 0) continue
    const b = segs[bestJ]
    a.thickness = bestSep
    if (axis === 'h') a.centerY = (a.y1 + b.y1) / 2
    else a.centerX = (a.x1 + b.x1) / 2
    paired.add(bestJ)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect wall segments from rasterized drawing image data.
 *
 * Returns wall candidates as pixel-space line segments. The caller should
 * supply `scaleMmPerPx` to convert to real-world coordinates.
 */
export interface DetectWallsResult {
  walls: ParsedWall[]
  /** Distribution of all candidate line classifications (wall, dimension, etc). */
  stats: LineClassificationStats
  /** Each candidate with its class — useful for debug overlay. */
  classified: ClassifiedLine[]
}

export function detectWalls(
  imageData: ImageData,
  options: {
    edgeThreshold?: number
    minWallLengthPx?: number
    minWallThicknessPx?: number
    maxWallThicknessPx?: number
    requirePairedEdges?: boolean
    mergeGapPx?: number
  } = {}
): DetectWallsResult {
  const { width, height, data } = imageData
  const {
    edgeThreshold = 32,
    minWallLengthPx = 60,
    minWallThicknessPx = 3,
    maxWallThicknessPx = 64,
    requirePairedEdges = true,
    mergeGapPx = 4,
  } = options

  const gray = toGrayscale(data, width, height)
  const normalized = stretchContrast(gray)
  const enhanced = blendGray(gray, normalized, 0.7)
  const blurred = gaussianBlur(enhanced, width, height)
  const edges = sobelEdges(blurred, width, height)

  const segments = findLineSegments(edges, width, height, edgeThreshold, minWallLengthPx)
  const merged = mergeSegments(segments, mergeGapPx)

  // First-pass length / thickness gate (keeps the classifier cheap)
  const candidates = merged.filter((w) => {
    const len = Math.sqrt((w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2)
    if (len < minWallLengthPx) return false
    if (requirePairedEdges) {
      if (w.thickness > maxWallThicknessPx) return false
    }
    return true
  })

  // A wall reads as ink in one of two ways depending on the drawing style:
  //  • solid / poché / vector single-stroke walls → the CENTRELINE is the ink
  //  • double-line walls (two parallel faces, hollow centre) → the FACES are ink
  // The raw candidate sits on a FACE, so face-sampling catches double-line walls
  // but misreads a single stroke's edge as half-dark (every wall on a clean
  // vector plan — e.g. the practice presets — was lost). Sample BOTH the face
  // and the pair's centreline and treat the candidate as a wall if EITHER reads
  // as one, so both drawing styles work. Emitted coords come from the centre, so
  // a trace snapped to a wall lands flush instead of offset by half its thickness.
  const centreCands = candidates.map((c) => {
    const seg = c as DetectedSeg
    if (seg.centerY != null) return { ...c, y1: seg.centerY, y2: seg.centerY }
    if (seg.centerX != null) return { ...c, x1: seg.centerX, x2: seg.centerX }
    return c
  })
  const faceClass = classifyLines(imageData, candidates, { minWallLengthPx, minWallThicknessPx }).classified
  const centreClass = classifyLines(imageData, centreCands, { minWallLengthPx, minWallThicknessPx }).classified

  const walls: ParsedWall[] = []
  const classified: ClassifiedLine[] = candidates.map((cand, k) => {
    const seg = cand as DetectedSeg
    const f = faceClass[k]
    const ce = centreClass[k]
    const wallByFace = f.classification === 'wall'
    const wallByCentre = ce.classification === 'wall'
    const isWall = wallByFace || wallByCentre
    // `classified` carries centre coords so a debug overlay lines up with the
    // emitted walls; mark 'wall' on the union, else keep the centre reading.
    const confidence = isWall
      ? Math.max(wallByFace ? f.confidence : 0, wallByCentre ? ce.confidence : 0)
      : ce.confidence
    if (isWall) {
      walls.push({
        x1: seg.centerX ?? cand.x1,
        y1: seg.centerY ?? cand.y1,
        x2: seg.centerX ?? cand.x2,
        y2: seg.centerY ?? cand.y2,
        thickness: cand.thickness,
        source: 'auto',
        detectionConfidence: confidence,
      })
    }
    return { ...ce, classification: isWall ? 'wall' : ce.classification, confidence }
  })

  const stats: LineClassificationStats = {
    total: classified.length, wall: 0, dimension: 0, dashed: 0, dotted: 0, leader: 0, unknown: 0,
  }
  for (const c of classified) stats[c.classification]++

  return { walls, stats, classified }
}
