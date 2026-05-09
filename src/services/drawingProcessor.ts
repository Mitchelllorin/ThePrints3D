import { rasterizeFile } from './pdfRasterizer'
import { detectWalls } from './wallDetector'
import { inferFloorNumber } from './sheetParser'
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
    // 1. Rasterize
    const raster = await rasterizeFile(drawing.file, (p) => onProgress(p * 0.8))

    // 2. Detect walls (runs in main thread — acceptable for most drawing sizes)
    onProgress(82)
    const isRasterPhoto = drawing.file.type.startsWith('image/')
    const walls = detectWalls(raster.imageData, {
      // Stricter defaults reduce annotation noise (text/dimension lines)
      edgeThreshold: isRasterPhoto ? 30 : 34,
      minWallLengthPx: isRasterPhoto ? 55 : 70,
      minWallThicknessPx: 3,
      maxWallThicknessPx: 60,
      requirePairedEdges: true,
      mergeGapPx: 4,
    })
    onProgress(95)

    // 3. Derive scale from notation if available
    let scaleMmPerPx: number | null = null
    if (raster.scaleNotation) {
      scaleMmPerPx = deriveScaleFromNotation(raster.scaleNotation, raster.width)
    }

    // 4. Parse floor number from filename
    const floorNumber = inferFloorNumber(drawing.name)

    onProgress(100)

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

/**
 * Estimate mm-per-pixel from a scale notation like "1:100" or "1:50".
 *
 * At 144 DPI (RASTER_SCALE=1.5 on 96 DPI), 1 PDF point = 25.4/72 mm on paper.
 * With scale 1:S, 1mm on paper = S mm real, so 1 px ≈ (25.4/72) * 1.5 * S / 1.5 ≈ 25.4/72 * S mm.
 * Simplified: scaleMmPerPx = S * 0.353
 */
function deriveScaleFromNotation(notation: string, _width: number): number | null {
  const match = notation.match(/1\s*[:/]\s*(\d+)/)
  if (match) {
    const ratio = parseInt(match[1], 10)
    const ptPerPx = 1 / 1.5  // inverse of RASTER_SCALE
    const mmPerPt = 25.4 / 72
    return ratio * mmPerPt * ptPerPx
  }
  return null
}
