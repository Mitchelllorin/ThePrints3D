/**
 * FootprintEditor — the Draw it sheet: pull the building to size, put it where
 * you want it, and draw the walls inside it. One sheet, in the order a house
 * goes up.
 *
 * OUTLINE
 *   - Grab any edge of the building and pull: that wall follows your finger and
 *     the wall across from it stays put. Every corner has a square grip that
 *     does both sizes at once.
 *   - Every section has a grip on its outer corner; drag a section's body to
 *     slide it along its wall, or tap it to show how far along it starts.
 *   - Double-tap the house to pick it up, then drag it anywhere on the paper.
 *     Its inside walls go with it. Tap the paper to put it down.
 *
 * INSIDE WALLS
 *   - Drag across the house to draw a wall. Nearly square is square; an end
 *     lands on another wall's end, on the inside face of the shell, or on the
 *     grid. The length reads live on the wall as you draw it.
 *   - Tap a wall to pick it: drag it to move it, drag an end to stretch it,
 *     tap its number to type the length exact.
 *
 * Every size carries a dimension the way a print does, reading live in the
 * unit chosen in Settings; tap a number to type it exact.
 *
 * THE PAGE HOLDS STILL. The plan fits the PAPER to the box it sits in, not the
 * house, so the house can move on it and the edge you are holding never runs
 * away from your thumb. The paper grows when you let go, if the house has
 * outgrown it — never during a drag.
 *
 * All the arithmetic — which way is bigger, snapping, keeping a section on its
 * wall, where a wall lands — lives in `services/footprintEdit.ts` and
 * `services/drawItPlan.ts`, with tests. This file only maps millimetres to
 * pixels and pointers back again.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { footprintOutline, type AttachSide, type Point, type Rect } from '../../services/footprint'
import {
  dragBoxes, typeBoxSize, typeOffset, dimensionLanes, runsDown,
  type Grip, type SizeField,
} from '../../services/footprintEdit'
import {
  acceptsWall, clipToShell, fitPage, houseRects, movedHouse, resized, snapWallPoint, withLength, wallLength,
  type DrawItPlan, type InsideWall,
} from '../../services/drawItPlan'
import { parseSizeMm } from '../../services/drawnProject'
import styles from './FootprintEditor.module.css'

export type DrawMode = 'outline' | 'walls'

/** Distance between dimension lanes — far enough that two 48px targets never touch. */
const LANE_PX = 56
/**
 * First lane's distance off the building. A section's grip sits ON its outer
 * edge and that section's dimension sits in the first lane off that same edge,
 * at the same point along it. So this is the grip's 24px reach, plus the
 * number's 24px reach, plus the 8px that keeps two targets apart.
 */
const FIRST_LANE_PX = 56
/** Paper kept clear round the page edge on screen. */
const EDGE_PX = 8
/** A section's offset is dimensioned just inside the main box, along the shared wall. */
const INSIDE_PX = 24
/** Less movement than this between down and up is a tap, not a drag. */
const TAP_SLOP_PX = 6
/** A second press this soon after the first lift is a double tap — timed from
 *  the LIFT, the way a phone counts one, not from the first press. */
const DOUBLE_TAP_MS = 400
/** How close a finger has to land to a wall, or a wall end to a line, on screen. */
const REACH_PX = 16
/** How far a wall's number sits off the wall: clear of the 48px move handle
 *  on the wall's middle, with the 8px between two targets. */
const WALL_LABEL_PX = 48

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

type Drag =
  | { kind: 'grip'; grip: Grip; start: DrawItPlan }
  | { kind: 'slide'; box: number; start: DrawItPlan }
  | { kind: 'move'; start: DrawItPlan }
  /** `tapped` is the wall a press started on: a tap there, rather than a
   *  drag, selects that wall instead of drawing. */
  | { kind: 'draw'; from: Point; to: Point; tapped?: number }
  | { kind: 'wall'; index: number; part: 'body' | 'a' | 'b'; start: DrawItPlan }

/** Fit the paper into the box it sits in. */
function fitFrame(w: number, h: number, pageW: number, pageD: number): Frame {
  const aw = Math.max(40, w - EDGE_PX * 2)
  const ah = Math.max(40, h - EDGE_PX * 2)
  const s = Math.min(aw / Math.max(1, pageW), ah / Math.max(1, pageD))
  return { s, ox: EDGE_PX + (aw - pageW * s) / 2, oy: EDGE_PX + (ah - pageD * s) / 2 }
}

/** The grid is squared paper: pick the finest step that is still wide enough to read. */
function gridStepMm(scale: number, metric: boolean): number {
  const ladder = metric ? [500, 1000, 2000, 5000, 10000] : [1, 2, 5, 10, 20].map((ft) => ft * 304.8)
  return ladder.find((mm) => mm * scale >= 14) ?? ladder[ladder.length - 1]
}

export default function FootprintEditor({
  plan, onChange, mode, selectedWall, onSelectWall, onPickedUp, format, snapMm, metric, shellMm, height = 300,
}: {
  plan: DrawItPlan
  onChange: (next: DrawItPlan) => void
  mode: DrawMode
  selectedWall: number | null
  onSelectWall: (i: number | null) => void
  /** Told when the house is picked up or put down, so the sheet can say so. */
  onPickedUp?: (up: boolean) => void
  /** The Settings unit — the same formatter the inside-wall dimension uses. */
  format: (mm: number) => string
  snapMm: number
  metric: boolean
  /** The shell's thickness: an inside wall stops at its inside face. */
  shellMm: number
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
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragFrom = useRef<{ x: number; y: number; id: number; moved: number } | null>(null)
  const lastTap = useRef({ t: 0, x: 0, y: 0 })
  const [editing, setEditing] = useState<{ key: string; text: string; bad: boolean } | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [pickedUp, setPickedUpState] = useState(false)
  const setPickedUp = (up: boolean) => { setPickedUpState(up); onPickedUp?.(up) }

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

  const boxes = plan.boxes
  const placed = houseRects(plan)
  if (placed.length === 0) return null
  const bounds: Rect = {
    x1: Math.min(...placed.map((r) => r.x1)), y1: Math.min(...placed.map((r) => r.y1)),
    x2: Math.max(...placed.map((r) => r.x2)), y2: Math.max(...placed.map((r) => r.y2)),
  }

  const f = fitFrame(size.w, size.h, plan.page.w, plan.page.d)
  const X = (mm: number) => f.ox + mm * f.s
  const Y = (mm: number) => f.oy + mm * f.s
  const toMm = (e: { clientX: number; clientY: number }): Point => {
    const r = wrapRef.current?.getBoundingClientRect()
    return { x: (e.clientX - (r?.left ?? 0) - f.ox) / f.s, y: (e.clientY - (r?.top ?? 0) - f.oy) / f.s }
  }
  const B = { x1: X(bounds.x1), y1: Y(bounds.y1), x2: X(bounds.x2), y2: Y(bounds.y2) }
  const shown = picked !== null && picked > 0 && picked < boxes.length ? picked : null
  const slidingBox = drag?.kind === 'slide' ? drag.box : null
  const outlineMode = mode === 'outline'

  // ── Dimensions ──────────────────────────────────────────────────────────
  const { lanes } = dimensionLanes(boxes)
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
        dims.push({ key: `${i}:off`, box: i, field: 'off', vertical: true, valueMm: offMm, line: [x, Y(m.y1 + lo), x, Y(m.y1 + hi)], witness: [] })
      } else {
        const y = side === 'bottom' ? Y(m.y2) - INSIDE_PX : Y(m.y1) + INSIDE_PX
        dims.push({ key: `${i}:off`, box: i, field: 'off', vertical: false, valueMm: offMm, line: [X(m.x1 + lo), y, X(m.x1 + hi), y], witness: [] })
      }
    }
  })

  const active = new Set<string>()
  if (drag?.kind === 'grip') {
    const g = drag.grip
    if (g.kind === 'w' || g.kind === 'wd') active.add(`${g.box}:w`)
    if (g.kind === 'd' || g.kind === 'wd') active.add(`${g.box}:d`)
  }
  if (drag?.kind === 'slide') active.add(`${drag.box}:off`)

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
  // ONE grip per section, on its outer corner — two edge grips each sat about
  // 28px apart on a 12′ section at phone scale. The corner does both; typing
  // either on its dimension is the exact way. Sections go first: a section's
  // only grip beats a main-box spare.
  boxes.forEach((b, i) => {
    if (i === 0) return
    const r = placed[i]
    const side = b.attach?.side ?? 'right'
    candidates.push({
      grip: { box: i, kind: 'wd' }, corner: true, label: `Drag to size section ${i + 1}`,
      x: X(side === 'left' ? r.x1 : r.x2), y: Y(side === 'top' ? r.y1 : r.y2),
    })
  })
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
  if (outlineMode && !pickedUp) {
    for (const g of candidates) if (grips.every((k) => Math.hypot(k.x - g.x, k.y - g.y) >= 56)) grips.push(g)
  }
  const gripKey = (g: Grip) => `${g.box}:${g.kind}:${g.fromLeft ? 'L' : ''}${g.fromTop ? 'T' : ''}`

  // ── Pointer ───────────────────────────────────────────────────────────────
  const snapOpts = { gridMm: snapMm, tolMm: REACH_PX / f.s, shellMm }
  const begin = (e: ReactPointerEvent<Element>, d: Drag) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragFrom.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 }
    setDrag(d)
    setEditing(null)
  }
  const move = (e: ReactPointerEvent<Element>) => {
    const from = dragFrom.current
    if (!drag || !from || e.pointerId !== from.id) return
    const px = e.clientX - from.x
    const py = e.clientY - from.y
    from.moved = Math.max(from.moved, Math.hypot(px, py))
    const dx = px / f.s, dy = py / f.s
    if (drag.kind === 'grip') {
      onChange(resized(drag.start, dragBoxes(drag.start.boxes, drag.grip, dx, dy, snapMm), drag.grip))
    } else if (drag.kind === 'slide') {
      const g: Grip = { box: drag.box, kind: 'slide' }
      onChange({ ...drag.start, boxes: dragBoxes(drag.start.boxes, g, dx, dy, snapMm) })
    } else if (drag.kind === 'move') {
      onChange(movedHouse(drag.start, dx, dy, snapMm))
    } else if (drag.kind === 'draw') {
      setDrag({ ...drag, to: clipToShell(plan, drag.from, snapWallPoint(plan, toMm(e), { ...snapOpts, from: drag.from }), shellMm) })
    } else if (drag.kind === 'wall' && from.moved >= TAP_SLOP_PX) {
      const w0 = drag.start.walls[drag.index]
      let w: InsideWall
      if (drag.part === 'body') {
        const sx = Math.round(dx / snapMm) * snapMm, sy = Math.round(dy / snapMm) * snapMm
        w = { x1: w0.x1 + sx, y1: w0.y1 + sy, x2: w0.x2 + sx, y2: w0.y2 + sy }
      } else {
        const fixed = drag.part === 'a' ? { x: w0.x2, y: w0.y2 } : { x: w0.x1, y: w0.y1 }
        const q = snapWallPoint(drag.start, toMm(e), { ...snapOpts, from: fixed, skip: drag.index })
        w = drag.part === 'a' ? { ...w0, x1: q.x, y1: q.y } : { ...w0, x2: q.x, y2: q.y }
      }
      onChange({ ...drag.start, walls: drag.start.walls.map((k, i) => (i === drag.index ? w : k)) })
    }
  }
  const end = (e: ReactPointerEvent<Element>) => {
    const from = dragFrom.current
    if (!from || e.pointerId !== from.id) return
    const tapped = from.moved < TAP_SLOP_PX
    const d = drag
    dragFrom.current = null
    setDrag(null)
    if (!d) return
    if (d.kind === 'slide' && tapped) setPicked(shown === d.box ? null : d.box)
    if (d.kind === 'draw') {
      const w = { x1: d.from.x, y1: d.from.y, x2: d.to.x, y2: d.to.y }
      if (tapped && d.tapped != null) { onSelectWall(d.tapped); return }
      if (!tapped && acceptsWall(plan, w)) {
        onChange({ ...plan, walls: [...plan.walls, w] })
        onSelectWall(plan.walls.length)
      } else {
        onSelectWall(null)
      }
      return
    }
    if (d.kind === 'wall') {
      // A wall dragged off the house, or shrunk to nothing, goes back.
      const w = plan.walls[d.index]
      if (w && !acceptsWall(plan, w)) onChange(d.start)
      return
    }
    // Grow the paper once, now the finger is off it.
    if (!tapped) onChange(fitPage(plan))
  }

  /** The house (main box or any section) was pressed. */
  const pressHouse = (e: ReactPointerEvent<Element>, box: number) => {
    const t = lastTap.current
    const again = e.timeStamp - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30
    lastTap.current = { t: -Infinity, x: 0, y: 0 }
    if (pickedUp || again) {
      // DOUBLE-TAP PICKS IT UP. The second tap can drag straight away; if it
      // lifts instead, the house stays picked up until the paper is tapped.
      setPickedUp(true)
      setPicked(null)
      begin(e, { kind: 'move', start: plan })
      return
    }
    if (box > 0) begin(e, { kind: 'slide', box, start: plan })
  }

  const pressPaper = (e: ReactPointerEvent<Element>) => {
    if (mode === 'walls') {
      const p = snapWallPoint(plan, toMm(e), snapOpts)
      onSelectWall(null)
      begin(e, { kind: 'draw', from: p, to: p })
      return
    }
    setPicked(null)
    if (pickedUp) setPickedUp(false)
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
    onChange(fitPage(resized(plan, dragBoxes(boxes, grip, dx, dy, snapMm), grip)))
  }

  // ── Typing it exact, on the dimension ───────────────────────────────────
  const labelFor = (valueMm: number) => (valueMm < 0 ? `−${format(-valueMm)}` : format(valueMm))
  const tryCommit = (): boolean => {
    if (!editing) return true
    const raw = editing.text.trim()
    if (editing.key.startsWith('wall:')) {
      const i = Number(editing.key.slice(5))
      const mm = parseSizeMm(raw)
      if (mm === null || !(mm > 0)) return false
      const w = withLength(plan.walls[i], mm)
      if (!acceptsWall(plan, w)) return false
      onChange(fitPage({ ...plan, walls: plan.walls.map((k, j) => (j === i ? w : k)) }))
      return true
    }
    const d = dims.find((x) => x.key === editing.key)
    if (!d) return true
    const negative = d.field === 'off' && /^[-−]/.test(raw)
    const mm = parseSizeMm(raw.replace(/^[-−]\s*/, ''))
    if (mm === null || !(mm >= 0)) return false
    // Typed from the dimension, the main box keeps its top-left corner.
    if (d.field === 'off') onChange(fitPage({ ...plan, boxes: typeOffset(boxes, d.box, negative ? -mm : mm) }))
    else onChange(fitPage({ ...plan, boxes: typeBoxSize(boxes, d.box, d.field, mm) }))
    return true
  }

  const step = gridStepMm(f.s, metric)
  const outline = footprintOutline(placed)
  const outlinePath = outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ') + ' Z'
  // An inside wall drawn at its real thickness — a 2x4 with board both sides,
  // about 4-1/2" — and never thinner than a line you can see.
  const wallPx = Math.max(3, 114 * f.s)

  // Walls on screen: the committed ones, plus the one being drawn.
  const drawing = drag?.kind === 'draw' ? { x1: drag.from.x, y1: drag.from.y, x2: drag.to.x, y2: drag.to.y } : null
  const wallChips: Array<{ key: string; x: number; y: number; w: InsideWall; live: boolean }> = []
  const chipFor = (w: InsideWall, key: string, live: boolean) => {
    const len = wallLength(w)
    if (len < 1) return
    const nx = -(w.y2 - w.y1) / len, ny = (w.x2 - w.x1) / len
    wallChips.push({
      key, live, w,
      x: X((w.x1 + w.x2) / 2) + nx * WALL_LABEL_PX,
      y: Y((w.y1 + w.y2) / 2) + ny * WALL_LABEL_PX,
    })
  }
  const sel = !outlineMode && selectedWall != null && !drawing ? selectedWall : null
  const selW = sel != null ? plan.walls[sel] : undefined
  const wallEnds = sel != null && selW ? (['a', 'b', 'body'] as const).map((part) => ({
    part,
    x: X(part === 'a' ? selW.x1 : part === 'b' ? selW.x2 : (selW.x1 + selW.x2) / 2),
    y: Y(part === 'a' ? selW.y1 : part === 'b' ? selW.y2 : (selW.y1 + selW.y2) / 2),
    on: drag?.kind === 'wall' && drag.part === part,
    index: sel,
  })) : []

  if (drawing) chipFor(drawing, 'drawing', true)
  else if (selectedWall != null && plan.walls[selectedWall]) chipFor(plan.walls[selectedWall], `wall:${selectedWall}`, false)

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${mode === 'walls' ? styles.wrapWalls : ''}`}>
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

        {/* The paper. In walls mode a drag on it draws; in outline mode a tap on
            it puts down whatever was picked up. */}
        <rect width={size.w} height={size.h} fill={`url(#${ids}g)`}
          className={styles.paper}
          onPointerDown={pressPaper} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        <rect x={X(0)} y={Y(0)} width={plan.page.w * f.s} height={plan.page.d * f.s}
          fill="none" stroke="#3a4a63" strokeWidth={1} strokeDasharray="6 4" pointerEvents="none" />

        {placed.map((r, i) => (
          <rect key={i}
            x={X(r.x1)} y={Y(r.y1)} width={(r.x2 - r.x1) * f.s} height={(r.y2 - r.y1) * f.s}
            fill={pickedUp ? 'rgba(61,154,232,0.32)'
              : i === 0 ? 'rgba(61,154,232,0.20)' : shown === i ? 'rgba(249,115,22,0.36)' : 'rgba(249,115,22,0.22)'}
            pointerEvents="none" />
        ))}
        {/* Picked up: a heavier, dashed outline as well as the fill — the state
            reads by shape, not by colour alone. */}
        <path d={outlinePath} fill="none" stroke={pickedUp ? '#3d9ae8' : '#e8eef5'}
          strokeWidth={pickedUp ? 3.5 : 2.5} strokeDasharray={pickedUp ? '10 5' : undefined}
          strokeLinejoin="miter" pointerEvents="none" />

        {/* The house's body: double-tap to pick it up; a section's body slides it. */}
        {outlineMode && placed.map((r, i) => (
          <rect key={`h${i}`} className={styles.body}
            x={X(r.x1)} y={Y(r.y1)} width={(r.x2 - r.x1) * f.s} height={(r.y2 - r.y1) * f.s}
            fill="transparent"
            onPointerDown={(e) => pressHouse(e, i)}
            onPointerMove={move}
            onPointerUp={(e) => {
              // Only a tap counts toward a double tap, not the end of a slide.
              if ((dragFrom.current?.moved ?? 0) < TAP_SLOP_PX) lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
              end(e)
            }}
            onPointerCancel={end} />
        ))}
        {/* In walls mode the house is paper to draw on. */}
        {!outlineMode && (
          <rect x={X(bounds.x1)} y={Y(bounds.y1)} width={(bounds.x2 - bounds.x1) * f.s} height={(bounds.y2 - bounds.y1) * f.s}
            fill="transparent" className={styles.paper}
            onPointerDown={pressPaper} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        )}

        {/* Inside walls. The wide invisible line is what a finger hits. */}
        {plan.walls.map((w, i) => {
          const sel = selectedWall === i
          return (
            <g key={`w${i}`}>
              <line x1={X(w.x1)} y1={Y(w.y1)} x2={X(w.x2)} y2={Y(w.y2)}
                stroke={sel ? '#3d9ae8' : '#cbd5e1'} strokeWidth={sel ? wallPx + 2 : wallPx}
                strokeLinecap="butt" opacity={outlineMode ? 0.55 : 1} pointerEvents="none" />
              {!outlineMode && (
                <line x1={X(w.x1)} y1={Y(w.y1)} x2={X(w.x2)} y2={Y(w.y2)}
                  stroke="transparent" strokeWidth={REACH_PX * 2} className={styles.wallHit}
                  onPointerDown={(e) => {
                    // A wall is somewhere to START one: a drag tees a new wall
                    // off it, and a tap picks it. Moving a picked wall is its
                    // own handle, on its middle — drawing off the wall you just
                    // drew is far more common than moving it.
                    const q = snapWallPoint(plan, toMm(e), snapOpts)
                    onSelectWall(null)
                    begin(e, { kind: 'draw', from: q, to: q, tapped: i })
                  }}
                  onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              )}
            </g>
          )
        })}
        {drawing && (
          <line x1={X(drawing.x1)} y1={Y(drawing.y1)} x2={X(drawing.x2)} y2={Y(drawing.y2)}
            stroke="#3d9ae8" strokeWidth={wallPx} strokeDasharray="8 4" pointerEvents="none" />
        )}

        {dims.map((d) => {
          const on = active.has(d.key) || editing?.key === d.key
          const stroke = on ? '#3d9ae8' : '#aebccd'
          const [x1, y1, x2, y2] = d.line
          const hasLength = Math.hypot(x2 - x1, y2 - y1) > 12
          return (
            <g key={d.key} pointerEvents="none">
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
        const on = drag?.kind === 'grip' && gripKey(drag.grip) === gripKey(g.grip)
        return (
          <button key={gripKey(g.grip)} type="button"
            className={[styles.grip, g.corner ? styles.gripCorner : '', on ? styles.gripOn : ''].filter(Boolean).join(' ')}
            style={{ left: g.x, top: g.y }}
            aria-label={g.label}
            onPointerDown={(e) => begin(e, { kind: 'grip', grip: g.grip, start: plan })}
            onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onKeyDown={(e) => nudge(e, g.grip)} />
        )
      })}

      {/* The picked wall's two ends: drag one to stretch or swing the wall. */}
      {wallEnds.map((g) => (
        <button key={g.part} type="button"
          className={[styles.grip, g.part === 'body' ? styles.gripMove : '', g.on ? styles.gripOn : ''].filter(Boolean).join(' ')}
          style={{ left: g.x, top: g.y }}
          aria-label={g.part === 'body' ? 'Drag to move the wall' : g.part === 'a' ? 'Drag this end of the wall' : 'Drag the other end of the wall'}
          onPointerDown={(e) => begin(e, { kind: 'wall', index: g.index, part: g.part, start: plan })}
          onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      ))}

      {[...dims.map((d) => ({
        key: d.key, x: (d.line[0] + d.line[2]) / 2, y: (d.line[1] + d.line[3]) / 2,
        valueMm: d.valueMm, vertical: d.vertical, live: false, on: active.has(d.key),
        what: d.field === 'w' ? 'Width' : d.field === 'd' ? 'Depth' : 'From the corner',
      })), ...wallChips.map((c) => ({
        key: c.key, x: c.x, y: c.y, valueMm: wallLength(c.w), vertical: false, live: c.live, on: true, what: 'Wall',
      }))].map((c) => {
        if (editing?.key === c.key) {
          return (
            <input key={c.key} className={`${styles.edit} ${editing.bad ? styles.editBad : ''}`}
              style={{ left: c.x, top: c.y }}
              value={editing.text}
              autoFocus
              inputMode="text"
              autoComplete="off"
              aria-label={c.what}
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
        return (
          <button key={c.key} type="button"
            className={[styles.chip, c.vertical ? styles.chipV : '', c.on ? styles.chipOn : '', c.live ? styles.chipLive : ''].filter(Boolean).join(' ')}
            style={{ left: c.x, top: c.y }}
            disabled={c.live}
            aria-label={`${c.what} ${labelFor(c.valueMm)}. Tap to type it.`}
            onClick={() => setEditing({ key: c.key, text: labelFor(c.valueMm), bad: false })}>
            {labelFor(c.valueMm)}
          </button>
        )
      })}
    </div>
  )
}
