/**
 * Room extractor
 * --------------
 * Detects enclosed room regions from a rasterized floor plan image by
 * flood-filling connected light-coloured (non-wall) areas.
 *
 * Algorithm:
 *  1. Downsample the image for performance.
 *  2. Build a binary mask: dark pixels → wall (0), light pixels → open (1).
 *  3. BFS-flood-fill each unvisited open pixel to find connected regions.
 *  4. Discard regions that touch the image border (exterior / margin).
 *  5. Discard regions below the minimum area threshold.
 *  6. Return each remaining region as a ParsedRoom with centroid, bbox, and area.
 */

import type { ParsedRoom } from '../types'

/** Pixels darker than this (0–255 grayscale) are treated as walls. */
const WALL_GRAY_THRESHOLD = 110

/**
 * Downsample factor applied before flood-fill.
 * 2 → every other pixel, making BFS 4× faster at the cost of 2px spatial precision.
 */
const DOWNSAMPLE = 2

export interface RoomExtractorOptions {
  /**
   * Minimum connected-region area in original (pre-downsample) pixels.
   * Filters out tiny alcoves, gaps in text, etc.
   * @default 600
   */
  minAreaPx?: number
  /**
   * Grayscale threshold below which a pixel counts as a wall.
   * @default 110
   */
  wallThreshold?: number
  /** Real-world scale used to compute areaSqM. */
  scaleMmPerPx?: number | null
}

/**
 * Extract enclosed room polygons from a rasterized floor plan.
 *
 * @param imageData - Raw RGBA image from a rasterized drawing sheet.
 * @param options   - Tuning parameters.
 * @returns Array of detected rooms, sorted by area descending.
 */
export function extractRooms(
  imageData: ImageData,
  options: RoomExtractorOptions = {},
): ParsedRoom[] {
  const {
    minAreaPx = 600,
    wallThreshold = WALL_GRAY_THRESHOLD,
    scaleMmPerPx = null,
  } = options

  const { data, width, height } = imageData
  const dw = Math.ceil(width / DOWNSAMPLE)
  const dh = Math.ceil(height / DOWNSAMPLE)

  // ── Build downsampled binary mask ──────────────────────────────────────────
  const binary = new Uint8Array(dw * dh)
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const sx = Math.min(dx * DOWNSAMPLE, width - 1)
      const sy = Math.min(dy * DOWNSAMPLE, height - 1)
      const i = (sy * width + sx) * 4
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      binary[dy * dw + dx] = gray > wallThreshold ? 1 : 0
    }
  }

  const visited = new Uint8Array(dw * dh)
  const rooms: ParsedRoom[] = []
  let nextId = 0

  // ── BFS flood-fill over every unvisited open pixel ─────────────────────────
  for (let startY = 0; startY < dh; startY++) {
    for (let startX = 0; startX < dw; startX++) {
      const startIdx = startY * dw + startX
      if (!binary[startIdx] || visited[startIdx]) continue

      // BFS
      const queue: number[] = [startIdx]
      visited[startIdx] = 1

      let regionCount = 0
      let sumX = 0
      let sumY = 0
      let minX = startX
      let maxX = startX
      let minY = startY
      let maxY = startY
      let touchesBorder = false

      let head = 0
      while (head < queue.length) {
        const cur = queue[head++]
        const cx = cur % dw
        const cy = (cur - cx) / dw

        regionCount++
        sumX += cx
        sumY += cy
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        if (cx === 0 || cx === dw - 1 || cy === 0 || cy === dh - 1) {
          touchesBorder = true
        }

        // 4-connectivity neighbours
        if (cy > 0) {
          const n = cur - dw
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n) }
        }
        if (cy < dh - 1) {
          const n = cur + dw
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n) }
        }
        if (cx > 0) {
          const n = cur - 1
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n) }
        }
        if (cx < dw - 1) {
          const n = cur + 1
          if (binary[n] && !visited[n]) { visited[n] = 1; queue.push(n) }
        }
      }

      // Discard exterior (border-touching) and too-small regions
      const areaPx = regionCount * DOWNSAMPLE * DOWNSAMPLE
      if (touchesBorder || areaPx < minAreaPx) continue

      const areaSqM =
        scaleMmPerPx != null
          ? (areaPx * scaleMmPerPx * scaleMmPerPx) / 1_000_000
          : null

      rooms.push({
        id: `room-${nextId++}`,
        cx: Math.round((sumX / regionCount) * DOWNSAMPLE),
        cy: Math.round((sumY / regionCount) * DOWNSAMPLE),
        x1: minX * DOWNSAMPLE,
        y1: minY * DOWNSAMPLE,
        x2: maxX * DOWNSAMPLE,
        y2: maxY * DOWNSAMPLE,
        areaPx,
        areaSqM,
      })
    }
  }

  // Largest rooms first
  return rooms.sort((a, b) => b.areaPx - a.areaPx)
}
