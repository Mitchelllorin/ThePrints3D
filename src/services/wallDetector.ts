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

/**
 * Stretch the grayscale range to [0, 255] to boost low-contrast scans.
 * Uses the 2nd and 98th percentile to avoid clipping on extreme outliers
 * (e.g. a single pure-black pixel in a border). Uses an O(n) histogram
 * rather than sorting to keep large-image processing fast.
 */
function normalizeContrast(gray: Float32Array): Float32Array {
  // Build 256-bucket histogram in O(n)
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, Math.max(0, gray[i] | 0))]++
  }
  const loTarget = gray.length * 0.02
  const hiTarget = gray.length * 0.98
  let lo = 0, hi = 255, cumul = 0
  for (let i = 0; i <= 255; i++) {
    cumul += hist[i]
    if (cumul <= loTarget) lo = i
    if (cumul <= hiTarget) hi = i
  }
  if (hi <= lo) return gray
  const range = hi - lo
  const out = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / range) * 255))
  }
  return out
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
 * Scan along ±45° diagonals to find diagonal wall segments.
 * Anti-diagonal (y − x = c) and main-diagonal (y + x = c) lines are scanned
 * independently and runs of edge pixels longer than minLength are kept.
 */
function findDiagonalSegments(
  edges: Float32Array,
  width: number,
  height: number,
  threshold: number,
  minLength: number
): ParsedWall[] {
  const walls: ParsedWall[] = []
  const minLenDiag = Math.round(minLength * Math.SQRT2)

  // Anti-diagonals: y - x = c, ranging from -(width-1) to (height-1)
  const addDiagWall = (pts: { x: number; y: number }[]) => {
    if (pts.length < 2) return
    const s = pts[0], e = pts[pts.length - 1]
    const len = Math.hypot(e.x - s.x, e.y - s.y)
    if (len >= minLenDiag) {
      walls.push({ x1: s.x, y1: s.y, x2: e.x, y2: e.y, thickness: 1 })
    }
  }

  // Anti-diagonals (slope +1, direction NE-SW): y - x = c
  for (let c = -(width - 1); c < height; c++) {
    let run: { x: number; y: number }[] = []
    const xStart = Math.max(0, -c)
    const xEnd = Math.min(width - 1, height - 1 - c)
    for (let x = xStart; x <= xEnd; x++) {
      const y = x + c
      if (y < 0 || y >= height) continue
      if (edges[y * width + x] > threshold) {
        run.push({ x, y })
      } else {
        addDiagWall(run)
        run = []
      }
    }
    addDiagWall(run)
  }

  // Main diagonals (slope -1, direction NW-SE): y + x = c
  for (let c = 0; c < width + height - 1; c++) {
    let run: { x: number; y: number }[] = []
    const xStart = Math.max(0, c - (height - 1))
    const xEnd = Math.min(width - 1, c)
    for (let x = xStart; x <= xEnd; x++) {
      const y = c - x
      if (y < 0 || y >= height) continue
      if (edges[y * width + x] > threshold) {
        run.push({ x, y })
      } else {
        addDiagWall(run)
        run = []
      }
    }
    addDiagWall(run)
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

/**
 * Find parallel segment pairs that are close together (= two faces of a wall).
 * Updates thickness on the first segment of each pair and removes the second.
 */
function detectWallPairs(segs: ParsedWall[], axis: 'h' | 'v', maxSep: number): void {
  const paired = new Set<number>()
  for (let i = 0; i < segs.length; i++) {
    if (paired.has(i)) continue
    for (let j = i + 1; j < segs.length; j++) {
      if (paired.has(j)) continue
      const a = segs[i]
      const b = segs[j]
      if (axis === 'h') {
        const sep = Math.abs(b.y1 - a.y1)
        if (sep > maxSep) continue
        // Check for overlap in X range
        const overlapStart = Math.max(a.x1, b.x1)
        const overlapEnd = Math.min(a.x2, b.x2)
        if (overlapEnd - overlapStart > 20) {
          a.thickness = sep
          paired.add(j)
        }
      } else {
        const sep = Math.abs(b.x1 - a.x1)
        if (sep > maxSep) continue
        const overlapStart = Math.max(a.y1, b.y1)
        const overlapEnd = Math.min(a.y2, b.y2)
        if (overlapEnd - overlapStart > 20) {
          a.thickness = sep
          paired.add(j)
        }
      }
    }
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
  const normalized = normalizeContrast(gray)
  const blurred = gaussianBlur(normalized, width, height)
  const edges = sobelEdges(blurred, width, height)

  const segments = findLineSegments(edges, width, height, edgeThreshold, minWallLengthPx)
  const diagSegments = findDiagonalSegments(edges, width, height, edgeThreshold, minWallLengthPx)
  const merged = mergeSegments([...segments, ...diagSegments], mergeGapPx)

  // First-pass length / thickness gate (keeps the classifier cheap)
  const candidates = merged.filter((w) => {
    const len = Math.sqrt((w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2)
    if (len < minWallLengthPx) return false
    if (requirePairedEdges) {
      if (w.thickness > maxWallThicknessPx) return false
    }
    return true
  })

  // Sample the original image along each candidate to decide its line class.
  const { classified, stats } = classifyLines(imageData, candidates, {
    minWallLengthPx,
    minWallThicknessPx,
  })

  // Only `wall`-classified lines survive into ParsedWall[].
  const walls: ParsedWall[] = classified
    .filter((c) => c.classification === 'wall')
    .map((c) => ({
      x1: c.x1,
      y1: c.y1,
      x2: c.x2,
      y2: c.y2,
      thickness: c.thickness,
      source: 'auto',
      detectionConfidence: c.confidence,
    }))

  return { walls, stats, classified }
}
