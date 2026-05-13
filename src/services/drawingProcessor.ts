import { rasterizeFile } from './pdfRasterizer'
import { detectWalls } from './wallDetector'
import { inferFloorNumber } from './sheetParser'
import { deriveScaleFromNotation } from './scaleParser'
import { inferDiscipline, shouldDetectWalls } from './sheetDiscipline'
import { classifyWallType, pxToMm, type DrywallConfig } from './wallTypeClassifier'
import { captureDrawing } from './datasetCollector'
import type { Drawing, ParsedWall } from '../types'

export type DrawingPatch = Partial<Drawing>

/**
 * Full processing pipeline for a single drawing.
 * Resolves with a patch to apply to the Drawing in the store.
 *
 * @param drywall Drywall configuration assumed when converting finished →
 *                framing thickness. Defaults to single-layer 5/8" both sides
 *                (residential). Override to 'double-layer' for fire-rated
 *                demising / shaft walls common in multi-unit / commercial.
 */
export async function processDrawing(
  drawing: Drawing,
  onProgress: (pct: number) => void,
  drywall: DrywallConfig = 'single-layer',
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

    // 2. Discipline gate — skip wall detection on M/E/P/C/L/F/T sheets where
    //    "thick parallels" are ducts/pipes/conduit, not walls.
    const discipline = inferDiscipline(drawing.name)
    if (!shouldDetectWalls(discipline)) {
      setProgress(100)
      const noWallPatch = {
        status: 'ready' as const,
        rasterUrl: raster.blobUrl,
        rasterWidth: raster.width,
        rasterHeight: raster.height,
        pageCount: raster.pageCount,
        parsedWalls: [],
        parseProgress: 100,
        scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
        scaleMmPerPx: drawing.scaleMmPerPx,
        floorNumber: inferFloorNumber(drawing.name) ?? drawing.floorNumber,
      }
      captureDrawing(drawing.id, {
        drawingName: drawing.name,
        fileSize: drawing.file.size,
        discipline,
        scaleNotation: noWallPatch.scaleNotation ?? null,
        wallCount: 0,
        stats: { total: 0, wall: 0, dimension: 0, dashed: 0, dotted: 0, leader: 0, unknown: 0 },
        classified: [],
        rasterWidth: raster.width,
        rasterHeight: raster.height,
      })
      return noWallPatch
    }

    // 3. Detect walls (runs in main thread — acceptable for most drawing sizes)
    setProgress(82)
    const isRasterPhoto = drawing.file.type.startsWith('image/')
    let result = detectWalls(raster.imageData, {
      // Stricter defaults reduce annotation noise (text/dimension lines)
      edgeThreshold: isRasterPhoto ? 30 : 34,
      minWallLengthPx: isRasterPhoto ? 55 : 70,
      minWallThicknessPx: 3,
      maxWallThicknessPx: 60,
      requirePairedEdges: true,
      mergeGapPx: 4,
    })
    // Fallback pass for noisy scans/photos where strict pairing can miss walls.
    if (result.walls.length === 0) {
      result = detectWalls(raster.imageData, {
        edgeThreshold: isRasterPhoto ? 26 : 30,
        minWallLengthPx: isRasterPhoto ? 40 : 55,
        minWallThicknessPx: 2,
        maxWallThicknessPx: 72,
        requirePairedEdges: false,
        mergeGapPx: 6,
      })
    }
    const classificationStats = result.stats
    setProgress(92)

    // 4. Derive scale from notation if available
    let scaleMmPerPx: number | null = null
    if (raster.scaleNotation) {
      scaleMmPerPx = deriveScaleFromNotation(raster.scaleNotation)
    }
    const effectiveScale = scaleMmPerPx ?? drawing.scaleMmPerPx

    // 5. Classify each detected wall into a structural type (2x4 / 2x6 / etc.)
    //    Only meaningful once scale is known — otherwise leave as 'unknown'.
    const walls: ParsedWall[] = result.walls.map((w) => {
      const finishedMm = pxToMm(w.thickness, effectiveScale)
      if (finishedMm === null) return { ...w, wallType: 'unknown' as const }
      const c = classifyWallType(finishedMm, drywall)
      return {
        ...w,
        wallType: c.type,
        framingMm: c.framingMm,
        finishedMm: c.finishedMm,
        typeConfidence: c.confidence,
      }
    })

    // 6. Floor number from filename
    const floorNumber = inferFloorNumber(drawing.name)

    setProgress(100)

    const readyPatch = {
      status: 'ready' as const,
      rasterUrl: raster.blobUrl,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      pageCount: raster.pageCount,
      parsedWalls: walls,
      lineClassificationStats: classificationStats,
      parseProgress: 100,
      scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
      scaleMmPerPx: effectiveScale,
      floorNumber: floorNumber ?? drawing.floorNumber,
    }

    // 7. Contribute anonymised features to the local training dataset
    captureDrawing(drawing.id, {
      drawingName: drawing.name,
      fileSize: drawing.file.size,
      discipline,
      scaleNotation: readyPatch.scaleNotation ?? null,
      wallCount: walls.length,
      stats: classificationStats,
      classified: result.classified,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
    })

    return readyPatch
  } catch (err) {
    return {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Processing failed',
      parseProgress: 0,
    }
  }
}
