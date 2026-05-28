import type { ParsedWall } from '../types'
import type { ClassifiedLine, LineClassificationStats } from '../symbols/types'
import { selectOpenSourceContextProfile } from './openSourceDrawingContext'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function lengthOf(wall: Pick<ParsedWall, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
}

function overlapLength(a1: number, a2: number, b1: number, b2: number): number {
  const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2))
  const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2))
  return Math.max(0, hi - lo)
}

function isHorizontal(wall: ParsedWall): boolean {
  return Math.abs(wall.y2 - wall.y1) <= Math.abs(wall.x2 - wall.x1)
}

function isAxisAligned(wall: ParsedWall, tolerancePx: number): boolean {
  return Math.abs(wall.x2 - wall.x1) <= tolerancePx || Math.abs(wall.y2 - wall.y1) <= tolerancePx
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function isFullyNearSheetBorder(wall: ParsedWall, width: number, height: number, margin: number): boolean {
  const xMin = Math.min(wall.x1, wall.x2)
  const xMax = Math.max(wall.x1, wall.x2)
  const yMin = Math.min(wall.y1, wall.y2)
  const yMax = Math.max(wall.y1, wall.y2)
  return (
    xMax <= margin ||
    xMin >= width - margin ||
    yMax <= margin ||
    yMin >= height - margin
  )
}

function countSupport(
  wall: ParsedWall,
  walls: ParsedWall[],
  index: number,
  snapPx: number,
): { orthogonal: number; parallel: number } {
  const horizontal = isHorizontal(wall)
  let orthogonal = 0
  let parallel = 0
  for (let i = 0; i < walls.length; i++) {
    if (i === index) continue
    const other = walls[i]
    const otherHorizontal = isHorizontal(other)
    if (horizontal === otherHorizontal) {
      if (horizontal) {
        const separation = Math.abs(other.y1 - wall.y1)
        if (separation > snapPx) continue
        const overlap = overlapLength(wall.x1, wall.x2, other.x1, other.x2)
        if (overlap >= Math.max(24, Math.min(lengthOf(wall), lengthOf(other)) * 0.2)) parallel++
      } else {
        const separation = Math.abs(other.x1 - wall.x1)
        if (separation > snapPx) continue
        const overlap = overlapLength(wall.y1, wall.y2, other.y1, other.y2)
        if (overlap >= Math.max(24, Math.min(lengthOf(wall), lengthOf(other)) * 0.2)) parallel++
      }
    } else if (horizontal) {
      const x = other.x1
      const y = wall.y1
      const inWallRange = x >= Math.min(wall.x1, wall.x2) - snapPx && x <= Math.max(wall.x1, wall.x2) + snapPx
      const inOtherRange = y >= Math.min(other.y1, other.y2) - snapPx && y <= Math.max(other.y1, other.y2) + snapPx
      if (inWallRange && inOtherRange) orthogonal++
    } else {
      const x = wall.x1
      const y = other.y1
      const inWallRange = y >= Math.min(wall.y1, wall.y2) - snapPx && y <= Math.max(wall.y1, wall.y2) + snapPx
      const inOtherRange = x >= Math.min(other.x1, other.x2) - snapPx && x <= Math.max(other.x1, other.x2) + snapPx
      if (inWallRange && inOtherRange) orthogonal++
    }
  }
  return { orthogonal, parallel }
}

export interface NoisyPrintFilterMetrics {
  profileId: 'open-vector' | 'open-hybrid' | 'open-scan'
  noiseRatio: number
  adaptiveThreshold: number
  dropped: number
  fallbackApplied: boolean
}

export interface NoisyPrintFilterResult {
  walls: ParsedWall[]
  metrics: NoisyPrintFilterMetrics
}

export function filterWallsForNoisyPrint(input: {
  walls: ParsedWall[]
  classified: ClassifiedLine[]
  stats: LineClassificationStats
  imageWidth: number
  imageHeight: number
  minWallLengthPx: number
}): NoisyPrintFilterResult {
  const {
    walls,
    classified,
    stats,
    imageWidth,
    imageHeight,
    minWallLengthPx,
  } = input
  if (walls.length < 2) {
    return {
      walls,
      metrics: {
        profileId: 'open-vector',
        noiseRatio: 0,
        adaptiveThreshold: 0,
        dropped: 0,
        fallbackApplied: false,
      },
    }
  }

  const nonWall = Math.max(0, stats.total - stats.wall)
  const noiseRatio = stats.total > 0 ? nonWall / stats.total : 0
  const lineDensity = classified.length / Math.max(1, imageWidth * imageHeight)
  const profile = selectOpenSourceContextProfile(noiseRatio, lineDensity)

  const thicknessMedian = Math.max(1, computeMedian(walls.map((w) => w.thickness)))
  const borderMargin = Math.max(8, Math.min(imageWidth, imageHeight) * profile.borderSuppressionMarginPct)
  const adaptiveThreshold = clamp(profile.baseConfidenceFloor + noiseRatio * 0.16, 0.4, 0.82)
  const supportSnapPx = Math.max(10, Math.round(minWallLengthPx * 0.16))

  const kept: ParsedWall[] = []
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i]
    const support = countSupport(wall, walls, i, supportSnapPx)
    const supportCount = support.orthogonal + support.parallel
    const len = lengthOf(wall)
    const nearBorder = isFullyNearSheetBorder(wall, imageWidth, imageHeight, borderMargin)
    const thicknessDeltaRatio = Math.abs(wall.thickness - thicknessMedian) / thicknessMedian

    let score = wall.detectionConfidence ?? 0.62
    score += Math.min(
      0.24,
      support.orthogonal * profile.orthogonalBonus + support.parallel * profile.parallelBonus,
    )

    if (!isAxisAligned(wall, 2)) score -= 0.08
    if (len < minWallLengthPx * 1.15) score -= 0.07
    if (thicknessDeltaRatio > profile.thicknessOutlierTolerance) score -= 0.12
    if (nearBorder && supportCount < profile.minSupportCount) score -= profile.borderSuppressionPenalty
    if (supportCount === 0 && len < minWallLengthPx * 1.6) score -= 0.06

    const normalizedConfidence = clamp(score, 0.05, 0.99)
    if (normalizedConfidence >= adaptiveThreshold) {
      kept.push({
        ...wall,
        detectionConfidence: normalizedConfidence,
      })
    }
  }

  const minKeep = Math.min(
    walls.length,
    Math.max(4, Math.round(walls.length * profile.minRetentionRatio)),
  )
  if (kept.length < minKeep) {
    return {
      walls,
      metrics: {
        profileId: profile.id,
        noiseRatio,
        adaptiveThreshold,
        dropped: 0,
        fallbackApplied: true,
      },
    }
  }

  return {
    walls: kept,
    metrics: {
      profileId: profile.id,
      noiseRatio,
      adaptiveThreshold,
      dropped: walls.length - kept.length,
      fallbackApplied: false,
    },
  }
}
