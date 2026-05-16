import * as pdfjsLib from 'pdfjs-dist'
import { RASTER_SCALE } from './constants'

// Configure worker once
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export interface RasterResult {
  /** Blob URL of the rendered page as PNG */
  blobUrl: string
  /** ImageData for further processing */
  imageData: ImageData
  width: number
  height: number
  pageCount: number
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

/** Rasterize the first page of a PDF file. */
export async function rasterizePDF(
  file: File,
  onProgress?: (pct: number) => void
): Promise<RasterResult> {
  const arrayBuffer = await file.arrayBuffer()
  onProgress?.(10)

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  onProgress?.(30)

  const page = await pdf.getPage(1)
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
    scaleNotation: null,
    scaleConfidence: 'fallback' as const,
    textTokens: [],
  }
}

/** Route to the right rasterizer based on file type. */
export async function rasterizeFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<RasterResult> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return rasterizePDF(file, onProgress)
  }
  return rasterizeImage(file, onProgress)
}
