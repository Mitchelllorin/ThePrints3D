/**
 * FootprintEditor — pull the building to size.
 *
 * This is the front door of Draw it, and it used to be a form: type a width,
 * type a depth, and watch a little preview redraw underneath. The name promised
 * a gesture and the screen delivered four fields. Now the plan is the input.
 *
 *   - Grab any edge of the building and pull: that wall follows your finger and
 *     the wall across from it stays put. Every corner has a square grip that
 *     does both sizes at once.
 *   - Every section has its own two grips, on its OUTER edges, so a section on
 *     the left grows leftward and one on the front grows upward — the edge you
 *     are holding is the edge that moves.
 *   - Drag a section's body to slide it along the wall it hangs off. Tap it
 *     (without dragging) to show how far along that wall it starts.
 *   - Every size carries a dimension the way a print does: witness lines off
 *     the building and an arrow between them, stretching as you drag, reading
 *     live in the unit chosen in Settings. Tap the number to type it exact.
 *
 * THE FRAME FREEZES WHILE YOU DRAG. The plan normally scales itself to fit the
 * box it sits in, which is right when nothing is moving and wrong the moment
 * something is: pull the edge out, the building gets bigger, the plan shrinks
 * to fit it, and the edge you are holding runs away from your thumb. So the
 * scale is captured on touch-down and held until you let go, then the plan
 * refits once.
 *
 * All the arithmetic — which way is bigger, snapping, keeping a section on its
 * wall — lives in `services/footprintEdit.ts`, with tests. This file only maps
 * millimetres to pixels and pointers back again.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { placeBoxes, footprintOutline, type AttachSide, type FootprintBox, type Rect } from '../../services/footprint'
import {
  cornerShift, dragBoxes, typeBoxSize, typeOffset, dimensionLanes, runsDown,
  type Grip, type SizeField,
} from '../../services/footprintEdit'
import { parseSizeMm } from '../../services/drawnProject'
import styles from './FootprintEditor.module.css'

/** Distance between dimension lanes — far enough that two 48px targets never touch. */
const LANE_PX = 56
/**
 * First lane's distance off the building. A section's grip sits ON its outer
 * edge and that section's dimension sits in the first lane off that same edge,
 * at the same point along it. So this is the grip's 24px reach, plus the
 * number's 24px reach, plus the 8px that keeps two targets apart. It was 30,
 * and the two targets overlapped.
 */
const FIRST_LANE_PX = 56
/** Breathing room on a side that carries no dimension. */
const EDGE_PX = 22
/** A section's offset is dimensioned just inside the main box, along the shared wall. */
const INSIDE_PX = 24
/** Less movement than this between down and up is a tap, not a drag. */
const TAP_SLOP_PX = 6

interface Frame { s: number; ox: number; oy: number }
type DimField = SizeField | 'off'
interface Dim {
  key: string
  box: number
  field: DimField
  vertical: boolean
  line: [number, number, number, number]
  witness: Array<[number, number, number, number]>
  valueMm: number
}
interface GripAt { grip: Grip; x: number; y: number; corner: boolean; label: string }

/** Fit the building into the free space left once the dimension lanes are taken. */
function fitFrame(w: number, h: number, b: Rect, pad: Record<AttachSide, number>): Frame {
  const bw = Math.max(1, b.x2 - b.x1)
  const bh = Math.max(1, b.y2 - b.y1)
  const aw = Math.max(40, w - pad.left - pad.right)
  const ah = Math.max(40, h - pad.top - pad.bottom)
  const s = Math.min(aw / bw, ah / bh)
  return {
    s,
    ox: pad.left + (aw - bw * s) / 2 - b.x1 * s,
    oy: pad.top + (ah - bh * s) / 2 - b.y1 * s,
  }
}

/** The grid is squared paper: pick the finest step that is still wide enough to read. */
function gridStepMm(scale: number, metric: boolean): number {
  const ladder = metric ? [500, 1000, 2000, 5000, 10000] : [1, 2, 5, 10, 20].map((ft) => ft * 304.8)
  return ladder.find((mm) => mm * scale >= 14) ?? ladder[ladder.length - 1]
}

export default function FootprintEditor({
  boxes, onChange, format, snapMm, metric, height = 300,
}: {
  boxes: FootprintBox[]
  onChange: (next: FootprintBox[]) => void
  /** The Settings unit — the same formatter the inside-wall dimension uses. */
  format: (mm: number) => string
  snapMm: number
  metric: boolean
  /** First-frame guess only. The box it sits in sets the real height. */
  height?: number
}) {
  const ids = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  // A first guess at the plan's size so the very first frame is the real plan,
  // not an empty box waiting for the observer to report.
  const [size, setSize] = useState(() => ({
    w: Math.max(240, Math.min(420, typeof window === 'undefined' ? 360 : window.innerWidth) - 34),
    h: height,
  }))
  const [drag, setDrag] = useState<{ grip: Grip; frame: Frame; start: FootprintBox[] } | null>(null)
  const dragFrom = useRef<{ x: number; y: number; boxes: FootprintBox[]; id: number; moved: number } | null>(null)
  const [editing, setEditing] = useState<{ key: string; text: string; bad: boolean } | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const placed = placeBoxes(boxes)
  if (placed.length === 0) return null
  const bounds: Rect = {
    x1: Math.min(...placed.map((r) => r.x1)), y1: Math.min(...placed.map((r) => r.y1)),
    x2: Math.max(...placed.map((r) => r.x2)), y2: Math.max(...placed.map((r) => r.y2)),
  }

  // ── Dimension lanes: each outside edge stacks its dimensions outward ───────
  const { lanes, count: laneCount } = dimensionLanes(boxes)
  const padFor = (n: number) => (n > 0 ? FIRST_LANE_PX + (n - 1) * LANE_PX + 28 : EDGE_PX)
  const pad: Record<AttachSide, number> = {
    top: padFor(laneCount.top), bottom: padFor(laneCount.bottom),
    left: padFor(laneCount.left), right: padFor(laneCount.right),
  }
  const fitted = fitFrame(size.w, size.h, bounds, pad)
  // Pulling the left or top wall moves the corner the plan is measured from.
  // Shift the frozen frame back by the same amount, so the wall across the
  // building stays where it is on screen and only the one in your hand moves.
  const shift = drag ? cornerShift(drag.start, boxes, drag.grip) : { xMm: 0, yMm: 0 }
  const f = drag ? { ...drag.frame, ox: drag.frame.ox - shift.xMm * drag.frame.s, oy: drag.frame.oy - shift.yMm * drag.frame.s } : fitted
  const X = (mm: number) => f.ox + mm * f.s
  const Y = (mm: number) => f.oy + mm * f.s
  const B = { x1: X(bounds.x1), y1: Y(bounds.y1), x2: X(bounds.x2), y2: Y(bounds.y2) }
  const shown = picked !== null && picked > 0 && picked < boxes.length ? picked : null
  const slidingBox = drag?.grip.kind === 'slide' ? drag.grip.box : null

  // ── Dimensions ──────────────────────────────────────────────────────────
  const dims: Dim[] = []
  boxes.forEach((b, i) => {
    const r = placed[i]
    const L = lanes[i]
    {
      const off = FIRST_LANE_PX + L.w.lane * LANE_PX
      const y = L.w.side === 'top' ? B.y1 - off : B.y2 + off
      const edge = L.w.side === 'top' ? Y(r.y1) : Y(r.y2)
      dims.push({
        key: `${i}:w`, box: i, field: 'w', vertical: false, valueMm: b.widthMm,
        line: [X(r.x1), y, X(r.x2), y],
        witness: [[X(r.x1), edge, X(r.x1), y], [X(r.x2), edge, X(r.x2), y]],
      })
    }
    {
      const off = FIRST_LANE_PX + L.d.lane * LANE_PX
      const x = L.d.side === 'left' ? B.x1 - off : B.x2 + off
      const edge = L.d.side === 'left' ? X(r.x1) : X(r.x2)
      dims.push({
        key: `${i}:d`, box: i, field: 'd', vertical: true, valueMm: b.depthMm,
        line: [x, Y(r.y1), x, Y(r.y2)],
        witness: [[edge, Y(r.y1), x, Y(r.y1)], [edge, Y(r.y2), x, Y(r.y2)]],
      })
    }
    // Where a section starts along its wall — only for the one you tapped or
    // are sliding, because four of these at once would bury the plan.
    if (i > 0 && (shown === i || slidingBox === i)) {
      const side = b.attach?.side ?? 'right'
      const offMm = b.attach?.offsetMm ?? 0
      const m = placed[0]
      const lo = Math.min(0, offMm), hi = Math.max(0, offMm)
      if (runsDown(side)) {
        const x = side === 'right' ? X(m.x2) - INSIDE_PX : X(m.x1) + INSIDE_PX
        dims.push({ key: `${i}:off`, box: i, field: 'off', vertical: true, valueMm: offMm, line: [x, Y(lo), x, Y(hi)], witness: [] })
      } else {
        const y = side === 'bottom' ? Y(m.y2) - INSIDE_PX : Y(m.y1) + INSIDE_PX
        dims.push({ key: `${i}:off`, box: i, field: 'off', vertical: false, valueMm: offMm, line: [X(lo), y, X(hi), y], witness: [] })
      }
    }
  })

  const active = new Set<string>()
  if (drag) {
    const g = drag.grip
    if (g.kind === 'w' || g.kind === 'wd') active.add(`${g.box}:w`)
    if (g.kind === 'd' || g.kind === 'wd') active.add(`${g.box}:d`)
    if (g.kind === 'slide') active.add(`${g.box}:off`)
  }

  // ── Grips: on every edge and every corner of the building ────────────────
  const m = placed[0]
  // Where the main box's walls are open to a section, there is no wall there
  // to hold: find the stretch of each wall still on the outside, and put that
  // wall's grip in the middle of the longest one.
  const openRuns = (side: AttachSide): Array<[number, number]> => {
    const along = runsDown(side) ? [m.y1, m.y2] : [m.x1, m.x2]
    const cuts = boxes.slice(1).map((b, k) => ({ b, r: placed[k + 1] }))
      .filter(({ b }) => (b.attach?.side ?? 'right') === side)
      .map(({ r }) => (runsDown(side) ? [r.y1, r.y2] : [r.x1, r.x2]) as [number, number])
      .sort((a, b) => a[0] - b[0])
    const runs: Array<[number, number]> = []
    let at = along[0]
    for (const [a, b] of cuts) {
      if (a > at) runs.push([at, Math.min(a, along[1])])
      at = Math.max(at, b)
    }
    if (at < along[1]) runs.push([at, along[1]])
    return runs
  }
  const midOfLongest = (side: AttachSide): number | null => {
    const runs = openRuns(side)
    if (!runs.length) return null
    const [a, b] = runs.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best))
    return (a + b) / 2
  }
  /** A corner is only a corner if no section runs past it. */
  const cornerOpen = (x: number, y: number) => boxes.slice(1).every((_, k) => {
    const r = placed[k + 1]
    return !(x > r.x1 + 1e-6 && x < r.x2 - 1e-6 && y >= r.y1 - 1e-6 && y <= r.y2 + 1e-6)
      && !(y > r.y1 + 1e-6 && y < r.y2 - 1e-6 && x >= r.x1 - 1e-6 && x <= r.x2 + 1e-6)
  })

  const candidates: GripAt[] = []
  // ONE grip per section, on its outer corner. Two edge grips each was the
  // first version, and on a 12′ section at phone scale they sat about 28px
  // apart — two 48px targets overlapping. The corner does both, in the same
  // square shape as the main box's corners; drag straight out for one size and
  // the snap holds the other. Typing either on its dimension is the exact way.
  // Sections go first: a section's only grip beats a main-box spare.
  boxes.forEach((b, i) => {
    if (i === 0) return
    const r = placed[i]
    const side = b.attach?.side ?? 'right'
    candidates.push({
      grip: { box: i, kind: 'wd' }, corner: true, label: `Drag to size section ${i + 1}`,
      x: X(side === 'left' ? r.x1 : r.x2), y: Y(side === 'top' ? r.y1 : r.y2),
    })
  })
  // The four corners, then the four walls.
  for (const [left, top] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const cx = left ? m.x1 : m.x2, cy = top ? m.y1 : m.y2
    if (!cornerOpen(cx, cy)) continue
    candidates.push({
      grip: { box: 0, kind: 'wd', fromLeft: left, fromTop: top }, corner: true,
      x: X(cx), y: Y(cy), label: `Drag the ${top ? 'front' : 'back'} ${left ? 'left' : 'right'} corner`,
    })
  }
  for (const side of ['right', 'bottom', 'left', 'top'] as const) {
    const mid = midOfLongest(side)
    if (mid == null) continue
    const w = runsDown(side)
    candidates.push({
      grip: { box: 0, kind: w ? 'w' : 'd', fromLeft: side === 'left', fromTop: side === 'top' }, corner: false,
      x: w ? X(side === 'left' ? m.x1 : m.x2) : X(mid),
      y: w ? Y(mid) : Y(side === 'top' ? m.y1 : m.y2),
      label: `Drag the ${side === 'top' ? 'front' : side === 'bottom' ? 'back' : side} wall`,
    })
  }
  // No two grips closer than a target and its spacing. On a narrow house the
  // wall grip would sit on a corner grip; the corner already does that job.
  const grips: GripAt[] = []
  for (const g of candidates) if (grips.every((k) => Math.hypot(k.x - g.x, k.y - g.y) >= 56)) grips.push(g)
  const gripKey = (g: Grip) => `${g.box}:${g.kind}:${g.fromLeft ? 'L' : ''}${g.fromTop ? 'T' : ''}`

  // ── Pointer: millimetres moved = pixels moved / the frozen scale ─────────
  const begin = (e: ReactPointerEvent<Element>, grip: Grip) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragFrom.current = { x: e.clientX, y: e.clientY, boxes: boxes.slice(), id: e.pointerId, moved: 0 }
    setDrag({ grip, frame: fitted, start: boxes.slice() })
    setEditing(null)
  }
  const move = (e: ReactPointerEvent<Element>) => {
    const from = dragFrom.current
    if (!drag || !from || e.pointerId !== from.id) return
    const px = e.clientX - from.x
    const py = e.clientY - from.y
    from.moved = Math.max(from.moved, Math.hypot(px, py))
    onChange(dragBoxes(from.boxes, drag.grip, px / drag.frame.s, py / drag.frame.s, snapMm))
  }
  const end = (e: ReactPointerEvent<Element>) => {
    const from = dragFrom.current
    if (!from || e.pointerId !== from.id) return
    const tapped = from.moved < TAP_SLOP_PX
    const g = drag?.grip
    dragFrom.current = null
    setDrag(null)
    if (tapped && g?.kind === 'slide') setPicked(shown === g.box ? null : g.box)
  }
  const nudge = (e: KeyboardEvent, grip: Grip) => {
    const step = snapMm > 0 ? snapMm : 100
    let dx = 0, dy = 0
    if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowDown') dy = step
    else if (e.key === 'ArrowUp') dy = -step
    else return
    e.preventDefault()
    onChange(dragBoxes(boxes, grip, dx, dy, snapMm))
  }

  // ── Typing it exact, on the dimension ───────────────────────────────────
  const labelFor = (d: Dim) => (d.valueMm < 0 ? `−${format(-d.valueMm)}` : format(d.valueMm))
  const tryCommit = (): boolean => {
    if (!editing) return true
    const d = dims.find((x) => x.key === editing.key)
    if (!d) return true
    const raw = editing.text.trim()
    const negative = d.field === 'off' && /^[-−]/.test(raw)
    const mm = parseSizeMm(raw.replace(/^[-−]\s*/, ''))
    if (mm === null || !(mm >= 0)) return false
    if (d.field === 'off') onChange(typeOffset(boxes, d.box, negative ? -mm : mm))
    else onChange(typeBoxSize(boxes, d.box, d.field, mm))
    return true
  }

  const step = gridStepMm(f.s, metric)
  const outline = footprintOutline(placed)
  const outlinePath = outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ') + ' Z'

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <svg className={styles.svg} width={size.w} height={size.h} aria-hidden>
        <defs>
          <pattern id={`${ids}g`} width={step * f.s} height={step * f.s} x={f.ox} y={f.oy} patternUnits="userSpaceOnUse">
            <path d={`M ${step * f.s} 0 L 0 0 0 ${step * f.s}`} fill="none" stroke="#2b3b5c" strokeWidth={1} />
          </pattern>
          {(['n', 'a'] as const).map((k) => (
            <marker key={k} id={`${ids}${k}`} markerWidth={10} markerHeight={10} refX={9} refY={5}
              orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M0,1.5 L9,5 L0,8.5 Z" fill={k === 'a' ? '#3d9ae8' : '#aebccd'} />
            </marker>
          ))}
        </defs>

        {/* Squared paper. Tapping bare paper puts away the offset you had on show. */}
        <rect width={size.w} height={size.h} fill={`url(#${ids}g)`} onPointerDown={() => setPicked(null)} />

        {placed.map((r, i) => (
          <rect key={i}
            x={X(r.x1)} y={Y(r.y1)} width={(r.x2 - r.x1) * f.s} height={(r.y2 - r.y1) * f.s}
            fill={i === 0 ? 'rgba(61,154,232,0.20)' : shown === i ? 'rgba(249,115,22,0.36)' : 'rgba(249,115,22,0.22)'} />
        ))}
        <path d={outlinePath} fill="none" stroke="#e8eef5" strokeWidth={2.5} strokeLinejoin="miter" />

        {/* A section's body is its slide handle — drag it along the wall, or tap it. */}
        {placed.map((r, i) => i === 0 ? null : (
          <rect key={`h${i}`} className={styles.body}
            x={X(r.x1)} y={Y(r.y1)} width={(r.x2 - r.x1) * f.s} height={(r.y2 - r.y1) * f.s}
            fill="transparent"
            onPointerDown={(e) => begin(e, { box: i, kind: 'slide' })}
            onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        ))}

        {dims.map((d) => {
          const on = active.has(d.key) || editing?.key === d.key
          const stroke = on ? '#3d9ae8' : '#aebccd'
          const [x1, y1, x2, y2] = d.line
          const hasLength = Math.hypot(x2 - x1, y2 - y1) > 12
          return (
            <g key={d.key}>
              {d.witness.map(([a, b, c, e], k) => (
                <line key={k} x1={a} y1={b} x2={c} y2={e} stroke={stroke} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
              ))}
              {hasLength && (
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={on ? 2 : 1.5}
                  markerStart={`url(#${ids}${on ? 'a' : 'n'})`} markerEnd={`url(#${ids}${on ? 'a' : 'n'})`} />
              )}
            </g>
          )
        })}
      </svg>

      {grips.map((g) => {
        const on = drag !== null && gripKey(drag.grip) === gripKey(g.grip)
        return (
          <button key={gripKey(g.grip)} type="button"
            className={[styles.grip, g.corner ? styles.gripCorner : '', on ? styles.gripOn : ''].filter(Boolean).join(' ')}
            style={{ left: g.x, top: g.y }}
            aria-label={g.label}
            onPointerDown={(e) => begin(e, g.grip)}
            onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onKeyDown={(e) => nudge(e, g.grip)} />
        )
      })}

      {dims.map((d) => {
        const cx = (d.line[0] + d.line[2]) / 2
        const cy = (d.line[1] + d.line[3]) / 2
        if (editing?.key === d.key) {
          return (
            <input key={d.key} className={`${styles.edit} ${editing.bad ? styles.editBad : ''}`}
              style={{ left: cx, top: cy }}
              value={editing.text}
              autoFocus
              inputMode="text"
              autoComplete="off"
              aria-label={d.field === 'w' ? 'Width' : d.field === 'd' ? 'Depth' : 'Distance from the corner'}
              aria-invalid={editing.bad}
              title={editing.bad ? "Type a size like 40, 40' 6\", or 12.2 m" : undefined}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setEditing({ ...editing, text: e.target.value, bad: false })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (tryCommit()) setEditing(null)
                  else setEditing({ ...editing, bad: true })
                } else if (e.key === 'Escape') setEditing(null)
              }}
              onBlur={() => { tryCommit(); setEditing(null) }} />
          )
        }
        const on = active.has(d.key)
        const what = d.field === 'w' ? 'Width' : d.field === 'd' ? 'Depth' : 'From the corner'
        return (
          <button key={d.key} type="button"
            className={[styles.chip, d.vertical ? styles.chipV : '', on ? styles.chipOn : ''].filter(Boolean).join(' ')}
            style={{ left: cx, top: cy }}
            aria-label={`${what} ${labelFor(d)}. Tap to type it.`}
            onClick={() => setEditing({ key: d.key, text: labelFor(d), bad: false })}>
            {labelFor(d)}
          </button>
        )
      })}
    </div>
  )
}
