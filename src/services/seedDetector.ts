import type { SeedWall, UserTrace } from '../types'

export function extractSeedFromTraces(traces: UserTrace[]): SeedWall[] {
  if (traces.length < 2) return []

  const seeds: SeedWall[] = []

  for (const trace of traces) {
    const pts = trace.points
    if (pts.length < 8) continue

    const n = pts.length
    let sumX = 0, sumY = 0, sumX2 = 0, sumXY = 0
    for (const [x, y] of pts) {
      sumX += x; sumY += y; sumX2 += x * x; sumXY += x * y
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let maxDist = 0
    for (const [x, y] of pts) {
      const yOnLine = slope * x + intercept
      const dist = Math.abs(y - yOnLine)
      if (dist > maxDist) maxDist = dist

      const t = x
      const projY = slope * t + intercept
      if (t < minX) { minX = t; minY = projY }
      if (t > maxX) { maxX = t; maxY = projY }
    }

    const len = Math.hypot(maxX - minX, maxY - minY)
    if (len < 20) continue

    seeds.push({
      x1: minX, y1: minY,
      x2: maxX, y2: maxY,
      thicknessPx: Math.max(maxDist * 2, 4),
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
