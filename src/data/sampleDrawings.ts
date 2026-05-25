export interface SampleMEPSymbol {
  category: 'electrical' | 'plumbing' | 'fixture' | 'hvac'
  label: string
  x: number
  y: number
}

export interface SampleDrawingDef {
  id: string
  name: string
  difficulty: 'simple' | 'intermediate' | 'difficult'
  description: string
  tags: string[]
  generateSvg: (w: number, h: number) => string
  width: number
  height: number
  /** Pre-calculated mm-per-pixel for this preset's SVG dimensions */
  scaleMmPerPx: number
  /** Pre-calculated scale notation */
  scaleNotation: string
  /** Default wizard answers for this preset */
  wizardDefaults: Record<string, string | boolean>
}

/* ─── MEP Symbol Position Tracker ─────────────────────────────────────────── */
/**
 * Module-level accumulator for MEP symbol positions during SVG generation.
 * Each SVG helper (outlet, lightFixture, etc.) pushes its position here.
 * Call `clearMEPSymbols()` before generating SVG, then `flushMEPSymbols()` after.
 */
let _mepBuf: SampleMEPSymbol[] = []

export function clearMEPSymbols() { _mepBuf = [] }

/** Only call after an SVG generator function has completed. */
export function flushMEPSymbols(): SampleMEPSymbol[] {
  const r = [..._mepBuf]
  _mepBuf = []
  return r
}

function _rec(cat: SampleMEPSymbol['category'], label: string, x: number, y: number) {
  _mepBuf.push({ category: cat, label, x: Math.round(x), y: Math.round(y) })
}

/* ─── Architectural Symbol Helpers ────────────────────────────────────────── */

const WALL_W = 8       // wall stroke width (structural)
const WALL_T = 4       // thin wall (partition)

/* Wall segments ───────────────────────────────────────────────────────────── */
function wall(x1: number, y1: number, x2: number, y2: number, thick = WALL_W, cls = 'wall'): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" stroke-width="${thick}" stroke-linecap="square"/>`
}

/* Proper architectural door ─────────────────────────────────────────────────
   Shows: door leaf line + swing arc + gap in wall
   ────⌒──  (plan view: leaf is perpendicular to wall, arc shows swing) */
function door(
  wx: number, wy: number,           // point ON the wall where door is placed
  dx: number, dy: number,            // door direction vector (perpendicular to wall)
  size = 90,
): string {
  // dx,dy should be perpendicular to the wall direction
  // The door leaf is a line from the hinge point going perpendicular
  // The arc sweeps from the wall line to the door leaf
  const hingeX = wx, hingeY = wy
  const doorEndX = wx + dx * size, doorEndY = wy + dy * size

  return `
<!-- Door: leaf -->
<line x1="${hingeX}" y1="${hingeY}" x2="${doorEndX}" y2="${doorEndY}" class="door-leaf" stroke-width="2"/>
<!-- Door: swing arc -->
<path d="M ${wx} ${wy} A ${size} ${size} 0 0 1 ${doorEndX} ${doorEndY}" class="door-arc" fill="none" stroke-width="1"/>`
}

/* Door at wall endpoint ─────────────────────────────────────────────────────
   wallDir is the direction along the wall, door swings into the room
   wallDir: 'right' means door hinge is at left end, swings rightward */
function doorAt(
  wallX1: number, wallY1: number,
  wallX2: number, wallY2: number,
  ratio: number,         // 0..1 position along wall
  side: 'left' | 'right', // which side of wall the door opens to
  size = 90,
): string {
  const wx = wallX1 + (wallX2 - wallX1) * ratio
  const wy = wallY1 + (wallY2 - wallY1) * ratio
  // Direction perpendicular to wall
  const wdx = wallX2 - wallX1, wdy = wallY2 - wallY1
  const wlen = Math.sqrt(wdx * wdx + wdy * wdy)
  if (wlen === 0) return ''
  const s = side === 'right' ? 1 : -1
  const pdx = -wdy / wlen * s, pdy = wdx / wlen * s
  return door(wx, wy, pdx, pdy, size)
}

/* Proper architectural window ───────────────────────────────────────────────
   Double parallel lines + perpendicular tick marks at each end */
function windowAt(
  x1: number, y1: number,
  x2: number, y2: number,
  glassGap = 6,
): string {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return ''
  const nx = -dy / len, ny = dx / len
  return `
<!-- Window: glass lines -->
<line x1="${x1 + nx * glassGap}" y1="${y1 + ny * glassGap}" x2="${x2 + nx * glassGap}" y2="${y2 + ny * glassGap}" class="window" stroke-width="1.5"/>
<line x1="${x1 - nx * glassGap}" y1="${y1 - ny * glassGap}" x2="${x2 - nx * glassGap}" y2="${y2 - ny * glassGap}" class="window" stroke-width="1.5"/>
<!-- Window: end ticks -->
<line x1="${x1 + nx * 10}" y1="${y1 + ny * 10}" x2="${x1 - nx * 10}" y2="${y1 - ny * 10}" class="window" stroke-width="1.5"/>
<line x1="${x2 + nx * 10}" y1="${y2 + ny * 10}" x2="${x2 - nx * 10}" y2="${y2 - ny * 10}" class="window" stroke-width="1.5"/>`
}

/* Toilet ──────────────────────────────────────────────────────────────────── */
function toilet(x: number, y: number, angle = 0): string {
  _rec('plumbing', 'Toilet', x, y)
  return `<g transform="translate(${x},${y}) rotate(${angle})">
<ellipse cx="0" cy="8" rx="16" ry="22" class="fixture" fill="none" stroke-width="1.5"/>
<rect x="-14" y="-16" width="28" height="14" rx="3" class="fixture" fill="none" stroke-width="1.5"/>
<line x1="-8" y1="-10" x2="8" y2="-10" class="fixture" stroke-width="1"/>
</g>`
}

/* Sink (vanity) ───────────────────────────────────────────────────────────── */
function sink(x: number, y: number, w = 50, h = 30): string {
  _rec('fixture', 'Sink', x, y)
  return `<g transform="translate(${x},${y})">
<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="4" class="fixture" fill="none" stroke-width="1.5"/>
<ellipse cx="0" cy="0" rx="${w/2 - 6}" ry="${h/2 - 5}" class="fixture" fill="none" stroke-width="1"/>
<circle cx="0" cy="${-h/2 + 5}" r="3" class="fixture" fill="none" stroke-width="1"/>
</g>`
}

/* Kitchen counter ─────────────────────────────────────────────────────────── */
function counter(x1: number, y1: number, x2: number, y2: number, depth = 25): string {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return ''
  const nx = -dy / len * depth, ny = dx / len * depth
  return `<polygon points="${x1},${y1} ${x1 + nx},${y1 + ny} ${x2 + nx},${y2 + ny} ${x2},${y2}" class="counter" fill="none" stroke-width="1"/>`
}

/* Stove / Range ───────────────────────────────────────────────────────────── */
function stove(x: number, y: number, size = 60): string {
  const h = size / 2
  const r = size * 0.18
  return `<g transform="translate(${x},${y})">
<rect x="${-h}" y="${-h}" width="${size}" height="${size}" class="appliance" fill="none" stroke-width="1.5"/>
<circle cx="${-r}" cy="${-r}" r="${r}" class="appliance" fill="none" stroke-width="1"/>
<circle cx="${r}" cy="${-r}" r="${r}" class="appliance" fill="none" stroke-width="1"/>
<circle cx="${-r}" cy="${r}" r="${r}" class="appliance" fill="none" stroke-width="1"/>
<circle cx="${r}" cy="${r}" r="${r}" class="appliance" fill="none" stroke-width="1"/>
</g>`
}

/* Refrigerator ────────────────────────────────────────────────────────────── */
function fridge(x: number, y: number, w = 35, h = 45): string {
  return `<g transform="translate(${x},${y})">
<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" class="appliance" fill="none" stroke-width="1.5"/>
<line x1="${-w/2}" y1="${-h/2 + 8}" x2="${w/2}" y2="${-h/2 + 8}" class="appliance" stroke-width="1"/>
<text x="0" y="${h/2 + 12}" text-anchor="middle" font-size="8" class="appliance-label">REF</text>
</g>`
}

/* Electrical outlet (circle with two lines) ───────────────────────────────── */
function outlet(x: number, y: number): string {
  _rec('electrical', 'Outlet', x, y)
  return `<circle cx="${x}" cy="${y}" r="5" class="electrical" fill="none" stroke-width="1.2"/>
<line x1="${x - 2}" y1="${y}" x2="${x + 2}" y2="${y}" class="electrical" stroke-width="1.2"/>`
}

/* Light fixture (ceiling) ─────────────────────────────────────────────────── */
function lightFixture(x: number, y: number, r = 10): string {
  _rec('electrical', 'LightFixture', x, y)
  return `<circle cx="${x}" cy="${y}" r="${r}" class="electrical" fill="none" stroke-width="1"/>
<line x1="${x - r}" y1="${y}" x2="${x + r}" y2="${y}" class="electrical" stroke-width="1"/>
<line x1="${x}" y1="${y - r}" x2="${x}" y2="${y + r}" class="electrical" stroke-width="1"/>`
}

/* Switch (S) ──────────────────────────────────────────────────────────────── */
function switchSymbol(x: number, y: number): string {
  _rec('electrical', 'Switch', x, y)
  return `<text x="${x}" y="${y}" font-size="10" class="electrical" text-anchor="middle">S</text>`
}

/* Room label ──────────────────────────────────────────────────────────────── */
function roomLabel(x: number, y: number, text: string, fontSize = 12): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" class="room-label">${text}</text>`
}

/* Dimension line with tick marks ──────────────────────────────────────────── */
function dimension(
  x1: number, y1: number,
  x2: number, y2: number,
  label: string,
  offset = 40,
  tickLen = 8,
): string {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return ''
  const nx = -dy / len * offset, ny = dx / len * offset
  const tickDx = -dy / len * tickLen, tickDy = dx / len * tickLen
  return `
<line x1="${x1 + nx}" y1="${y1 + ny}" x2="${x2 + nx}" y2="${y2 + ny}" class="dimension" stroke-width="0.7"/>
<line x1="${x1 + nx - tickDx}" y1="${y1 + ny - tickDy}" x2="${x1 + nx + tickDx}" y2="${y1 + ny + tickDy}" class="dimension" stroke-width="1"/>
<line x1="${x2 + nx - tickDx}" y1="${y2 + ny - tickDy}" x2="${x2 + nx + tickDy}" y2="${y2 + ny + tickDy}" class="dimension" stroke-width="1"/>
<text x="${(x1 + x2) / 2 + nx}" y="${(y1 + y2) / 2 + ny - 8}" text-anchor="middle" font-size="9" class="dimension-text">${label}</text>`
}

/* North arrow ─────────────────────────────────────────────────────────────── */
function northArrow(x: number, y: number, size = 30): string {
  return `<g transform="translate(${x},${y})">
<line x1="0" y1="${-size}" x2="0" y2="${size}" stroke-width="1" class="north-arrow"/>
<polygon points="0,${-size - 8} ${-5},${-size + 2} ${5},${-size + 2}" class="north-arrow" fill="currentColor"/>
<text x="0" y="${-size - 12}" text-anchor="middle" font-size="11" font-weight="bold" class="north-arrow">N</text>
</g>`
}

/* Title block ─────────────────────────────────────────────────────────────── */
function titleBlock(x: number, y: number, w: number, h: number, title: string, number: string, scale: string): string {
  return `
<g transform="translate(${x},${y})">
<rect x="0" y="0" width="${w}" height="${h}" class="title-block" fill="white" stroke-width="1"/>
<line x1="0" y1="${h * 0.4}" x2="${w}" y2="${h * 0.4}" class="title-block" stroke-width="0.5"/>
<text x="8" y="${h * 0.28}" font-size="11" font-weight="bold" class="title-block-text">${title}</text>
<text x="8" y="${h * 0.55}" font-size="8" class="title-block-text">DWG: ${number}</text>
<text x="${w * 0.45}" y="${h * 0.55}" font-size="8" class="title-block-text">SCALE: ${scale}</text>
<text x="${w * 0.75}" y="${h * 0.55}" font-size="8" class="title-block-text">DATE: MAY 2026</text>
</g>`
}

/* ─── SVG Wrappers ────────────────────────────────────────────────────────── */

function svgWrap(content: string, w: number, h: number, defs: string = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
${defs}
<style>
.wall { stroke: #111; stroke-linejoin: miter; }
.door-leaf { stroke: #111; }
.door-arc { stroke: #888; stroke-dasharray: none; }
.window { stroke: #4488cc; }
.fixture { stroke: #333; }
.stairs { stroke: #555; }
.stairs-text { fill: #555; font-family: sans-serif; }
.counter { stroke: #666; }
.appliance { stroke: #444; }
.appliance-label { fill: #444; font-family: sans-serif; }
.electrical { stroke: #cc6600; }
.room-label { fill: #444; font-family: sans-serif; }
.dimension { stroke: #999; }
.dimension-text { fill: #777; font-family: sans-serif; }
.north-arrow { stroke: #333; fill: #333; font-family: sans-serif; }
.title-block { stroke: #333; fill: white; }
.title-block-text { fill: #333; font-family: sans-serif; }
.hatch { stroke: #aaa; }
</style>
</defs>
<rect width="${w}" height="${h}" fill="#fafbfc"/>
${content}
</svg>`
}

/* ─── Sample 1: Simple 3-Bedroom House ────────────────────────────────────── */

function simpleHouseSVG(w: number, h: number): string {
  const m = 80
  const bw = w - m * 2
  const bh = h - m * 2

  // House footprint
  const x0 = m, y0 = m
  const x1 = m + bw, y1 = m + bh

  // Interior walls
  const vWall1 = m + bw * 0.40  // living | kitchen
  const vWall2 = m + bw * 0.65  // kitchen | bed2
  const vWall3 = m + bw * 0.85  // bed2 | bath
  const hWall1 = m + bh * 0.55  // top rooms | bottom rooms

  let content = ''

  // ── Exterior walls ──
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)

  // ── Interior walls ──
  content += wall(vWall1, y0, vWall1, y1, WALL_T)
  content += wall(vWall2, y0, vWall2, y1, WALL_T)
  content += wall(vWall3, hWall1, x1, hWall1, WALL_T) // partial horizontal (bathroom top)
  content += wall(vWall3, y0 + bh * 0.55, vWall3, y1, WALL_T)
  content += wall(x0, hWall1, vWall1, hWall1, WALL_T)
  content += wall(vWall2, hWall1, vWall3, hWall1, WALL_T)

  // ── Doors ──
  content += doorAt(x0, y0, x1, y0, 0.48, 'right', 90)   // front door (top wall)
  content += doorAt(vWall1, y0, vWall1, hWall1, 0.30, 'right', 80)  // bed1 door
  content += doorAt(vWall2, y0, vWall2, hWall1, 0.30, 'left', 80)   // kitchen door
  content += doorAt(vWall3, y0, vWall3, y1, 0.30, 'left', 80)       // bed2 door
  content += doorAt(x0, hWall1, vWall1, hWall1, 0.60, 'left', 80)   // living to bed3
  content += doorAt(vWall3, hWall1, x1, hWall1, 0.50, 'right', 75)  // bath door

  // ── Windows ──
  content += windowAt(m + bw * 0.15, y0, m + bw * 0.30, y0)        // living
  content += windowAt(m + bw * 0.55, y0, m + bw * 0.62, y0)        // kitchen
  content += windowAt(x1, m + bh * 0.15, x1, m + bh * 0.35)        // bed1
  content += windowAt(x1, m + bh * 0.60, x1, m + bh * 0.78)        // bed2
  content += windowAt(m + bw * 0.15, y1, m + bw * 0.35, y1)        // bed3
  content += windowAt(x0, m + bh * 0.65, x0, m + bh * 0.82)        // bath

  // ── Fixtures: Bathroom ──
  const bathX = vWall3 + (x1 - vWall3) * 0.35
  const bathY = hWall1 + (y1 - hWall1) * 0.5
  content += toilet(bathX - 25, bathY - 15, 0)
  content += sink(bathX + 30, bathY - 25, 40, 25)

  // ── Kitchen ──
  content += counter(vWall1 + 15, y0 + 15, vWall1 + 15, y0 + bh * 0.40, 25)
  content += stove(vWall1 + 40, y0 + bh * 0.20, 50)
  content += fridge(vWall1 + 35, y0 + bh * 0.45, 30, 40)

  // ── Electrical ──
  content += outlet(m + bw * 0.12, y0 + 20)
  content += outlet(m + bw * 0.25, y0 + 20)
  content += outlet(vWall1 + 20, hWall1 - 15)
  content += outlet(vWall2 + 20, hWall1 - 15)
  content += outlet(m + bw * 0.50, y1 - 20)
  content += lightFixture(m + bw * 0.20, m + bh * 0.20)
  content += lightFixture(m + bw * 0.55, m + bh * 0.20)
  content += lightFixture(m + bw * 0.20, m + bh * 0.75)
  content += switchSymbol(m + bw * 0.10, y0 + 40)
  content += switchSymbol(m + bw * 0.50, y0 + 40)

  // ── Room labels ──
  content += roomLabel(m + bw * 0.20, m + bh * 0.28, 'LIVING ROOM')
  content += roomLabel(m + bw * 0.52, m + bh * 0.25, 'KITCHEN')
  content += roomLabel(m + bw * 0.75, m + bh * 0.25, 'BEDROOM 1')
  content += roomLabel(m + bw * 0.55, m + bh * 0.78, 'BEDROOM 2')
  content += roomLabel(m + bw * 0.20, m + bh * 0.78, 'BEDROOM 3')
  content += roomLabel(m + bw * 0.90, m + bh * 0.78, 'BATH')

  // ── Dimensions ──
  content += dimension(x0, y0 - 50, x1, y0 - 50, '12 000 mm')
  content += dimension(x0 - 50, y0, x0 - 50, y1, '9 000 mm')

  // ── North arrow ──
  content += northArrow(x0 + 40, y0 + 40)

  // ── Title block ──
  content += titleBlock(x1 - 280, y1 - 55, 260, 40, 'RESIDENTIAL FLOOR PLAN', 'BP-001', '1:100')

  return svgWrap(content, w, h)
}

/* ─── Sample 2: L-Shaped House with Garage ────────────────────────────────── */

function lShapedHouseSVG(w: number, h: number): string {
  const m = 60
  const leftW = w * 0.55, leftH = h * 0.60
  const rightW = w * 0.45, rightH = h * 0.40
  const lx = m, ly = m
  const rx = m + leftW, ry = m + leftH
  const rxEnd = rx + rightW, ryEnd = ry + rightH

  let content = ''

  // ── L-shaped exterior perimeter ──
  content += wall(lx, ly, lx + leftW, ly, WALL_W)             // top
  content += wall(lx + leftW, ly, lx + leftW, ry, WALL_W)    // right-down
  content += wall(lx + leftW, ry, rx, ry, WALL_W)            // bottom of left wing
  content += wall(rx, ry, rx, ryEnd, WALL_W)                 // down to bottom
  content += wall(rx, ryEnd, lx, ryEnd, WALL_W)              // bottom
  content += wall(lx, ryEnd, lx, ly, WALL_W)                 // left

  // ── Garage (right wing) ──
  content += wall(rx + 15, ry, rx + 15, ryEnd, WALL_T)       // garage partition
  content += wall(rx, ry + rightH * 0.5, rxEnd, ry + rightH * 0.5, WALL_T) // utility split

  // ── Interior walls: left wing ──
  const vW1 = lx + leftW * 0.35
  const vW2 = lx + leftW * 0.60
  const hW1 = ly + leftH * 0.50
  content += wall(vW1, ly, vW1, ly + leftH * 0.55, WALL_T)
  content += wall(vW2, ly + leftH * 0.20, vW2, ly + leftH * 0.55, WALL_T)
  content += wall(lx, hW1, vW1, hW1, WALL_T)

  // ── Doors ──
  content += doorAt(lx + leftW * 0.30, ly, lx + leftW * 0.50, ly, 0.50, 'right', 90)  // front
  content += doorAt(lx, ly + leftH * 0.30, lx, ly + leftH * 0.60, 0.40, 'left', 80)   // side
  content += doorAt(rx, ryEnd - 30, rx + rightW * 0.30, ryEnd, 0.30, 'right', 100)     // garage door (wide)
  content += doorAt(vW1, ly, vW1, hW1, 0.30, 'right', 80)
  content += doorAt(vW2, ly + leftH * 0.10, vW2, hW1, 0.30, 'left', 80)
  content += doorAt(lx, hW1, vW1, hW1, 0.60, 'left', 80)

  // ── Windows ──
  content += windowAt(lx + leftW * 0.15, ly, lx + leftW * 0.25, ly)
  content += windowAt(lx + leftW * 0.45, ly, lx + leftW * 0.55, ly)
  content += windowAt(lx + leftW, ly + leftH * 0.15, lx + leftW, ly + leftH * 0.35)
  content += windowAt(lx + leftW, ly + leftH * 0.65, lx + leftW, ry)
  content += windowAt(lx + leftW * 0.20, ryEnd, lx + leftW * 0.40, ryEnd)
  content += windowAt(rxEnd, ry + 15, rxEnd, ry + rightH * 0.35)  // garage

  // ── Bathroom fixtures ──
  const bathX = lx + leftW * 0.18
  const bathY = hW1 + (ryEnd - hW1) * 0.35
  content += toilet(bathX, bathY - 10)
  content += sink(bathX + 40, bathY - 20, 40, 25)

  // ── Kitchen ──
  content += counter(lx + leftW * 0.40 + 15, ly + 15, lx + leftW * 0.55, ly + 15, 25)
  content += stove(lx + leftW * 0.48, ly + 40, 50)
  content += fridge(lx + leftW * 0.42, ly + 75, 30, 40)

  // ── Electrical ──
  content += outlet(lx + leftW * 0.10, ly + 20)
  content += outlet(lx + leftW * 0.50, ly + 20)
  content += outlet(lx + leftW * 0.20, hW1 - 15)
  content += outlet(rx + 30, ryEnd - 20)
  content += lightFixture(lx + leftW * 0.25, ly + leftH * 0.25)
  content += lightFixture(lx + leftW * 0.48, ly + leftH * 0.25)
  content += lightFixture(lx + leftW * 0.25, hW1 + (ryEnd - hW1) * 0.5)
  content += switchSymbol(lx + leftW * 0.08, ly + 45)

  // ── Room labels ──
  content += roomLabel(lx + leftW * 0.18, ly + leftH * 0.28, 'LOUNGE')
  content += roomLabel(lx + leftW * 0.48, ly + leftH * 0.15, 'KITCHEN')
  content += roomLabel(lx + leftW * 0.75, ly + leftH * 0.28, 'MASTER BED')
  content += roomLabel(lx + leftW * 0.48, hW1 + (ryEnd - hW1) * 0.25, 'BEDROOM 2')
  content += roomLabel(lx + leftW * 0.18, hW1 + (ryEnd - hW1) * 0.35, 'BATH')
  content += roomLabel(rx + rightW * 0.50, ry + rightH * 0.25, 'GARAGE', 10)
  content += roomLabel(rx + rightW * 0.50, ry + rightH * 0.70, 'UTILITY', 10)

  // ── Dimensions ──
  content += dimension(lx, ly - 45, lx + leftW, ly - 45, '7 800')
  content += dimension(lx - 45, ly, lx - 45, ryEnd, '9 000')

  content += northArrow(lx + 35, ly + 35)
  content += titleBlock(rxEnd - 280, ryEnd - 55, 260, 40, 'L-SHAPE RESIDENCE', 'BP-002', '1:100')

  return svgWrap(content, w, h)
}

/* ─── Sample 3: Commercial Office Floor ───────────────────────────────────── */

function officeSVG(w: number, h: number): string {
  const m = 50
  const bw = w - m * 2
  const bh = h - m * 2
  const corridorY = m + bh * 0.42
  const corridorH = 100

  let content = ''

  // ── Exterior walls ──
  content += wall(m, m, m + bw, m, WALL_W)
  content += wall(m + bw, m, m + bw, m + bh, WALL_W)
  content += wall(m + bw, m + bh, m, m + bh, WALL_W)
  content += wall(m, m + bh, m, m, WALL_W)

  // ── Corridor walls ──
  content += wall(m, corridorY, m + bw, corridorY, WALL_T)
  content += wall(m, corridorY + corridorH, m + bw, corridorY + corridorH, WALL_T)

  // ── Room partitions above corridor ──
  const roomsAbove = [0.15, 0.32, 0.48, 0.65, 0.80]
  for (const r of roomsAbove) {
    content += wall(m + bw * r, m, m + bw * r, corridorY, WALL_T)
  }
  // Extra wall in rightmost office (meeting room split)
  content += wall(m + bw * 0.80, m + bh * 0.12, m + bw * 0.92, m + bh * 0.12, WALL_T)
  content += wall(m + bw * 0.92, m, m + bw * 0.92, corridorY, WALL_T)

  // ── Room partitions below corridor ──
  const roomsBelow = [0.12, 0.28, 0.45, 0.62, 0.78]
  for (const r of roomsBelow) {
    content += wall(m + bw * r, corridorY + corridorH, m + bw * r, m + bh, WALL_T)
  }
  // Storage room split
  content += wall(m + bw * 0.12, m + bh * 0.80, m + bw * 0.28, m + bh * 0.80, WALL_T)

  // ── Doors: corridor access (above) ──
  for (const r of roomsAbove) {
    content += doorAt(m + bw * r, corridorY - 1, m + bw * (r + 0.17), corridorY - 1, 0.45, 'left', 80)
  }
  // Doors: corridor access (below)
  for (const r of roomsBelow) {
    content += doorAt(m + bw * r, corridorY + corridorH + 1, m + bw * (r + 0.17), corridorY + corridorH + 1, 0.45, 'right', 80)
  }
  // Main entrance
  content += doorAt(m + bw * 0.45, m + bh - 1, m + bw * 0.55, m + bh - 1, 0.50, 'left', 110)
  // Fire exits
  content += doorAt(m, corridorY + corridorH * 0.5, m + bw * 0.05, corridorY + corridorH * 0.5, 0.50, 'left', 90)
  content += doorAt(m + bw * 0.95, corridorY + corridorH * 0.5, m + bw, corridorY + corridorH * 0.5, 0.50, 'right', 90)

  // ── Windows (curtain wall on exterior) ──
  content += windowAt(m + bw * 0.08, m, m + bw * 0.18, m)
  content += windowAt(m + bw * 0.25, m, m + bw * 0.35, m)
  content += windowAt(m + bw * 0.52, m, m + bw * 0.62, m)
  content += windowAt(m + bw * 0.75, m, m + bw * 0.85, m)
  content += windowAt(m + bw, m + bh * 0.15, m + bw, m + bh * 0.30)
  content += windowAt(m + bw, m + bh * 0.70, m + bw, m + bh * 0.85)

  // ── Core: restrooms ──
  const wcX = m + bw * 0.92, wcY = corridorY + corridorH + (m + bh - corridorY - corridorH) * 0.5
  content += toilet(wcX - 20, wcY - 25)
  content += toilet(wcX - 20, wcY + 15)
  content += sink(wcX + 35, wcY - 15, 45, 25)
  content += sink(wcX + 35, wcY + 25, 45, 25)

  // ── Kitchenette ──
  const kitX = m + bw * 0.12, kitY = m + bh * 0.80 + (m + bh - m - bh * 0.80) * 0.5
  content += counter(kitX - 30, kitY - 20, kitX + 30, kitY - 20, 25)
  content += sink(kitX, kitY - 10, 50, 25)

  // ── Electrical ──
  content += outlet(m + bw * 0.08, m + 20)
  content += outlet(m + bw * 0.30, m + 20)
  content += outlet(m + bw * 0.55, m + 20)
  content += outlet(m + bw * 0.78, m + 20)
  content += outlet(m + bw * 0.15, m + bh - 20)
  content += outlet(m + bw * 0.35, m + bh - 20)
  content += outlet(m + bw * 0.65, m + bh - 20)
  content += lightFixture(m + bw * 0.15, m + bh * 0.20, 12)
  content += lightFixture(m + bw * 0.40, m + bh * 0.20, 12)
  content += lightFixture(m + bw * 0.65, m + bh * 0.20, 12)
  content += lightFixture(m + bw * 0.40, corridorY + corridorH / 2, 14)
  content += lightFixture(m + bw * 0.15, m + bh * 0.75, 12)
  content += lightFixture(m + bw * 0.55, m + bh * 0.75, 12)
  content += switchSymbol(m + bw * 0.06, m + 45)
  content += switchSymbol(m + bw * 0.30, m + 45)

  // ── Room labels ──
  content += roomLabel(m + bw * 0.075, m + bh * 0.20, 'OFFICE 1', 10)
  content += roomLabel(m + bw * 0.235, m + bh * 0.20, 'OFFICE 2', 10)
  content += roomLabel(m + bw * 0.40, m + bh * 0.20, 'OFFICE 3', 10)
  content += roomLabel(m + bw * 0.565, m + bh * 0.20, 'OFFICE 4', 10)
  content += roomLabel(m + bw * 0.72, m + bh * 0.12, 'MD SUITE', 10)
  content += roomLabel(m + bw * 0.86, m + bh * 0.12, 'CONF', 10)
  content += roomLabel(m + bw * 0.45, corridorY + corridorH / 2, 'CORRIDOR', 10)
  content += roomLabel(m + bw * 0.08, m + bh * 0.72, 'STORE', 10)
  content += roomLabel(m + bw * 0.20, m + bh * 0.72, 'KITCHEN', 10)
  content += roomLabel(m + bw * 0.365, m + bh * 0.72, 'MEETING', 10)
  content += roomLabel(m + bw * 0.535, m + bh * 0.72, 'OFFICE 5', 10)
  content += roomLabel(m + bw * 0.70, m + bh * 0.72, 'OFFICE 6', 10)
  content += roomLabel(m + bw * 0.86, m + bh * 0.72, 'W/C', 10)

  // ── Fire exit labels ──
  content += `<text x="${m + bw * 0.02}" y="${corridorY + corridorH / 2}" text-anchor="middle" font-size="9" fill="#cc3300" font-weight="bold" font-family="sans-serif">FIRE EXIT</text>`

  // ── Dimensions ──
  content += dimension(m, m - 45, m + bw, m - 45, '18 000 mm')
  content += dimension(m - 45, m, m - 45, m + bh, '12 000 mm')
  content += dimension(m + bw + 45, corridorY, m + bw + 45, corridorY + corridorH, '1 800', 45)

  content += northArrow(m + 35, m + 35)
  content += titleBlock(m + bw - 280, m + bh - 55, 260, 40, 'COMMERCIAL OFFICE — LEVEL 1', 'BP-003', '1:100')

  return svgWrap(content, w, h)
}

/* ─── Simple 2: Tiny Studio Apartment ───────────────────────────────────── */

function studioSVG(w: number, h: number): string {
  const m = 60, bw = w - m * 2, bh = h - m * 2
  const x0 = m, y0 = m, x1 = m + bw, y1 = m + bh
  let content = ''
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)
  const bathX = x1 - 180
  content += wall(bathX, y0, bathX, y0 + 200, WALL_T)
  content += wall(bathX, y0 + 200, x1, y0 + 200, WALL_T)
  content += doorAt(bathX, y0, x1, y0, 0.5, 'left', 75)
  content += windowAt(x0 + 50, y0, x0 + 150, y0)
  content += windowAt(x1, y1 - 120, x1, y1 - 40)
  content += toilet(bathX + 40, y0 + 60, 0)
  content += sink(bathX + 90, y0 + 130, 35, 22)
  content += stove(m + 80, y0 + 40, 50)
  content += fridge(m + bw * 0.35, y0 + bh * 0.65, 28, 38)
  content += outlet(m + 40, y0 + 30)
  content += outlet(m + bw * 0.5, y1 - 20)
  content += lightFixture(x0 + bw * 0.3, y0 + bh * 0.4)
  content += roomLabel(x0 + bw * 0.3, y0 + bh * 0.3, 'STUDIO')
  content += roomLabel(bathX + 60, y0 + 100, 'BATH')
  content += dimension(x0, y0 - 50, x1, y0 - 50, '7 200 mm')
  content += dimension(x0 - 50, y0, x0 - 50, y1, '5 400 mm')
  content += northArrow(x0 + 35, y0 + 35)
  content += titleBlock(x1 - 260, y1 - 50, 240, 36, 'STUDIO APARTMENT', 'BP-004', '1:100')
  return svgWrap(content, w, h)
}

/* ─── Simple 3: Small Cottage ────────────────────────────────────────────── */

function cottageSVG(w: number, h: number): string {
  const m = 50, bw = w - m * 2, bh = h - m * 2
  const x0 = m, y0 = m, x1 = m + bw, y1 = m + bh
  let content = ''
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)
  const vDiv = x0 + bw * 0.55
  const hDiv1 = y0 + bh * 0.38
  const hDiv2 = y0 + bh * 0.70
  content += wall(vDiv, y0, vDiv, y1, WALL_T)
  content += wall(x0, hDiv1, vDiv, hDiv1, WALL_T)
  content += wall(x0, hDiv2, vDiv, hDiv2, WALL_T)
  content += doorAt(x0, hDiv1, vDiv, hDiv1, 0.45, 'right', 80)
  content += doorAt(x0, hDiv2, vDiv, hDiv2, 0.45, 'left', 80)
  content += doorAt(vDiv, hDiv1, x1, hDiv1, 0.5, 'left', 75)
  content += windowAt(x0 + 30, y0, x0 + 130, y0)
  content += windowAt(x1 - 130, y0, x1 - 30, y0)
  content += windowAt(x0 + 30, y1, x0 + 130, y1)
  content += windowAt(x1, y0 + bh * 0.3, x1, y0 + bh * 0.5)
  content += toilet(vDiv + 60, y0 + 50, 0)
  content += sink(vDiv + 110, y0 + 90, 35, 22)
  content += stove(x0 + 30, hDiv1 + 25, 45)
  content += outlet(x0 + 50, hDiv1 - 15)
  content += outlet(vDiv + 20, hDiv1 - 15)
  content += lightFixture(x0 + bw * 0.25, y0 + bh * 0.15)
  content += lightFixture(x0 + bw * 0.25, y0 + bh * 0.55)
  content += roomLabel(x0 + bw * 0.12, y0 + bh * 0.12, 'BEDROOM')
  content += roomLabel(x0 + bw * 0.12, hDiv1 + bh * 0.12, 'LIVING')
  content += roomLabel(x0 + bw * 0.12, hDiv2 + bh * 0.12, 'KITCHEN')
  content += roomLabel(vDiv + bw * 0.12, y0 + bh * 0.12, 'BATH')
  content += roomLabel(vDiv + bw * 0.12, hDiv1 + bh * 0.12, 'BED 2')
  content += dimension(x0, y0 - 50, x1, y0 - 50, '8 400 mm')
  content += dimension(x0 - 50, y0, x0 - 50, y1, '6 000 mm')
  content += northArrow(x0 + 35, y0 + 35)
  content += titleBlock(x1 - 260, y1 - 50, 240, 36, 'COTTAGE', 'BP-005', '1:100')
  return svgWrap(content, w, h)
}

/* ─── Intermediate 2: Duplex Unit ───────────────────────────────────────── */

function duplexSVG(w: number, h: number): string {
  const m = 50, bw = w - m * 2, bh = h - m * 2
  const x0 = m, y0 = m, x1 = m + bw, y1 = m + bh
  const midX = x0 + bw * 0.5
  let content = ''
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)
  content += wall(midX, y0, midX, y1, WALL_T)
  content += doorAt(midX, y0, x1, y0, 0.4, 'right', 80)
  content += doorAt(x0, y0, midX, y0, 0.4, 'left', 80)
  const roomsL = [
    { x: x0 + 30, y: y0 + 30, w: midX - x0 - 60, h: bh * 0.45 },
    { x: x0 + 30, y: y0 + bh * 0.55, w: midX - x0 - 60, h: bh * 0.45 },
  ]
  const roomsR = [
    { x: midX + 30, y: y0 + 30, w: x1 - midX - 60, h: bh * 0.45 },
    { x: midX + 30, y: y0 + bh * 0.55, w: x1 - midX - 60, h: bh * 0.45 },
  ]
  for (const r of roomsL) {
    content += wall(r.x, r.y, r.x + r.w, r.y, WALL_T)
    content += wall(r.x + r.w, r.y, r.x + r.w, r.y + r.h, WALL_T)
    content += wall(r.x + r.w, r.y + r.h, r.x, r.y + r.h, WALL_T)
    content += wall(r.x, r.y + r.h, r.x, r.y, WALL_T)
  }
  for (const r of roomsR) {
    content += wall(r.x, r.y, r.x + r.w, r.y, WALL_T)
    content += wall(r.x + r.w, r.y, r.x + r.w, r.y + r.h, WALL_T)
    content += wall(r.x + r.w, r.y + r.h, r.x, r.y + r.h, WALL_T)
    content += wall(r.x, r.y + r.h, r.x, r.y, WALL_T)
  }
  content += doorAt(roomsL[0].x + roomsL[0].w, roomsL[0].y, roomsL[0].x + roomsL[0].w, roomsL[0].y + roomsL[0].h, 0.3, 'left', 70)
  content += doorAt(roomsL[1].x, roomsL[1].y, roomsL[1].x, roomsL[1].y + roomsL[1].h, 0.3, 'right', 70)
  content += doorAt(roomsR[0].x, roomsR[0].y, roomsR[0].x, roomsR[0].y + roomsR[0].h, 0.3, 'right', 70)
  content += doorAt(roomsR[1].x + roomsR[1].w, roomsR[1].y, roomsR[1].x + roomsR[1].w, roomsR[1].y + roomsR[1].h, 0.3, 'left', 70)
  content += windowAt(x0 + 30, y0, x0 + 120, y0)
  content += windowAt(midX + 50, y0, midX + 140, y0)
  content += windowAt(x0 + 30, y1, x0 + 120, y1)
  content += windowAt(midX + 50, y1, midX + 140, y1)
  content += outlet(x0 + 50, y0 + bh * 0.2)
  content += outlet(midX + 40, y0 + bh * 0.2)
  content += lightFixture(x0 + bw * 0.15, y0 + bh * 0.2)
  content += lightFixture(midX + bw * 0.15, y0 + bh * 0.2)
  content += roomLabel(x0 + bw * 0.1, y0 + bh * 0.15, 'UNIT A')
  content += roomLabel(midX + bw * 0.1, y0 + bh * 0.15, 'UNIT B')
  content += dimension(x0, y0 - 50, x1, y0 - 50, '10 200 mm')
  content += dimension(x0 - 50, y0, x0 - 50, y1, '7 200 mm')
  content += northArrow(x0 + 35, y0 + 35)
  content += titleBlock(x1 - 260, y1 - 50, 240, 36, 'DUPLEX', 'BP-006', '1:100')
  return svgWrap(content, w, h)
}

/* ─── Intermediate 3: Townhouse ─────────────────────────────────────────── */

function townhouseSVG(w: number, h: number): string {
  const m = 50, bw = w - m * 2, bh = h - m * 2
  const x0 = m, y0 = m, x1 = m + bw, y1 = m + bh
  let content = ''
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)
  const hDiv = y0 + bh * 0.45
  const vDiv1 = x0 + bw * 0.48
  const vDiv2 = x0 + bw * 0.35
  content += wall(x0, hDiv, x1, hDiv, WALL_T)
  content += wall(vDiv1, hDiv, vDiv1, y1, WALL_T)
  content += wall(vDiv2, y0, vDiv2, hDiv, WALL_T)
  content += doorAt(vDiv2, hDiv, x1, hDiv, 0.35, 'right', 80)
  content += doorAt(vDiv1, hDiv, x1, hDiv, 0.55, 'left', 80)
  content += doorAt(x0, y0, vDiv2, y0, 0.35, 'right', 80)
  content += windowAt(x0 + 25, y0, x0 + 110, y0)
  content += windowAt(vDiv2 + 25, y0, vDiv2 + 110, y0)
  content += windowAt(x1 - 110, y0, x1 - 25, y0)
  content += windowAt(x0 + 25, y1, x0 + 110, y1)
  content += windowAt(vDiv1 + 25, y1, vDiv1 + 110, y1)
  content += outlet(x0 + 50, y0 + bh * 0.2)
  content += outlet(vDiv2 + 40, y0 + bh * 0.2)
  content += lightFixture(x0 + bw * 0.15, y0 + bh * 0.15)
  content += lightFixture(vDiv1 + bw * 0.1, hDiv + bh * 0.2)
  content += toilet(vDiv1 + 40, hDiv + 60, 0)
  content += sink(vDiv1 + 90, hDiv + 100, 35, 22)
  content += stove(vDiv2 + 25, y0 + 35, 45)
  content += roomLabel(x0 + bw * 0.1, y0 + bh * 0.15, 'LIVING')
  content += roomLabel(vDiv2 + bw * 0.06, y0 + bh * 0.15, 'KITCHEN')
  content += roomLabel(x0 + bw * 0.1, hDiv + bh * 0.15, 'BEDROOM')
  content += roomLabel(vDiv1 + bw * 0.06, hDiv + bh * 0.15, 'BATH')
  content += dimension(x0, y0 - 50, x1, y0 - 50, '9 000 mm')
  content += dimension(x0 - 50, y0, x0 - 50, y1, '7 800 mm')
  content += northArrow(x0 + 35, y0 + 35)
  content += titleBlock(x1 - 260, y1 - 50, 240, 36, 'TOWNHOUSE', 'BP-007', '1:100')
  return svgWrap(content, w, h)
}

/* ─── Difficult 2: Medical Suite ─────────────────────────────────────────── */

function medicalSVG(w: number, h: number): string {
  const m = 50, bw = w - m * 2, bh = h - m * 2
  const x0 = m, y0 = m, x1 = m + bw, y1 = m + bh
  let content = ''
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)
  const corridorX = x0 + 320
  content += wall(corridorX, y0, corridorX, y1, WALL_T)
  const hDivs = [y0 + bh * 0.25, y0 + bh * 0.50, y0 + bh * 0.75]
  for (const hd of hDivs) {
    content += wall(x0, hd, corridorX, hd, WALL_T)
    content += doorAt(corridorX, hd, x1, hd, 0.15, 'right', 80)
  }
  content += doorAt(x0, hDivs[0], corridorX, hDivs[0], 0.7, 'left', 90)
  content += doorAt(x0, hDivs[1], corridorX, hDivs[1], 0.7, 'left', 90)
  content += doorAt(x0, hDivs[2], corridorX, hDivs[2], 0.7, 'left', 90)
  const rooms = [
    { x: x0 + 20, y: y0 + 20, w: corridorX - x0 - 40, h: hDivs[0] - y0 - 30 },
    { x: x0 + 20, y: hDivs[0] + 20, w: corridorX - x0 - 40, h: hDivs[1] - hDivs[0] - 30 },
    { x: x0 + 20, y: hDivs[1] + 20, w: corridorX - x0 - 40, h: hDivs[2] - hDivs[1] - 30 },
  ]
  for (const r of rooms) {
    content += wall(r.x, r.y, r.x + r.w, r.y, WALL_T)
    content += wall(r.x + r.w, r.y, r.x + r.w, r.y + r.h, WALL_T)
    content += wall(r.x + r.w, r.y + r.h, r.x, r.y + r.h, WALL_T)
    content += wall(r.x, r.y + r.h, r.x, r.y, WALL_T)
  }
  const examRoomX = corridorX + 30, examRoomW = x1 - corridorX - 40
  content += wall(examRoomX, y0 + 20, examRoomX + examRoomW, y0 + 20, WALL_T)
  content += wall(examRoomX + examRoomW, y0 + 20, examRoomX + examRoomW, hDivs[0] - 20, WALL_T)
  content += sink(examRoomX + examRoomW - 40, y0 + 35, 30, 20)
  content += windowAt(x0 + 20, y0, x0 + 120, y0)
  content += windowAt(x1 - 120, y1, x1 - 20, y1)
  content += outlet(x0 + 50, y0 + 30)
  content += outlet(corridorX + 40, y0 + 30)
  content += lightFixture(x0 + bw * 0.15, y0 + bh * 0.12)
  content += lightFixture(corridorX + bw * 0.08, y0 + bh * 0.12)
  content += roomLabel(x0 + 40, y0 + bh * 0.1, 'RECEPTION')
  content += roomLabel(x0 + 40, hDivs[0] + bh * 0.1, 'EXAM 1')
  content += roomLabel(x0 + 40, hDivs[1] + bh * 0.1, 'EXAM 2')
  content += roomLabel(corridorX + 30, hDivs[0] + bh * 0.08, 'LAB')
  content += roomLabel(corridorX + 10, y0 + bh * 0.5, 'CORRIDOR')
  content += dimension(x0, y0 - 50, x1, y0 - 50, '14 400 mm')
  content += northArrow(x0 + 35, y0 + 35)
  content += titleBlock(x1 - 260, y1 - 50, 240, 36, 'MEDICAL SUITE', 'BP-008', '1:100')
  return svgWrap(content, w, h)
}

/* ─── Difficult 3: Retail Space ──────────────────────────────────────────── */

function retailSVG(w: number, h: number): string {
  const m = 50, bw = w - m * 2, bh = h - m * 2
  const x0 = m, y0 = m, x1 = m + bw, y1 = m + bh
  let content = ''
  content += wall(x0, y0, x1, y0, WALL_W)
  content += wall(x1, y0, x1, y1, WALL_W)
  content += wall(x1, y1, x0, y1, WALL_W)
  content += wall(x0, y1, x0, y0, WALL_W)
  const entry = x0 + bw * 0.3
  const backWall = y0 + bh * 0.65
  const stockWallX = x0 + bw * 0.72
  content += wall(x0, backWall, x1, backWall, WALL_T)
  content += wall(stockWallX, backWall, stockWallX, y1, WALL_T)
  content += wall(entry, y0, entry, backWall, WALL_T)
  content += doorAt(entry, y0, x1, y0, 0.2, 'right', 120)
  content += doorAt(stockWallX, backWall, x1, backWall, 0.2, 'right', 90)
  content += doorAt(x0, backWall, stockWallX, backWall, 0.5, 'left', 80)
  content += windowAt(x0 + 20, y0, entry - 20, y0)
  content += windowAt(entry + 40, y0, x1 - 20, y0)
  content += windowAt(x1, y0 + bh * 0.15, x1, y0 + bh * 0.35)
  content += windowAt(x0 + 20, y1, x0 + 140, y1)
  content += outlet(x0 + 50, y0 + 30)
  content += outlet(stockWallX + 30, backWall + 30)
  content += lightFixture(x0 + bw * 0.15, y0 + bh * 0.15)
  content += lightFixture(x0 + bw * 0.15, y0 + bh * 0.45)
  content += lightFixture(stockWallX + bw * 0.05, backWall + bh * 0.1)
  content += sink(stockWallX + 30, backWall + 50, 35, 22)
  content += toilet(stockWallX + 90, backWall + 50, 0)
  content += roomLabel(x0 + 40, y0 + bh * 0.1, 'RETAIL FLOOR')
  content += roomLabel(x0 + 40, backWall + bh * 0.08, 'FITTING')
  content += roomLabel(stockWallX + 20, backWall + bh * 0.08, 'STOCK')
  content += roomLabel(stockWallX + 20, backWall + bh * 0.35, 'STAFF')
  content += dimension(x0, y0 - 50, x1, y0 - 50, '16 800 mm')
  content += dimension(x0 - 50, y0, x0 - 50, y1, '9 600 mm')
  content += northArrow(x0 + 35, y0 + 35)
  content += titleBlock(x1 - 260, y1 - 50, 240, 36, 'RETAIL SPACE', 'BP-009', '1:100')
  return svgWrap(content, w, h)
}

/* ─── Sample definitions ──────────────────────────────────────────────────── */

export const SAMPLE_DRAWINGS: SampleDrawingDef[] = [
  {
    id: 'sample-simple',
    name: '3-Bedroom House',
    difficulty: 'simple',
    description: 'Standard residential floor plan with 3 bedrooms, living room, kitchen, and bathroom.',
    tags: ['residential', '3-bed', 'complete'],
    generateSvg: simpleHouseSVG,
    width: 1200,
    height: 900,
    scaleMmPerPx: 11.54,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true',
      'units': 'metric',
      'ceiling-height': '2.7',
      'door-symbol': 'true',
      'window-symbol': 'true',
      'circle-symbols': 'lights',
      'square-symbols': 'switches',
      'hatch-symbols': 'wet',
      'exterior-thick': 'true',
      'interior-thin': 'true',
      'wall-material': 'timber',
      'room-count': 'ai',
      'main-entrance': 'south',
      'has-electrical': 'true',
      'has-plumbing': 'true',
      'has-hvac': 'true',
      'has-structural': 'true',
    },
  },
  {
    id: 'sample-intermediate',
    name: 'L-Shape with Garage',
    difficulty: 'intermediate',
    description: 'L-shaped residence with attached garage and utility room.',
    tags: ['residential', 'l-shape', 'garage'],
    generateSvg: lShapedHouseSVG,
    width: 1400,
    height: 1000,
    scaleMmPerPx: 10.13,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true',
      'units': 'metric',
      'ceiling-height': '2.7',
      'door-symbol': 'true',
      'window-symbol': 'true',
      'circle-symbols': 'lights',
      'square-symbols': 'switches',
      'hatch-symbols': 'wet',
      'exterior-thick': 'true',
      'interior-thin': 'true',
      'wall-material': 'timber',
      'room-count': 'ai',
      'main-entrance': 'south',
      'has-electrical': 'true',
      'has-plumbing': 'true',
      'has-hvac': 'true',
      'has-structural': 'true',
    },
  },
  {
    id: 'sample-difficult',
    name: 'Commercial Office',
    difficulty: 'difficult',
    description: 'Full office floor with central corridor, 8 offices, meeting rooms, restrooms, and kitchenette.',
    tags: ['commercial', 'office', 'complex'],
    generateSvg: officeSVG,
    width: 1800,
    height: 1200,
    scaleMmPerPx: 10.59,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true',
      'units': 'metric',
      'ceiling-height': '3.0',
      'door-symbol': 'true',
      'window-symbol': 'true',
      'circle-symbols': 'lights',
      'square-symbols': 'switches',
      'hatch-symbols': 'wet',
      'exterior-thick': 'true',
      'interior-thin': 'true',
      'wall-material': 'steel',
      'steel-stud-thickness': '5.625',
      'steel-gauge': '18',
      'room-count': 'ai',
      'main-entrance': 'south',
      'has-electrical': 'true',
      'has-plumbing': 'true',
      'has-hvac': 'true',
      'has-structural': 'true',
    },
  },
  {
    id: 'sample-studio',
    name: 'Tiny Studio Apartment',
    difficulty: 'simple',
    description: 'Compact studio apartment with open living/sleeping area, bathroom and kitchenette.',
    tags: ['residential', 'studio', 'compact'],
    generateSvg: studioSVG,
    width: 1000,
    height: 800,
    scaleMmPerPx: 10.0,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true', 'units': 'metric', 'ceiling-height': '2.5',
      'door-symbol': 'true', 'window-symbol': 'true',
      'exterior-thick': 'true', 'interior-thin': 'true',
      'wall-material': 'timber', 'room-count': 'ai',
      'has-electrical': 'true', 'has-plumbing': 'true',
    },
  },
  {
    id: 'sample-cottage',
    name: 'Small Cottage',
    difficulty: 'simple',
    description: 'Cozy cottage with two bedrooms, living room, kitchen, and bathroom.',
    tags: ['residential', 'cottage', '2-bed'],
    generateSvg: cottageSVG,
    width: 1100,
    height: 850,
    scaleMmPerPx: 10.25,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true', 'units': 'metric', 'ceiling-height': '2.7',
      'door-symbol': 'true', 'window-symbol': 'true',
      'circle-symbols': 'lights', 'square-symbols': 'switches',
      'exterior-thick': 'true', 'interior-thin': 'true',
      'wall-material': 'timber', 'room-count': 'ai',
      'has-electrical': 'true', 'has-plumbing': 'true',
    },
  },
  {
    id: 'sample-duplex',
    name: 'Duplex Unit',
    difficulty: 'intermediate',
    description: 'Two-unit duplex floor plan with mirrored layouts and separate entrances.',
    tags: ['multi-unit', 'duplex', 'residential'],
    generateSvg: duplexSVG,
    width: 1400,
    height: 1000,
    scaleMmPerPx: 10.0,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true', 'units': 'metric', 'ceiling-height': '2.7',
      'door-symbol': 'true', 'window-symbol': 'true',
      'circle-symbols': 'lights', 'square-symbols': 'switches',
      'exterior-thick': 'true', 'interior-thin': 'true',
      'wall-material': 'timber', 'room-count': 'ai',
      'has-electrical': 'true', 'has-plumbing': 'true',
    },
  },
  {
    id: 'sample-townhouse',
    name: 'Townhouse',
    difficulty: 'intermediate',
    description: 'Two-story townhouse with living, kitchen, bedroom and bathroom on main level.',
    tags: ['residential', 'townhouse', 'multi-level'],
    generateSvg: townhouseSVG,
    width: 1200,
    height: 1000,
    scaleMmPerPx: 10.5,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true', 'units': 'metric', 'ceiling-height': '2.7',
      'door-symbol': 'true', 'window-symbol': 'true',
      'circle-symbols': 'lights', 'square-symbols': 'switches',
      'exterior-thick': 'true', 'interior-thin': 'true',
      'wall-material': 'timber', 'room-count': 'ai',
      'has-electrical': 'true', 'has-plumbing': 'true',
    },
  },
  {
    id: 'sample-medical',
    name: 'Medical Suite',
    difficulty: 'difficult',
    description: 'Medical office with reception, exam rooms, lab, and staff area.',
    tags: ['commercial', 'medical', 'office'],
    generateSvg: medicalSVG,
    width: 1600,
    height: 1100,
    scaleMmPerPx: 10.31,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true', 'units': 'metric', 'ceiling-height': '2.8',
      'door-symbol': 'true', 'window-symbol': 'true',
      'circle-symbols': 'lights',
      'exterior-thick': 'true', 'interior-thin': 'true',
      'wall-material': 'steel', 'room-count': 'ai',
      'has-electrical': 'true', 'has-plumbing': 'true',
    },
  },
  {
    id: 'sample-retail',
    name: 'Retail Space',
    difficulty: 'difficult',
    description: 'Retail store with sales floor, fitting rooms, stock room, and staff facilities.',
    tags: ['commercial', 'retail', 'store'],
    generateSvg: retailSVG,
    width: 1800,
    height: 1100,
    scaleMmPerPx: 10.0,
    scaleNotation: '1:100',
    wizardDefaults: {
      'has-scale': 'true', 'units': 'metric', 'ceiling-height': '3.0',
      'door-symbol': 'true', 'window-symbol': 'true',
      'circle-symbols': 'lights', 'square-symbols': 'switches',
      'exterior-thick': 'true', 'interior-thin': 'true',
      'wall-material': 'steel', 'room-count': 'ai',
      'has-electrical': 'true', 'has-plumbing': 'true',
    },
  },
]

/**
 * Render an SVG string to a PNG Blob via a detached canvas.
 */
export function renderSvgToPng(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) { reject(new Error('Canvas 2d context unavailable')); return }

    const img = new Image()
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('toBlob returned null'))
      }, 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')) }
    img.src = url
  })
}
