import type { SeedWall, UserTrace } from '../types'

export function extractSeedFromTraces(traces: UserTrace[]): SeedWall[] {
  // A single traced wall is enough to seed detection ("trace one or two and it
  // finds the rest"). Previously this bailed below two traces and threw away any
  // trace with fewer than 8 points — which silently discarded every line-mode
  // (tap corner-to-corner) trace, since those carry just the two endpoints.
  if (traces.length === 0) return []

  const seeds: SeedWall[] = []

  for (const trace of traces) {
    const pts = trace.points
    if (pts.length < 2) continue

    let x1: number, y1: number, x2: number, y2: number, thicknessPx: number

    if (pts.length === 2) {
      // Line-mode trace: the two taps ARE the wall's endpoints — the cleanest
      // possible seed. No fit needed (and a 2-point regression is degenerate).
      ;[x1, y1] = pts[0]
      ;[x2, y2] = pts[1]
      thicknessPx = 4
    } else {
      const n = pts.length
      let sumX = 0, sumY = 0, sumX2 = 0, sumXY = 0
      for (const [x, y] of pts) {
        sumX += x; sumY += y; sumX2 += x * x; sumXY += x * y
      }
      const denom = n * sumX2 - sumX * sumX
      if (Math.abs(denom) < 1e-6) {
        // Near-vertical stroke — y = slope·x + b can't represent it. Use the raw
        // first/last points rather than producing NaN endpoints.
        ;[x1, y1] = pts[0]
        ;[x2, y2] = pts[n - 1]
        thicknessPx = 4
      } else {
        const slope = (n * sumXY - sumX * sumY) / denom
        const intercept = (sumY - slope * sumX) / n
        let minX = Infinity, maxX = -Infinity
        let minY = 0, maxY = 0
        let maxDist = 0
        for (const [x, y] of pts) {
          const dist = Math.abs(y - (slope * x + intercept))
          if (dist > maxDist) maxDist = dist
          if (x < minX) { minX = x; minY = slope * x + intercept }
          if (x > maxX) { maxX = x; maxY = slope * x + intercept }
        }
        x1 = minX; y1 = minY; x2 = maxX; y2 = maxY
        thicknessPx = Math.max(maxDist * 2, 4)
      }
    }

    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len < 20) continue

    seeds.push({
      x1, y1, x2, y2,
      thicknessPx,
      confidence: Math.min(1, len / 200),
    })
  }

  return mergeNearbySeeds(seeds, 30)
}

function mergeNearbySeeds(seeds: SeedWall[], proximityPx: number): SeedWall[] {
  const merged: SeedWall[] = []
  const used = new Set<number>()

  for (let i = 0; i < seeds.length; i++) {
    if (used.has(i)) continue
    const group = [seeds[i]]
    used.add(i)

    for (let j = i + 1; j < seeds.length; j++) {
      if (used.has(j)) continue
      const si = seeds[i], sj = seeds[j]
      const di = Math.hypot(si.x1 - sj.x1, si.y1 - sj.y1)
      const dj = Math.hypot(si.x2 - sj.x2, si.y2 - sj.y2)
      if (di < proximityPx && dj < proximityPx) {
        group.push(sj)
        used.add(j)
      }
    }

    if (group.length > 0) {
      const avg = (ws: SeedWall[]) => {
        const n = ws.length
        return {
          x1: ws.reduce((s, w) => s + w.x1, 0) / n,
          y1: ws.reduce((s, w) => s + w.y1, 0) / n,
          x2: ws.reduce((s, w) => s + w.x2, 0) / n,
          y2: ws.reduce((s, w) => s + w.y2, 0) / n,
          thicknessPx: ws.reduce((s, w) => s + w.thicknessPx, 0) / n,
          confidence: Math.min(1, ws.reduce((s, w) => s + w.confidence, 0)),
        }
      }
      merged.push({ ...avg(group), thicknessPx: Math.round(avg(group).thicknessPx) })
    }
  }

  return merged
}
