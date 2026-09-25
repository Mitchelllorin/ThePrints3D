/**
 * HOW BIG A NAMEPLATE IS, before it is drawn.
 *
 * The layout has to know a plate's box BEFORE it places it, and reading it
 * back off the DOM would cost a layout pass per plate per frame. So the box is
 * fixed by these numbers, and FloatingNameplates.module.css draws with the same
 * ones. Change one, change the other.
 */
import type { Size } from '../../services/nameplateLayout'
import type { PlateContent } from './nameplateRegistry'

export const PLATE_FONT_PX = 13
export const PLATE_LINE_PX = 17
export const PLATE_PAD_X = 8
export const PLATE_PAD_Y = 4
export const PLATE_COL_GAP = 10
const BORDER = 1

let ctx: CanvasRenderingContext2D | null = null
let family = ''
function textWidth(text: string, weight: 400 | 600): number {
  if (!ctx) {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
    family = typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily : 'sans-serif'
  }
  if (!ctx) return text.length * PLATE_FONT_PX * 0.6
  ctx.font = `${weight} ${PLATE_FONT_PX}px ${family}`
  return ctx.measureText(text).width
}

export function plateLine2(c: PlateContent): string {
  return c.figure ? `${c.title} · ${c.figure}` : c.title
}

const sizeCache = new Map<string, Record<1 | 2 | 3, Size>>()
/** How big this plate is at each tier. */
export function measurePlate(c: PlateContent): Record<1 | 2 | 3, Size> {
  const key = JSON.stringify(c)
  const hit = sizeCache.get(key)
  if (hit) return hit
  const frame = (w: number, lines: number): Size => ({
    w: Math.ceil(w + PLATE_PAD_X * 2 + BORDER * 2),
    h: lines * PLATE_LINE_PX + PLATE_PAD_Y * 2 + BORDER * 2,
  })
  const t1 = frame(textWidth(c.title, 600), 1)
  const t2 = frame(textWidth(plateLine2(c), 600), 1)
  let t3 = t2
  if (c.fields && c.fields.length) {
    const lw = Math.max(...c.fields.map((f) => textWidth(f.label, 400)))
    const vw = Math.max(...c.fields.map((f) => textWidth(f.value ?? '—', 400)))
    t3 = frame(Math.max(textWidth(c.title, 600), lw + PLATE_COL_GAP + vw), 1 + c.fields.length)
  }
  const out = { 1: t1, 2: t2, 3: t3 }
  if (sizeCache.size > 500) sizeCache.clear()
  sizeCache.set(key, out)
  return out
}

