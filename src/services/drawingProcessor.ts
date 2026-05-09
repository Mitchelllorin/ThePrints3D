import { rasterizeFile } from './pdfRasterizer'
import { detectWalls } from './wallDetector'
import { inferFloorNumber } from './sheetParser'
import { deriveScaleFromNotation } from './scaleParser'
import type { Drawing } from '../types'

export type DrawingPatch = Partial<Drawing>

/**
 * Full processing pipeline for a single drawing.
 * Resolves with a patch to apply to the Drawing in the store.
 */
export async function processDrawing(
  drawing: Drawing,
  onProgress: (pct: number) => void
): Promise<DrawingPatch> {
  try {
    let lastProgress = 0
    const setProgress = (pct: number) => {
      const next = Math.max(lastProgress, Math.min(100, Math.round(pct)))
      lastProgress = next
      onProgress(next)
    }

    // 1. Rasterize
    const raster = await rasterizeFile(drawing.file, (p) => setProgress(p * 0.8))

    // 2. Detect walls (runs in main thread — acceptable for most drawing sizes)
    setProgress(82)
    const isRasterPhoto = drawing.file.type.startsWith('image/')
    let walls = detectWalls(raster.imageData, {
      // Stricter defaults reduce annotation noise (text/dimension lines)
      edgeThreshold: isRasterPhoto ? 30 : 34,
      minWallLengthPx: isRasterPhoto ? 55 : 70,
      minWallThicknessPx: 3,
      maxWallThicknessPx: 60,
      requirePairedEdges: true,
      mergeGapPx: 4,
    })
    // Fallback pass for noisy scans/photos where strict pairing can miss walls.
    if (walls.length === 0) {
      walls = detectWalls(raster.imageData, {
        edgeThreshold: isRasterPhoto ? 26 : 30,
        minWallLengthPx: isRasterPhoto ? 40 : 55,
        minWallThicknessPx: 2,
        maxWallThicknessPx: 72,
        requirePairedEdges: false,
        mergeGapPx: 6,
      })
    }
    setProgress(95)

    // 3. Derive scale from notation if available
    let scaleMmPerPx: number | null = null
    if (raster.scaleNotation) {
      scaleMmPerPx = deriveScaleFromNotation(raster.scaleNotation)
    }

    // 4. Parse floor number from filename
    const floorNumber = inferFloorNumber(drawing.name)

    setProgress(100)

    return {
      status: 'ready',
      rasterUrl: raster.blobUrl,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      pageCount: raster.pageCount,
      parsedWalls: walls,
      parseProgress: 100,
      scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
      scaleMmPerPx: scaleMmPerPx ?? drawing.scaleMmPerPx,
      floorNumber: floorNumber ?? drawing.floorNumber,
    }
  } catch (err) {
    return {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Processing failed',
      parseProgress: 0,
    }
  }
}
