import * as pdfjsLib from 'pdfjs-dist'
// `?url` hands this to VITE'S resolver and gives back the real emitted asset
// path, in dev and in a build.
//
// It used to be `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`.
// That looks right and is not: 'pdfjs-dist/...' is a BARE SPECIFIER, and Vite
// only rewrites `new URL()` when the path is ./-relative. So it resolved
// literally against this file — /src/services/pdfjs-dist/build/pdf.worker.min.mjs
// — which does not exist, and the dev server answered it with index.html.
// pdf.js was being asked to start a Web Worker from an HTML document. The worker
// never came up and page.render() never settled: every PDF upload hung partway
// through rasterizing, with no error anywhere.
//
// It stayed hidden because the presets are SVG/PNG and take the image path, so
// nothing that ran regularly went through pdf.js at all.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { RASTER_SCALE } from './constants'
import {
  rankPlanPages, scorePlanSheet, thumbnailScale, type PlanSheetScore,
} from './planSheet'

// Configure worker once
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface RasterResult {
  /** Blob URL of the rendered page as PNG */
  blobUrl: string
  /** ImageData for further processing */
  imageData: ImageData
  width: number
  height: number
  pageCount: number
  /** 1-based page this result was rendered from. */
  page: number
  /** Every page scored as a candidate floor plan, best first. Empty when there
   *  was nothing to choose between (an image, or a one-page PDF). */
  pageRanking: Array<{ page: number } & PlanSheetScore>
  /** True when no sheet carried a wall signature and the pick fell back to page
   *  1 — worth saying out loud, because the sheet is probably wrong. */
  pagePickWeak: boolean
  /** Raster pixels per inch of PAPER. Known exactly for a PDF, because the page
   *  states its own size; null for a photo or an image, where nothing says how
   *  big the sheet was. Lets scale inference choose among the ~16 standard
   *  drawing scales instead of searching a continuum. */
  pxPerPaperInch: number | null
  /** Scale notation found in text layer, e.g. "1:100" */
  scaleNotation: string | null
  /** How the scale was determined: 'parsed' if found in text layer, 'fallback' otherwise */
  scaleConfidence: 'parsed' | 'fallback'
  /** Text tokens extracted from PDF text layer (empty for image uploads). */
  textTokens: RasterTextToken[]
}

export interface RasterTextToken {
  text: string
  x: number
  y: number
  confidence: number
}

const SCALE_REGEX = /\b1\s*[:/]\s*(\d+)\b|\b(\d+)\s*[:/]\s*1\b/g
const MIN_BUILDING_SCALE = 10
const MAX_BUILDING_SCALE = 500

function pickBestScaleNotation(fullText: string): string | null {
  const candidates: Array<{ notation: string; ratio: number }> = []
  for (const m of fullText.matchAll(SCALE_REGEX)) {
    const left = m[1] ? 1 : parseInt(m[2], 10)
    const right = m[1] ? parseInt(m[1], 10) : 1
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) continue
    const ratio = right / left
    const notation = `${left}:${right}`
    candidates.push({ notation, ratio })
  }
  if (candidates.length === 0) return null

  // Prefer common building scales, fallback to first detected value.
  const preferred = candidates.find(
    (c) => c.ratio >= MIN_BUILDING_SCALE && c.ratio <= MAX_BUILDING_SCALE
  )
  return preferred?.notation ?? candidates[0].notation
}

/** Render one page small, just to look at its shape. */
async function renderThumbnail(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
): Promise<ImageData | null> {
  try {
    const page = await pdf.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: thumbnailScale(base.width, base.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    // NOT `willReadFrequently` — it forces a software canvas and this set went
    // from seconds a page to ~90s when that flag was on a RENDER target. The
    // flag is for surfaces read over and over; this one is read exactly once.
    const ctx = canvas.getContext('2d')!
    // Sheets are ink on white; without this a transparent background
    // reads as luma 0 — solid ink — and every page scores as a black square.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    // One unrenderable page must not sink the whole pick.
    return null
  }
}

/**
 * Rasterize the FLOOR PLAN page of a PDF — not blindly page 1.
 *
 * A real set is seven sheets and the plan is rarely the first one; page 1 is
 * usually the site plan or a cover. Every page is rendered small, scored for
 * the wall signature, and the winner is the one rendered for real. See
 * ./planSheet.ts for what "the wall signature" means.
 *
 * @param pageOverride 1-based page to use instead of the pick — the escape
 *                     hatch for "that's the wrong sheet".
 */
export async function rasterizePDF(
  file: File,
  onProgress?: (pct: number) => void,
  pageOverride?: number,
): Promise<RasterResult> {
  const arrayBuffer = await file.arrayBuffer()
  onProgress?.(10)

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  onProgress?.(20)

  let pageNum = 1
  let pageRanking: Array<{ page: number } & PlanSheetScore> = []
  let pagePickWeak = false

  if (pageOverride && pageOverride >= 1 && pageOverride <= pdf.numPages) {
    pageNum = pageOverride
  } else if (pdf.numPages > 1) {
    // SCORED FROM PIXELS, deliberately, having tried the faster way.
    //
    // Reading each page's vector operator list instead looked obviously better
    // — no rasterizing at all. Measured on the real 1-&-2-family set it was
    // both barely faster AND wrong: 19s against 29s (two sheets carry 146k and
    // 284k paths, and building their operator lists costs as much as drawing
    // them), and it picked the SECTIONS sheet over the floor plan.
    //
    // It failed for a reason worth keeping: a path's bounding box carries no
    // STROKE WIDTH, so the thin-line test — the one thing that separates a wall
    // face from a detail drawn at 1"=1'-0" — cannot be applied to it. Rendering
    // is what turns line weight into something measurable. The cost buys the
    // correctness.
    const scores: Array<{ page: number } & PlanSheetScore> = []
    for (let p = 1; p <= pdf.numPages; p++) {
      // A page that would not render scores as a blank one rather than
      // shifting every page after it up a slot.
      const thumb = await renderThumbnail(pdf, p)
      scores.push({ page: p, ...scorePlanSheet(thumb ?? new ImageData(1, 1)) })
      onProgress?.(20 + (p / pdf.numPages) * 20)
    }
    const pick = rankPlanPages(scores)
    pageNum = pick.page
    pageRanking = pick.ranked
    pagePickWeak = pick.weak
  }
  onProgress?.(40)

  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale: RASTER_SCALE })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!

  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  onProgress?.(70)

  // Try to extract scale notation from text layer
  let scaleNotation: string | null = null
  const textTokens: RasterTextToken[] = []
    try {
      const textContent = await page.getTextContent()
      const parts: string[] = []
      for (const item of textContent.items) {
        if (!('str' in item)) continue
        const text = item.str.trim()
        if (!text) continue
        parts.push(text)
        const transform = 'transform' in item && Array.isArray(item.transform)
          ? item.transform
          : [1, 0, 0, 1, 0, 0]
        const x = Number(transform[4] ?? 0)
        const y = viewport.height - Number(transform[5] ?? 0)
        textTokens.push({ text, x, y, confidence: 0.9 })
      }
      const fullText = parts.join(' ')
      scaleNotation = pickBestScaleNotation(fullText)
    } catch {
      // Text extraction is best-effort
    }
  onProgress?.(85)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const blobUrl = await new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(URL.createObjectURL(blob!))
    }, 'image/png')
  })
  onProgress?.(100)

  return {
    blobUrl,
    imageData,
    width: canvas.width,
    height: canvas.height,
    pageCount: pdf.numPages,
    page: pageNum,
    pageRanking,
    pagePickWeak,
    // PDF user space is 72 units to the inch, so paper inches = points / 72 and
    // the rendered resolution follows. Measured off the page rather than
    // assumed from RASTER_SCALE, so it stays true if that ever changes.
    pxPerPaperInch: canvas.width / (page.getViewport({ scale: 1 }).width / 72),
    scaleNotation,
    scaleConfidence: scaleNotation !== null ? 'parsed' : 'fallback',
    textTokens,
  }
}

/** Load an image file (PNG/JPG/TIFF) into a canvas and return ImageData. */
export async function rasterizeImage(
  file: File,
  onProgress?: (pct: number) => void
): Promise<RasterResult> {
  onProgress?.(10)
  const blobUrl = URL.createObjectURL(file)

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = blobUrl
  })
  onProgress?.(60)

  // Downscale very large images to max 3000px on longest side
  const MAX = 3000
  let w = img.naturalWidth
  let h = img.naturalHeight
  if (w > MAX || h > MAX) {
    const ratio = Math.min(MAX / w, MAX / h)
    w = Math.round(w * ratio)
    h = Math.round(h * ratio)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  onProgress?.(90)

  const imageData = ctx.getImageData(0, 0, w, h)
  onProgress?.(100)

  return {
    blobUrl,
    imageData,
    width: w,
    height: h,
    pageCount: 1,
    page: 1,
    pageRanking: [],
    pagePickWeak: false,
    // A photo of a print says nothing about how big the paper was.
    pxPerPaperInch: null,
    scaleNotation: null,
    scaleConfidence: 'fallback' as const,
    textTokens: [],
  }
}

/** Route to the right rasterizer based on file type. */
export async function rasterizeFile(
  file: File,
  onProgress?: (pct: number) => void,
  pageOverride?: number,
): Promise<RasterResult> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return rasterizePDF(file, onProgress, pageOverride)
  }
  return rasterizeImage(file, onProgress)
}
