import { rasterizeFile } from './pdfRasterizer'
import { detectWallsOffThread } from './detectOffThread'
import { inferFloorNumber } from './sheetParser'
import { deriveScaleFromNotation } from './scaleParser'
import { inferDiscipline, shouldDetectWalls } from './sheetDiscipline'
import { classifyWallType, pxToMm, type DrywallConfig } from './wallTypeClassifier'
import { extractRooms } from './roomExtractor'
import { rejoinAcrossOpenings } from './openingDetector'
import type { Drawing, ParsedWall, ScaleConfidence } from '../types'
import { detectWallsWithAI } from './aiWallDetector'
import { inferScaleFromPaper, inferScaleFromStructure } from './scaleInference'
import { detectSemanticEntities } from './symbolDetection'
import { filterWallsForNoisyPrint } from './noisyPrintFilter'
import { inferCorners } from './wallTraceReducer'
import { setInkBuffer } from './inkRaster'

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
  pageOverride?: number,
): Promise<DrawingPatch> {
  try {
    let lastProgress = 0
    const setProgress = (pct: number) => {
      const next = Math.max(lastProgress, Math.min(100, Math.round(pct)))
      lastProgress = next
      onProgress(next)
    }

    // 1. Rasterize. For a multi-page set this also PICKS the sheet — the floor
    //    plan is rarely page 1 — unless the caller has named one.
    const raster = await rasterizeFile(drawing.file, (p) => setProgress(p * 0.8), pageOverride)
    // Cache a grayscale "ink" buffer so tracing can snap to the actual printed
    // line under the stroke — even on lines detection discarded as noise.
    setInkBuffer(drawing.id, raster.imageData)

    // 2. Discipline gate — skip wall detection on M/E/P/C/L/F/T sheets where
    //    "thick parallels" are ducts/pipes/conduit, not walls.
    const discipline = inferDiscipline(drawing.name)
    if (!shouldDetectWalls(discipline)) {
      setProgress(100)
      const gatedScaleConf: ScaleConfidence = raster.scaleNotation
        ? 'parsed'
        : drawing.scaleMmPerPx !== null
          ? 'inferred'
          : 'fallback'
      return {
        status: 'ready',
        rasterUrl: raster.blobUrl,
        rasterWidth: raster.width,
        rasterHeight: raster.height,
        pageCount: raster.pageCount,
        currentPage: raster.page,
        parsedWalls: [],
        parsedRooms: [],
        parsedOpenings: [],
        parsedText: [],
        parsedSymbols: [],
        parsedAnnotationCandidates: [],
        parseProgress: 100,
        scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
        scaleMmPerPx: drawing.scaleMmPerPx,
        scaleConfidence: gatedScaleConf,
        floorNumber: inferFloorNumber(drawing.name) ?? drawing.floorNumber,
      }
    }

    /**
     * 3. Detect walls — OFF THE MAIN THREAD.
     *
     * This used to run inline, with a comment saying that was "acceptable for
     * most drawing sizes". It is not, for a real sheet: ten megapixels, and up
     * to THREE full passes over it when the strict one finds nothing. Measured,
     * the smallest print in the corpus had not finished after ninety-five
     * seconds and the tab was locked solid.
     *
     * The whole ladder now goes to a worker in one message — the fallbacks only
     * fire when the previous pass came up empty, so sending them separately
     * would mean up to three round trips and three copies of the image. Falls
     * back to running inline wherever workers are unavailable, so behaviour is
     * unchanged, just no longer on the thread that has to paint.
     */
    setProgress(82)
    const isRasterPhoto = drawing.file.type.startsWith('image/')
    let result = await detectWallsWithAI(raster.imageData)
    if (!result) {
      const { result: detected } = await detectWallsOffThread(raster.imageData, [
        // Strict: reduces annotation noise (text, dimension lines).
        {
          edgeThreshold: isRasterPhoto ? 30 : 34,
          minWallLengthPx: isRasterPhoto ? 55 : 70,
          minWallThicknessPx: 3,
          maxWallThicknessPx: 60,
          requirePairedEdges: true,
          mergeGapPx: 4,
        },
        // Looser: noisy scans and photos, where strict pairing can miss walls.
        {
          edgeThreshold: isRasterPhoto ? 26 : 30,
          minWallLengthPx: isRasterPhoto ? 40 : 55,
          minWallThicknessPx: 2,
          maxWallThicknessPx: 72,
          requirePairedEdges: false,
          mergeGapPx: 6,
        },
        // Very lenient: degraded scans, low-contrast prints, hand drawings.
        {
          edgeThreshold: isRasterPhoto ? 16 : 20,
          minWallLengthPx: isRasterPhoto ? 28 : 38,
          minWallThicknessPx: 2,
          maxWallThicknessPx: 120,
          requirePairedEdges: false,
          mergeGapPx: 8,
        },
      ])
      result = detected
    }
    const filtered = filterWallsForNoisyPrint({
      walls: result.walls,
      classified: result.classified,
      stats: result.stats,
      imageWidth: raster.imageData.width,
      imageHeight: raster.imageData.height,
      minWallLengthPx: isRasterPhoto ? 40 : 55,
    })
    const classificationStats = result.stats
    setProgress(92)

    // 4. Derive scale from notation if available
    let scaleMmPerPx: number | null = null
    if (raster.scaleNotation) {
      scaleMmPerPx = deriveScaleFromNotation(raster.scaleNotation)
    }
    if (scaleMmPerPx == null && drawing.scaleMmPerPx == null) {
      // Paper-anchored first. When the sheet states its own size the question
      // collapses from "what is the scale" to "which of the standard scales",
      // which is a far easier one to get right — the free-range version put the
      // real 1-&-2-family set out by about 4×, calling every wall 600mm of
      // masonry. Falls through to the unanchored guess for photos and images,
      // where nothing says how big the paper was.
      scaleMmPerPx =
        (raster.pxPerPaperInch
          ? inferScaleFromPaper(result.walls, raster.pxPerPaperInch, drywall)?.scaleMmPerPx
          : null) ??
        inferScaleFromStructure(result.walls, drywall)?.scaleMmPerPx ??
        null
    }
    const effectiveScale = scaleMmPerPx ?? drawing.scaleMmPerPx

    // Determine confidence based on how the scale was sourced.
    const scaleConfidence: ScaleConfidence = raster.scaleNotation
      ? 'parsed'
      : effectiveScale !== null
        ? 'inferred'
        : 'fallback'

    // 5. Classify each detected wall into a structural type (2x4 / 2x6 / etc.)
    //    Only meaningful once scale is known — otherwise leave as 'unknown'.
    //    Corner inference first: perpendicular walls whose endpoints nearly
    //    meet get extended/trimmed to an exact intersection, so detected
    //    walls connect instead of floating as disjoint segments.
    const corneredWalls = inferCorners(filtered.walls)
    let walls: ParsedWall[] = corneredWalls.map((w) => {
      const finishedMm = pxToMm(w.thickness, effectiveScale)
      if (finishedMm === null) {
        return {
          ...w,
          source: w.source ?? 'auto',
          detectionConfidence: w.detectionConfidence ?? 0.65,
          wallType: 'unknown' as const,
        }
      }
      const c = classifyWallType(finishedMm, drywall)
      return {
        ...w,
        source: w.source ?? 'auto',
        detectionConfidence: w.detectionConfidence ?? c.confidence,
        wallType: c.type,
        framingMm: c.framingMm,
        finishedMm: c.finishedMm,
        typeConfidence: c.confidence,
      }
    })

    // 6. Extract enclosed room regions from the rasterized image
    const rooms = extractRooms(raster.imageData, {
      scaleMmPerPx: effectiveScale,
    })

    // 7. Detect door/window openings — and REJOIN the walls they interrupt.
    //    In framing this hole is a ROUGH OPENING (R.O.): the studs stop, king
    //    and jack studs frame the sides, a header spans it and the plate runs
    //    over the top. It is a hole in a wall, not the end of one. The detector
    //    was leaving two stub walls with a gap, so framing put a wall end where
    //    a header belongs and anything routing inside the wall stopped at the
    //    door.
    const rejoined = rejoinAcrossOpenings(walls, {
      scaleMmPerPx: effectiveScale,
    })
    walls = rejoined.walls
    const openings = rejoined.openings

    // 8. Derive text/symbol/annotation semantics by combining detector outputs
    //    with the canonical symbol glossary.
    const semantic = detectSemanticEntities({
      classifiedLines: result.classified,
      walls,
      openings,
      rooms,
      textTokens: raster.textTokens,
    })

    // 9. Floor number from filename
    const floorNumber = inferFloorNumber(drawing.name)

    setProgress(100)

    return {
      status: 'ready',
      rasterUrl: raster.blobUrl,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      pageCount: raster.pageCount,
      currentPage: raster.page,
      parsedWalls: walls,
      parsedRooms: rooms,
      parsedOpenings: openings,
      parsedText: semantic.text,
      parsedSymbols: semantic.symbols,
      parsedAnnotationCandidates: semantic.annotations,
      lineClassificationStats: classificationStats,
      parseProgress: 100,
      scaleNotation: raster.scaleNotation ?? drawing.scaleNotation,
      scaleMmPerPx: effectiveScale,
      scaleConfidence,
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
