/**
 * WHERE A READOUT OR A CONTROL GOES ON SCREEN, so it never sits on the point
 * being placed, the pointer, the left rail or the top icon row.
 *
 * The caller offers places in order of preference, as offsets from an anchor
 * on screen. The first that fits — inside the free part of the screen and at
 * least `clear` px from every point to avoid — wins; if none fits, the one
 * that comes closest is pulled inside the free part. Screen pixels throughout.
 */
export interface XY { x: number; y: number }

/** The part of the canvas no HUD owns: right of the rail, below the top icons. */
export function freeArea(size: { width: number; height: number }) {
  let rail = 44, top = 92
  if (typeof document !== 'undefined') {
    const cs = getComputedStyle(document.documentElement)
    rail = parseFloat(cs.getPropertyValue('--rail-w')) || 44
    const t = parseFloat(cs.getPropertyValue('--top-icons-top')) || 52
    const h = parseFloat(cs.getPropertyValue('--top-icons-h')) || 40
    top = t + h
  }
  // Above the trace controls along the bottom, when they are up.
  let bottom = size.height - 64
  const bar = typeof document !== 'undefined' ? document.querySelector('[data-trace-bar]') : null
  if (bar) { const r = bar.getBoundingClientRect(); if (r.height > 0) bottom = Math.min(bottom, r.top - 4) }
  return { x1: rail + 6, y1: top + 4, x2: size.width - 6, y2: bottom }
}

export function placeClear(
  anchor: XY,
  candidates: XY[],
  box: { w: number; h: number },
  area: { x1: number; y1: number; x2: number; y2: number },
  /** Points to keep `clear` px from; one with `r` is a region that size round it. */
  avoid: Array<XY & { r?: number }>,
  clear: number,
): XY {
  const hw = box.w / 2, hh = box.h / 2
  let best = candidates[0] ?? { x: 0, y: 0 }
  let bestCost = Infinity
  for (const c of candidates) {
    const cx = anchor.x + c.x, cy = anchor.y + c.y
    const out = Math.max(0, area.x1 - (cx - hw)) + Math.max(0, (cx + hw) - area.x2)
      + Math.max(0, area.y1 - (cy - hh)) + Math.max(0, (cy + hh) - area.y2)
    // Distance from each avoided point to the box, not to its centre.
    let near = 0
    for (const p of avoid) {
      const dx = Math.max(0, Math.abs(p.x - cx) - hw), dy = Math.max(0, Math.abs(p.y - cy) - hh)
      near += Math.max(0, clear + (p.r ?? 0) - Math.hypot(dx, dy))
    }
    const cost = out * 2 + near
    if (cost === 0) return c
    if (cost < bestCost) { bestCost = cost; best = c }
  }
  const cx = Math.min(Math.max(anchor.x + best.x, area.x1 + hw), area.x2 - hw)
  const cy = Math.min(Math.max(anchor.y + best.y, area.y1 + hh), area.y2 - hh)
  return { x: cx - anchor.x, y: cy - anchor.y }
}

/** Another HUD element on the canvas, as a region to keep clear of, in the
 *  canvas's own pixels. */
export function regionOf(sel: string, canvas: HTMLElement | null): (XY & { r: number }) | null {
  if (typeof document === 'undefined' || !canvas) return null
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect()
  if (r.width === 0) return null
  return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top, r: Math.hypot(r.width, r.height) / 2 }
}
