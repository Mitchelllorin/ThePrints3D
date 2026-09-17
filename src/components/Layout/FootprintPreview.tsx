/**
 * The shape, drawn, while you type it.
 *
 * Sizes and attach sides are hard to hold in your head — "12 off the bottom at
 * an offset of 14" is a sentence, not a shape. This is the shape: the outline
 * the walls will follow, with each section tinted so you can see which box you
 * just added and whether it landed where you meant.
 */
import { useMemo } from 'react'
import { placeBoxes, footprintOutline, outlineBounds, type FootprintBox } from '../../services/footprint'

export default function FootprintPreview({ boxes, height = 132 }: { boxes: FootprintBox[]; height?: number }) {
  const { path, rects, box } = useMemo(() => {
    const placed = placeBoxes(boxes)
    const poly = footprintOutline(placed)
    if (poly.length === 0) return { path: '', rects: [], box: { x1: 0, y1: 0, x2: 1, y2: 1 } }
    const b = outlineBounds(poly)
    return {
      path: poly.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z',
      rects: placed,
      box: b,
    }
  }, [boxes])

  if (!path) return null
  const pad = Math.max(box.x2 - box.x1, box.y2 - box.y1) * 0.06
  const vb = `${box.x1 - pad} ${box.y1 - pad} ${box.x2 - box.x1 + pad * 2} ${box.y2 - box.y1 + pad * 2}`
  // One stroke width in drawing units, so the outline reads the same at any size.
  const stroke = Math.max(box.x2 - box.x1, box.y2 - box.y1) * 0.012

  return (
    <svg viewBox={vb} height={height} width="100%" role="img" aria-label="Footprint shape" style={{ display: 'block' }}>
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x1} y={r.y1} width={r.x2 - r.x1} height={r.y2 - r.y1}
          fill={i === 0 ? 'rgba(61,154,232,0.18)' : 'rgba(249,115,22,0.22)'}
        />
      ))}
      <path d={path} fill="none" stroke="#e8eef5" strokeWidth={stroke} strokeLinejoin="miter" />
    </svg>
  )
}
