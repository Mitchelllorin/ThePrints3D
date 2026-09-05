/**
 * SCORE THE REAL PRINTS. A ruler for the detector.
 *
 * There are four real drawing sets in `data/test-prints/` — two LA County ADUs,
 * a Portland permit set, a Ukiah bungalow — and until now nothing in the
 * codebase referenced them. Which meant every change to detection was a guess:
 * tune a threshold, load one preset, squint, form an opinion. You cannot tell
 * progress from motion that way, and a fortnight of it produces a feeling
 * rather than a result.
 *
 * This runs the WHOLE pipeline — the same `processDrawing` the app calls, PDF
 * rasterisation and all — over every print, and prints the numbers. Run it,
 * change something, run it again, and the difference is a fact.
 *
 * Dev only. Open the app and call `__scorePrints()` in the console.
 *
 * WHAT THE NUMBERS MEAN
 *
 *   walls     segments the detector kept
 *   stubs     of those, shorter than MIN_AUTO_WALL_PX — the ones that are
 *             lettering, dimension ticks and hatching read as framing. This is
 *             the number that was 72-across-18-rooms on a phone photo.
 *   stub%     stubs as a share of walls. THE headline: it is the difference
 *             between a building and a pile of offcuts.
 *   rooms     regions the room EXTRACTOR found, reading the raster directly
 *   enclosed  regions the DETECTED WALLS themselves close. The two are not the
 *             same number and the gap is the story: adu-71sqm scored 7 rooms
 *             and 0 enclosed — the app knew where the kitchen was while its
 *             walls closed nothing at all.
 *   w/room    walls per room. A house is roughly 2-4. Much higher means the
 *             detector is fragmenting real walls or inventing them.
 *   scale     did it find one? Without it every dimension is a guess, and it is
 *             the single highest-leverage thing the intake can ask for.
 *   ms        wall-clock. A tradesperson standing on a job will not wait 30s.
 *
 * There is no pass/fail here on purpose. These are real drawings with no ground
 * truth attached, so the honest use is COMPARISON — today's run against
 * yesterday's, not against an invented target.
 */
import type { Drawing } from '../types'
import { processDrawing } from '../services/drawingProcessor'
import { MIN_AUTO_WALL_PX } from '../services/modelWalls'
import { enclosedRegions } from '../services/wallEnclosure'

/** The corpus. Served straight from the project root by the dev server. */
export const TEST_PRINTS = [
  'lacounty-adu-A-3bed-1200sf.pdf',
  'lacounty-adu-B-2bed-1200sf.pdf',
  'portland-residential-permit-plans.pdf',
  'bungalow-ukiah-adu.pdf',
  /**
   * The screenshots belong in the ruler, and leaving them out hid the bug.
   *
   * Every connectivity finding on this corpus came from screenshot-adu-71sqm —
   * 50-plus walls enclosing ZERO rooms across 42 threshold configurations —
   * and yet the score that decides whether detection improved never ran it.
   * A ruler that omits the failing case reports progress by not looking.
   */
  'screenshot-adu-71sqm.png',
  'screenshot-studio-1bed.png',
] as const

export interface PrintScore {
  print: string
  walls: number
  stubs: number
  'stub%': number
  rooms: number
  /**
   * Do the WALLS enclose anything? `rooms` above is the room EXTRACTOR's
   * answer, read independently off the raster — it can find seven rooms on a
   * plan whose walls close none of them, which is exactly the state
   * screenshot-adu-71sqm was in while every guard called it a success. This is
   * the two-sided one: too few walls and the rooms merge, too many and the
   * plan shatters into slivers.
   */
  enclosed: number
  'w/room': number
  scale: string
  /** Rasterising the PDF — render + sheet pick. */
  rasterMs: number
  /** Everything after: wall detection, rooms, openings, symbols. */
  detectMs: number
  ms: number
  error?: string
}

async function fileFor(name: string): Promise<File> {
  const res = await fetch(`/data/test-prints/${name}`)
  if (!res.ok) throw new Error(`${res.status} fetching ${name}`)
  const blob = await res.blob()
  // The corpus is no longer all PDFs. Handing a PNG the PDF mime type sends it
  // down the rasteriser instead of the image path, where it fails as a corrupt
  // document rather than scoring.
  const type = name.endsWith('.png') ? 'image/png' : 'application/pdf'
  return new File([blob], name, { type })
}

/** Enough of a Drawing for the processor; the rest it fills in itself. */
function stubDrawing(file: File): Drawing {
  return {
    id: `score-${file.name}`,
    name: file.name,
    type: 'floor-plan',
    file,
    pageCount: 1,
    currentPage: 1,
    previewUrl: null,
    rasterUrl: null,
    rasterWidth: null,
    rasterHeight: null,
    parsedWalls: [],
    parsedRooms: [],
    parsedOpenings: [],
    parsedText: [],
    parsedSymbols: [],
    parsedAnnotationCandidates: [],
    parseProgress: 0,
    floorNumber: null,
    status: 'pending',
    scaleMmPerPx: null,
    scaleNotation: null,
    scaleConfidence: 'fallback',
  } as unknown as Drawing
}

/**
 * Run the corpus and print a table. Returns the rows so a run can be captured
 * and diffed against a later one.
 */
export async function scorePrints(only?: string[]): Promise<PrintScore[]> {
  const names = only?.length ? only : [...TEST_PRINTS]
  const rows: PrintScore[] = []

  for (const name of names) {
    const started = performance.now()
    try {
      /**
       * WHERE DOES THE TIME GO? A print that takes ninety seconds is not a
       * print anyone waits for, and the fix is completely different depending
       * on which half is slow: rasterising too big a canvas is a scale
       * decision, while detection crawling over ten megapixels is an algorithm
       * one. Guessing between them risks changing RASTER_SCALE, which would
       * shift every pixel-based threshold in the detector underneath us.
       *
       * processDrawing spends its first 80% of reported progress on the raster,
       * so the crossing point splits the two without touching the pipeline.
       */
      let rasterDone = 0
      const patch = await processDrawing(stubDrawing(await fileFor(name)), (pct) => {
        if (!rasterDone && pct >= 80) rasterDone = performance.now()
      })
      const rasterMs = Math.round((rasterDone || performance.now()) - started)
      const walls = patch.parsedWalls ?? []
      const stubs = walls.filter(
        (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < MIN_AUTO_WALL_PX,
      ).length
      const rooms = (patch.parsedRooms ?? []).length
      const enclosed = enclosedRegions(
        walls, patch.rasterWidth ?? 0, patch.rasterHeight ?? 0,
      )
      rows.push({
        print: name.replace(/\.(pdf|png)$/, ''),
        walls: walls.length,
        stubs,
        'stub%': walls.length ? Math.round((stubs / walls.length) * 100) : 0,
        rooms,
        enclosed,
        'w/room': rooms ? +(walls.length / rooms).toFixed(1) : 0,
        scale: patch.scaleNotation ?? (patch.scaleMmPerPx ? 'derived' : '—'),
        rasterMs,
        detectMs: Math.round(performance.now() - started) - rasterMs,
        ms: Math.round(performance.now() - started),
      })
    } catch (err) {
      rows.push({
        print: name.replace(/\.(pdf|png)$/, ''),
        walls: 0, stubs: 0, 'stub%': 0, rooms: 0, enclosed: 0, 'w/room': 0, scale: '—',
        rasterMs: 0, detectMs: 0,
        ms: Math.round(performance.now() - started),
        error: String(err).slice(0, 80),
      })
    }
  }

  // eslint-disable-next-line no-console
  console.table(rows)
  const withScale = rows.filter((r) => r.scale !== '—').length
  // eslint-disable-next-line no-console
  console.log(
    `${rows.length} prints · scale found on ${withScale}/${rows.length} · ` +
    `median stub% ${median(rows.map((r) => r['stub%']))}`,
  )
  return rows
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
