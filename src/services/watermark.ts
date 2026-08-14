/**
 * The free-tier watermark.
 *
 * A shared photo of someone's model is the best advertising this app has, so
 * the mark exists to say where the picture came from — not to ruin it. It sits
 * in one corner, at a size that survives being posted, and it never crosses the
 * building. A mark stamped across the middle would stop people sharing, which
 * costs more than the upgrade it is meant to sell.
 *
 * Pro skips this path entirely and exports the canvas untouched.
 */

/** Drawn at a fixed fraction of the image so it reads the same at any export size. */
const MARK = 'ThePrints3D'

/**
 * Copy the canvas, stamp the corner, and hand back a PNG data URL.
 *
 * Works on a COPY: drawing onto the live WebGL canvas would either be wiped by
 * the next frame or corrupt what the user is looking at.
 */
export function watermarkedPng(source: HTMLCanvasElement): string {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height

  const ctx = out.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')   // no 2D context: better unmarked than nothing

  ctx.drawImage(source, 0, 0)

  // Scale with the image, with a floor so a small export is still legible.
  const size = Math.max(14, Math.round(out.height * 0.028))
  const pad = Math.round(size * 0.9)

  ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'

  // A shadow rather than a plate: the mark has to hold up over white siding and
  // over the dark grid, and a box in the corner of someone's photo is uglier
  // than it needs to be.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
  ctx.shadowBlur = Math.round(size * 0.5)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(MARK, out.width - pad, out.height - pad)

  return out.toDataURL('image/png')
}
