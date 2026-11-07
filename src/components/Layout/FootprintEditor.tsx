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
 * OUTLINE AT ANY ANGLE (`plan.shape`)
 *   - Every corner is a handle: drag it anywhere. A wall off it that is nearly
 *     square stays square, so pulling one corner out cuts a clean diagonal.
 *   - A + sits in the middle of every wall: pull it out to put a corner there
 *     (a bay, a point), or tap it and drag the corner it leaves.
 *   - Tap a corner to pick it; its ✕ takes it out. Tap a wall's number to type
 *     that wall's length. A drag that would cross the walls is put back.
 *
 * INSIDE WALLS
 *   - Drag across the house to draw a wall. Nearly square is square; an end
 *     lands on another wall's end, on the inside face of the shell, or on the
 *     grid. A stretchy arrow reads the length live on the wall as you draw it.
 *   - Any angle (`free`): the wall keeps the angle you drag it at, to the whole
 *     degree, and the arrow reads the angle too.
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
import { type AttachSide, type Point, type Rect } from '../../services/footprint'
import {
  dragBoxes, typeBoxSize, typeOffset, dimensionLanes, runsDown,
  type Grip, type SizeField,
} from '../../services/footprintEdit'
import {
  acceptsWall, addCorner, clipToShell, fitPage, houseOutline, houseRects, MIN_WALL_MM, movedCorner, movedHouse, removeCorner, resized,
  shapeOk, snapWallPoint, withEdgeLength, withLength, wallLength,
  addCircle, circleString, planCircles, removeCircle, withCircleDiameter,
  type DrawItPlan, type InsideWall,
} from '../../services/drawItPlan'
import { parseSizeMm } from '../../services/drawnProject'
import { wallAngleOffSquareDeg } from '../../services/wallTraceReducer'
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
/** Smaller than this and it is a tap, not a circle you meant to draw. */
const MIN_CIRCLE_MM = 150

/** The radius a circle drag has reached, on the same clean steps as everything
 *  else — a post is ordered in whole inches, not in pixels. */
function circleRadius(d: { from: Point; to: Point }, snapMm: number) {
  const raw = Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y)
  return Math.max(snapMm, Math.round(raw / snapMm) * snapMm)
}

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
  /** A corner of the shape at any angle. */
  | { kind: 'corner'; index: number; start: DrawItPlan }
  /** The angle ring on a picked wall: swings the far end round the near one. */
  | { kind: 'angle'; index: number; start: DrawItPlan }
  /** A circle being dragged out from its centre. `tapped` is a circle already
   *  on the sheet that the press landed on, so a tap picks it instead of drawing. */
  | { kind: 'circle'; from: Point; to: Point; tapped?: number }

/** Fit the paper into the box it sits in. */
function fitFrame(w: number, h: number, pageW: number, pageD: number): Frame {
  const aw = Math.max(40, w - EDGE_PX * 2)
  const ah = Math.max(40, h - EDGE_PX * 2)
  const s = Math.min(aw / Math.max(1, pageW), ah / Math.max(1, pageD))
  return { s, ox: EDGE_PX + (aw - pageW * s) / 2, oy: EDGE_PX + (ah - pageD * s) / 2 }
}

/** Zoom and pan over the fitted page. See the note in FootprintEditor. */
type View = { z: number; x: number; y: number }
const HOME_VIEW: View = { z: 1, x: 0, y: 0 }
const MIN_ZOOM = 0.6
const MAX_ZOOM = 8

/** The grid is squared paper: pick the finest step that is still wide enough to read. */
function gridStepMm(scale: number, metric: boolean): number {
  const ladder = metric ? [500, 1000, 2000, 5000, 10000] : [1, 2, 5, 10, 20].map((ft) => ft * 304.8)
  return ladder.find((mm) => mm * scale >= 14) ?? ladder[ladder.length - 1]
}

export default function FootprintEditor({
  plan, onChange, mode, selectedWall, onSelectWall, onPickedUp, format, snapMm, metric, shellMm, free = false,
  wallsOnly = false, circleTool = false, underlay = null, onCommit, canUndo = false, canRedo = false, onUndo, onRedo, height = 300,
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
  /** Any angle: inside walls keep the angle they are dragged at. */
  free?: boolean
  /**
   * WALLS ONLY — no box round them, so the page is the paper and every wall is
   * part of the building. This is how the thing that is not four walls gets
   * drawn: a carport, a fence line, an addition. It is also what lets the print
   * be the paper below.
   */
  wallsOnly?: boolean
  /**
   * CIRCLES ON THE SHEET. The paper drags a circle out from its centre instead
   * of a wall, and a tap on one picks it. Walls stay on the plan and stay
   * pickable — a round post sits inside a room, it does not replace the drawing.
   */
  circleTool?: boolean
  /** The print under the walls: its page size in millimetres, and where to get
   *  it. Same scale as the walls, so a wall drawn on a line is that line's
   *  real length. */
  underlay?: { url: string; wMm: number; dMm: number } | null
  /** The plan as it was before a gesture: one step of undo per drag, not per move. */
  onCommit?: (before: DrawItPlan) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
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
  /**
   * THE CHAIN. Drawing a building is one wall after another, so the end of the
   * wall just drawn is where the next one starts: tap the paper once to park
   * the start, tap again and the wall is there, and the end of that is the next
   * start — round a corner, along a wall, round a curve. Tap the parked end
   * again and the run is finished. Nothing is ever assumed to be a box.
   */
  const [armed, setArmed] = useState<Point | null>(null)
  /** The far end of the chain under a mouse pointer, for the live rubber band. */
  const [hover, setHover] = useState<Point | null>(null)
  const [editing, setEditing] = useState<{ key: string; text: string; bad: boolean } | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  /** The circle tapped, showing its diameter and its remove. */
  const [pickedCircle, setPickedCircle] = useState<number | null>(null)
  const [pickedUp, setPickedUpState] = useState(false)
  /** The shape's corner tapped, showing its ✕. */
  const [corner, setCorner] = useState<number | null>(null)
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

  /**
   * ZOOM AND PAN — Mitchell, 25 Oct 2026: "proper camera controls" for drawing.
   *
   * One finger stays the pencil: it draws, pulls and moves exactly as before.
   * Two fingers are the camera, pinch to zoom and drag to pan, and the plan
   * never turns. A second finger landing mid-drag puts that drag back, so a
   * pinch cannot leave a half-pulled wall behind. With a mouse, the wheel
   * zooms at the cursor and a right or middle drag pans. + / − / Fit sit in
   * the corner for one-handed use.
   *
   * The view sits ON TOP of the fitted frame: zoom 1 at no offset is the old
   * whole-page fit, so Fit is just going home.
   */
  const [view, setView] = useState<View>(HOME_VIEW)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; cx: number; cy: number; start: View } | null>(null)
  /** Fingers stay the camera's until every one of them is up. */
  const camGesture = useRef(false)
  const mousePan = useRef<{ id: number; x: number; y: number; start: View } | null>(null)
  const zoomAt = (v: View, z: number, px: number, py: number): View => {
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    // Keep the point under (px, py) under it.
    return { z: nz, x: px - ((px - v.x) / v.z) * nz, y: py - ((py - v.y) / v.z) * nz }
  }
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Native and not passive, so the wheel zooms the plan instead of scrolling the sheet.
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const k = Math.exp(-e.deltaY * 0.0015)
      const px = e.clientX - r.left, py = e.clientY - r.top
      setView((v) => zoomAt(v, v.z * k, px, py))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const boxes = plan.boxes
  const placed = wallsOnly ? [] : houseRects(plan)
  if (!wallsOnly && placed.length === 0) return null
  const shape = plan.shape
  // The extent of the house: its shape's, when it has one. With no house, it is
  // the page — the walls can be anywhere on the paper.
  const ext = shape ? shape.map((q) => ({ x1: q.x, y1: q.y, x2: q.x, y2: q.y })) : placed
  const bounds: Rect = wallsOnly
    ? { x1: 0, y1: 0, x2: plan.page.w, y2: plan.page.d }
    : {
      x1: Math.min(...ext.map((r) => r.x1)), y1: Math.min(...ext.map((r) => r.y1)),
      x2: Math.max(...ext.map((r) => r.x2)), y2: Math.max(...ext.map((r) => r.y2)),
    }

  const fit = fitFrame(size.w, size.h, plan.page.w, plan.page.d)
  const f = { s: fit.s * view.z, ox: fit.ox * view.z + view.x, oy: fit.oy * view.z + view.y }
  const X = (mm: number) => f.ox + mm * f.s
  const Y = (mm: number) => f.oy + mm * f.s
  const toMm = (e: { clientX: number; clientY: number }): Point => {
    const r = wrapRef.current?.getBoundingClientRect()
    return { x: (e.clientX - (r?.left ?? 0) - f.ox) / f.s, y: (e.clientY - (r?.top ?? 0) - f.oy) / f.s }
  }
  const B = { x1: X(bounds.x1), y1: Y(bounds.y1), x2: X(bounds.x2), y2: Y(bounds.y2) }
  const shown = picked !== null && picked > 0 && picked < boxes.length ? picked : null
  const slidingBox = drag?.kind === 'slide' ? drag.box : null
  const outlineMode = mode === 'outline' && !wallsOnly
  /** The print is the paper. Its ink is dark, so anything drawn on it has to be
   *  too — the walls were #cbd5e1 and the arrow #e6f1fd, which is white on
   *  white paper. Same drawing, opposite ink. */
  const onPrint = !!underlay

  // ── Dimensions ──────────────────────────────────────────────────────────
  const { lanes } = dimensionLanes(boxes)
  const dims: Dim[] = []
  // A shape at any angle carries a length on each wall instead (see edgeChips),
  // and walls on their own have no box to dimension.
  if (!shape && !wallsOnly) boxes.forEach((b, i) => {
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
  const m = placed[0] ?? { x1: 0, y1: 0, x2: 0, y2: 0 }
  // Where the main box's walls are open to a section, there is no wall there
  // to hold: find the stretch of each wall still on the outside, and put that
  // wall's grip in the middle of the longest one.
  const openRuns = (side: AttachSide): Array<[number, number]> => {
    if (boxes.length === 0) return []
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
  if (outlineMode && !pickedUp && !shape) {
    for (const g of candidates) if (grips.every((k) => Math.hypot(k.x - g.x, k.y - g.y) >= 56)) grips.push(g)
  }
  const gripKey = (g: Grip) => `${g.box}:${g.kind}:${g.fromLeft ? 'L' : ''}${g.fromTop ? 'T' : ''}`

  // ── Pointer ───────────────────────────────────────────────────────────────
  const snapOpts = { gridMm: snapMm, tolMm: REACH_PX / f.s, shellMm, free, noShell: wallsOnly }
  /** Is this a wall worth keeping? With no shell under it, only its length can say no. */
  const wallOk = (w: InsideWall) => (wallsOnly ? wallLength(w) >= MIN_WALL_MM : acceptsWall(plan, w))
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
    } else if (drag.kind === 'circle') {
      // A press that landed ON a circle is a tap at it, not a new circle: the
      // ring is a target, and a thumb that rolls while tapping must not draw.
      if (drag.tapped == null) setDrag({ ...drag, to: snapWallPoint(plan, toMm(e), snapOpts) })
    } else if (drag.kind === 'draw') {
      const to = snapWallPoint(plan, toMm(e), { ...snapOpts, from: drag.from })
      // With no shell there is nothing to stop a wall at, and nothing to clip it to.
      setDrag({ ...drag, to: wallsOnly ? to : clipToShell(plan, drag.from, to, shellMm) })
    } else if (drag.kind === 'corner' && from.moved >= TAP_SLOP_PX) {
      onChange(movedCorner(drag.start, drag.index, toMm(e), snapMm))
    } else if (drag.kind === 'angle') {
      // SWING IT: the far end goes round the near one at the length it already
      // is, magnetised to the 45s. Changing the angle of one wall is a thing you
      // do to that wall, on the plan, not a setting for the whole sheet.
      const w0 = drag.start.walls[drag.index]
      const L = Math.hypot(w0.x2 - w0.x1, w0.y2 - w0.y1)
      const to = toMm(e)
      const raw = (Math.atan2(to.y - w0.y1, to.x - w0.x1) * 180) / Math.PI
      const on45 = Math.round(raw / 45) * 45
      const deg = Math.abs(raw - on45) <= 3 ? on45 : Math.round(raw)
      const r = (deg * Math.PI) / 180
      const w = { ...w0, x2: w0.x1 + Math.cos(r) * L, y2: w0.y1 + Math.sin(r) * L }
      onChange({ ...drag.start, walls: drag.start.walls.map((k, i) => (i === drag.index ? w : k)) })
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
    /** The plan to come back to: as it was when the finger landed. */
    const before = d && 'start' in d ? d.start : plan
    const keep = () => onCommit?.(before)
    dragFrom.current = null
    setDrag(null)
    if (!d) return
    if (d.kind === 'slide' && tapped) setPicked(shown === d.box ? null : d.box)
    if (d.kind === 'corner') {
      if (tapped) { setCorner(corner === d.index ? null : d.index); return }
      setCorner(null)
      // Walls crossing, or one shrunk to nothing: put it back.
      if (!plan.shape || !shapeOk(plan.shape)) { onChange(d.start); return }
      keep()
      onChange(fitPage(plan))
      return
    }
    if (d.kind === 'circle') {
      if (tapped && d.tapped != null) { setPickedCircle(d.tapped); return }
      const r = circleRadius(d, snapMm)
      if (r >= MIN_CIRCLE_MM) {
        keep()
        onChange(fitPage(addCircle(plan, { cx: d.from.x, cy: d.from.y, r })))
      }
      setPickedCircle(null)
      return
    }
    if (d.kind === 'draw') {
      const w = { x1: d.from.x, y1: d.from.y, x2: d.to.x, y2: d.to.y }
      if (tapped && d.tapped != null) { onSelectWall(d.tapped); return }
      if (!tapped && wallOk(w)) {
        // A WALL IS DRAWN, NOT PICKED. Selecting it here put its two end grips,
        // 48px each, exactly where the next wall starts — so the second wall of
        // a run stretched the first one's end instead of drawing, which is the
        // commonest thing anyone does on this sheet. Tap a wall when you want
        // its ends; a drag on the paper keeps drawing.
        keep()
        onChange({ ...plan, walls: [...plan.walls, w] })
        // The end just drawn is the start of the next wall.
        setArmed({ x: w.x2, y: w.y2 })
        onSelectWall(null)
        return
      }
      if (tapped) {
        // A TAP IS A CORNER. The first tap parks the start; each tap after it
        // draws that wall and parks the new end, so a building goes up one
        // wall at a time, round as many corners as it has. A tap back on the
        // parked end finishes the run.
        const p = d.from
        if (!armed) { setArmed(p); onSelectWall(null); return }
        if (Math.hypot(armed.x - p.x, armed.y - p.y) < 6 / f.s) { setArmed(null); onSelectWall(null); return }
        const w = { x1: armed.x, y1: armed.y, x2: p.x, y2: p.y }
        if (wallOk(w)) {
          keep()
          onChange({ ...plan, walls: [...plan.walls, w] })
          setArmed(p)
        }
      }
      onSelectWall(null)
      return
    }
    if (d.kind === 'wall') {
      // A wall dragged off the house, or shrunk to nothing, goes back.
      const w = plan.walls[d.index]
      if (w && !wallOk(w)) { onChange(d.start); return }
      keep()
      return
    }
    // Grow the paper once, now the finger is off it — and one step of undo for
    // the drag, which is the same for a grip, a slide, a moved house and a wall
    // swung by its ring.
    if (!tapped) { keep(); onChange(fitPage(plan)) }
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
    if (circleTool) {
      const p = snapWallPoint(plan, toMm(e), snapOpts)
      onSelectWall(null)
      setPickedCircle(null)
      begin(e, { kind: 'circle', from: p, to: p })
      return
    }
    if (mode === 'walls' || wallsOnly) {
      const p = snapWallPoint(plan, toMm(e), snapOpts)
      // A press near the parked end starts there, not at the pixel: the tip of
      // the last wall is exactly where the next one goes.
      const from = armed && Math.hypot(armed.x - p.x, armed.y - p.y) < 60 / f.s ? armed : p
      onSelectWall(null)
      begin(e, { kind: 'draw', from, to: from })
      return
    }
    setPicked(null)
    setCorner(null)
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
    if (editing.key.startsWith('edge:')) {
      const mm = parseSizeMm(raw)
      if (mm === null || !(mm > 0)) return false
      const next = withEdgeLength(plan, Number(editing.key.slice(5)), mm)
      if (!next.shape || !shapeOk(next.shape)) return false
      onCommit?.(plan)
      onChange(fitPage(next))
      return true
    }
    if (editing.key.startsWith('circle:')) {
      const i = Number(editing.key.slice(7))
      const mm = parseSizeMm(raw)
      if (mm === null || !(mm > 0)) return false
      onCommit?.(plan)
      onChange(withCircleDiameter(plan, i, mm))
      return true
    }
    if (editing.key.startsWith('wall:')) {
      const i = Number(editing.key.slice(5))
      const mm = parseSizeMm(raw)
      if (mm === null || !(mm > 0)) return false
      const w = withLength(plan.walls[i], mm)
      if (!wallOk(w)) return false
      onCommit?.(plan)
      onChange(fitPage({ ...plan, walls: plan.walls.map((k, j) => (j === i ? w : k)) }))
      return true
    }
    const d = dims.find((x) => x.key === editing.key)
    if (!d) return true
    const negative = d.field === 'off' && /^[-−]/.test(raw)
    const mm = parseSizeMm(raw.replace(/^[-−]\s*/, ''))
    if (mm === null || !(mm >= 0)) return false
    // Typed from the dimension, the main box keeps its top-left corner.
    onCommit?.(plan)
    if (d.field === 'off') onChange(fitPage({ ...plan, boxes: typeOffset(boxes, d.box, negative ? -mm : mm) }))
    else onChange(fitPage({ ...plan, boxes: typeBoxSize(boxes, d.box, d.field, mm) }))
    return true
  }

  const step = gridStepMm(f.s, metric)
  const outline = wallsOnly ? [] : houseOutline(plan)
  // No outline (walls on their own) is an empty path, not a path of one space and a Z.
  const outlinePath = outline.length
    ? outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ') + ' Z'
    : ''
  // An inside wall drawn at its real thickness — a 2x4 with board both sides,
  // about 4-1/2" — and never thinner than a line you can see.
  const wallPx = Math.max(3, 114 * f.s)
  const circleDrag = drag?.kind === 'circle' ? drag : null
  /** The walls each circle is built from — a ring of short straight bays. */
  const circleStrings = planCircles(plan).map((c) => circleString(c))

  // Walls on screen: the committed ones, plus the one being drawn.
  const drawing = drag?.kind === 'draw' ? { x1: drag.from.x, y1: drag.from.y, x2: drag.to.x, y2: drag.to.y } : null
  const wallChips: Array<{ key: string; x: number; y: number; w: InsideWall; live: boolean; withAngle: boolean }> = []
  const chipFor = (w: InsideWall, key: string, live: boolean, withAngle: boolean) => {
    const len = wallLength(w)
    if (len < 1) return
    const nx = -(w.y2 - w.y1) / len, ny = (w.x2 - w.x1) / len
    wallChips.push({
      key, live, w, withAngle,
      x: X((w.x1 + w.x2) / 2) + nx * WALL_LABEL_PX,
      y: Y((w.y1 + w.y2) / 2) + ny * WALL_LABEL_PX,
    })
  }
  const sel = !outlineMode && selectedWall != null && !drawing ? selectedWall : null
  const selW = sel != null ? plan.walls[sel] : undefined
  // A PICKED WALL CARRIES ONE HANDLE, on its middle — not one on each end. An
  // end grip is 48px of target sitting exactly where the next wall starts, so
  // picking a wall and then drawing on from it stretched that wall instead. The
  // ring sets the angle, the number types the length, the middle drags it.
  const wallEnds = sel != null && selW ? [{
    part: 'body' as const,
    x: X((selW.x1 + selW.x2) / 2),
    y: Y((selW.y1 + selW.y2) / 2),
    on: drag?.kind === 'wall' && drag.part === 'body',
    index: sel,
  }] : []

  // ── THE WALL WIDGET ──────────────────────────────────────────────────────
  // One wall picked, and everything about that wall in one place on the plan:
  // its angle (drag the ring), square, straight on from the wall it came off,
  // undo, redo, remove. The sheet-wide angle switch this replaces asked you to
  // decide before you drew; this asks after, about the wall in front of you.
  const angleDeg = selW ? wallAngleOffSquareDeg(selW.x1, selW.y1, selW.x2, selW.y2) : 0
  const onPickedWall = (next: InsideWall) => {
    if (sel == null) return
    onCommit?.(plan)
    onChange({ ...plan, walls: plan.walls.map((k, i) => (i === sel ? next : k)) })
  }
  /** Exactly level or plumb, whichever it is nearer to, at the length it is. */
  const squarePicked = () => {
    if (!selW) return
    const L = wallLength(selW)
    const dx = Math.abs(selW.x2 - selW.x1), dy = Math.abs(selW.y2 - selW.y1)
    onPickedWall(dx >= dy
      ? { ...selW, x2: selW.x1 + (selW.x2 >= selW.x1 ? L : -L), y2: selW.y1 }
      : { ...selW, x2: selW.x1, y2: selW.y1 + (selW.y2 >= selW.y1 ? L : -L) })
  }
  /** The wall this one grew off: the one with an end on its start. */
  const parentWall = sel != null && selW
    ? plan.walls.find((k, i) => i !== sel && (Math.hypot(k.x1 - selW.x1, k.y1 - selW.y1) < 1 || Math.hypot(k.x2 - selW.x1, k.y2 - selW.y1) < 1))
    : undefined
  /** STRAIGHT ON — no corner at the joint: in line with the wall it came off. */
  const straightPicked = () => {
    if (!selW || !parentWall) return
    const L = wallLength(selW)
    const far = Math.hypot(parentWall.x2 - selW.x1, parentWall.y2 - selW.y1) < 1
      ? { x: parentWall.x1, y: parentWall.y1 } : { x: parentWall.x2, y: parentWall.y2 }
    const dx = selW.x1 - far.x, dy = selW.y1 - far.y
    const d = Math.hypot(dx, dy) || 1
    onPickedWall({ ...selW, x2: selW.x1 + (dx / d) * L, y2: selW.y1 + (dy / d) * L })
  }
  const removePicked = () => {
    if (sel == null) return
    onCommit?.(plan)
    onChange({ ...plan, walls: plan.walls.filter((_, i) => i !== sel) })
    onSelectWall(null)
  }
  /** Arrow keys swing it a degree at a time, five with shift. */
  const swingByKey = (e: KeyboardEvent) => {
    if (!selW || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const L = wallLength(selW)
    const raw = (Math.atan2(selW.y2 - selW.y1, selW.x2 - selW.x1) * 180) / Math.PI
    const deg = raw + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 1)
    const r = (deg * Math.PI) / 180
    onPickedWall({ ...selW, x2: selW.x1 + Math.cos(r) * L, y2: selW.y1 + Math.sin(r) * L })
  }
  /** Where the widget sits: under the wall unless the plan runs out there. */
  const widgetAt = selW ? (() => {
    if (wallLength(selW) < 1) return null
    const mx = X((selW.x1 + selW.x2) / 2), my = Y((selW.y1 + selW.y2) / 2)
    const halfW = 146, halfH = 58, gap = 30
    const below = my + halfH + gap < size.h
    return {
      x: Math.min(Math.max(mx, halfW), Math.max(halfW, size.w - halfW)),
      y: below ? Math.min(my + halfH + gap, size.h - halfH) : Math.max(my - halfH - gap, halfH),
      tail: below ? 'top' : 'bottom',
    }
  })() : null

  // The shape's walls: each one's length on it, and a + to pull a corner out.
  const shapeOn = outlineMode && !!shape && !pickedUp
  const edges = shapeOn && shape ? shape.map((a, i) => {
      const b = shape[(i + 1) % shape.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
      const mx = X((a.x + b.x) / 2), my = Y((a.y + b.y) / 2)
      // The number sits ON its wall, the way an inside wall's does — off the
      // wall it ran off the plan or into its neighbour's — and the wall's + sits
      // beside it along the wall. A wall too short for both shows its + and
      // only shows its number while one of its corners is being dragged —
      // not on a tap, or the number pops up under the finger that tapped.
      // How far along the + sits: clear of a number that is wide on a wall
      // across the page and only its height on one up the page.
      const along = 34 + 22 * Math.abs(ux)
      const roomy = len * f.s >= 2 * along + 24
      const atEnd = (k: number) => k === i || k === (i + 1) % shape.length
      const live = drag?.kind === 'corner' && atEnd(drag.index)
      const show = roomy || live
      const plus = len * f.s > 56 && (roomy || !live)
      const px = roomy ? mx + ux * along : mx, py = roomy ? my + uy * along : my
      const cx = mx, cy = my
      return { i, a, b, len, px, py, cx, cy, show, plus }
  }) : []
  // The picked corner's ✕ sits just outside it, away from the middle of the
  // house, where no wall's number is.
  const cornerAt = corner != null && shape && shape[corner] ? (() => {
    const c = shape[corner]
    const gx = shape.reduce((t, q) => t + q.x, 0) / shape.length
    const gy = shape.reduce((t, q) => t + q.y, 0) / shape.length
    const d = Math.hypot(c.x - gx, c.y - gy) || 1
    const at = (k: number) => ({
      x: Math.min(size.w - 50, Math.max(50, X(c.x) + ((c.x - gx) / d) * 52 * k)),
      y: Math.min(size.h - 22, Math.max(22, Y(c.y) + ((c.y - gy) / d) * 52 * k)),
    })
    // No room outside — the plan's edge would push it back ONTO the corner,
    // and the tap that picked the corner would take it out — so inside.
    const out = at(1)
    return Math.hypot(out.x - X(c.x), out.y - Y(c.y)) >= 44 ? out : at(-1)
  })() : null

  if (drawing) chipFor(drawing, 'drawing', true, true)
  else if (selectedWall != null && plan.walls[selectedWall]) chipFor(plan.walls[selectedWall], `wall:${selectedWall}`, false, false)

  // ── Camera: two fingers, the wheel, a right drag. Heard in the CAPTURE phase,
  // ahead of the grips and the paper, so a camera gesture never reaches them.
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  /** Put back whatever one finger had started, the moment it becomes a pinch. */
  const dropDrag = () => {
    const d = drag
    dragFrom.current = null
    setDrag(null)
    if (d && 'start' in d) onChange(d.start)
  }
  const camDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) return
      e.preventDefault(); e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      mousePan.current = { id: e.pointerId, ...local(e), start: view }
      return
    }
    // THE SHEET LOCKS WHILE YOU DRAW. A second finger landing mid-stroke is a
    // hand resting on the paper, not a camera: the wall being drawn finishes
    // where that finger leaves it, and the camera gets the next gesture. It
    // used to throw the wall away and pinch instead — the drawing lost to a
    // gesture meant to steady the phone.
    if (drag?.kind === 'draw') return
    pts.current.set(e.pointerId, local(e))
    if (pts.current.size < 2) return
    e.preventDefault(); e.stopPropagation()
    if (!camGesture.current) dropDrag()
    camGesture.current = true
    const [a, b] = [...pts.current.values()]
    pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, start: view }
  }
  const camMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const mp = mousePan.current
    if (mp && e.pointerId === mp.id) {
      const p = local(e)
      setView({ ...mp.start, x: mp.start.x + p.x - mp.x, y: mp.start.y + p.y - mp.y })
      e.stopPropagation()
      return
    }
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, local(e))
    if (!camGesture.current) return
    e.stopPropagation()
    const p0 = pinch.current
    if (!p0 || pts.current.size < 2) return
    const [a, b] = [...pts.current.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    const zoomed = zoomAt(p0.start, p0.start.z * (dist / Math.max(1, p0.dist)), p0.cx, p0.cy)
    setView({ ...zoomed, x: zoomed.x + cx - p0.cx, y: zoomed.y + cy - p0.cy })
  }
  const camUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mousePan.current?.id === e.pointerId) { mousePan.current = null; e.stopPropagation(); return }
    pts.current.delete(e.pointerId)
    if (!camGesture.current) return
    e.stopPropagation()
    if (pts.current.size < 2) pinch.current = null
    if (pts.current.size === 0) camGesture.current = false
  }
  const zoomBy = (k: number) => setView(zoomAt(view, view.z * k, size.w / 2, size.h / 2))
  const home = view.z === 1 && view.x === 0 && view.y === 0

  return (
    <div className={styles.stack}>
    <div ref={wrapRef} className={`${styles.wrap} ${mode === 'walls' || wallsOnly ? styles.wrapWalls : ''}`}
      onPointerDownCapture={camDown} onPointerMoveCapture={camMove}
      onPointerUpCapture={camUp} onPointerCancelCapture={camUp}
      onContextMenu={(e) => e.preventDefault()}>
      <svg className={styles.svg} width={size.w} height={size.h} aria-hidden>
        <defs>
          <pattern id={`${ids}g`} width={step * f.s} height={step * f.s} x={f.ox} y={f.oy} patternUnits="userSpaceOnUse">
            <path d={`M ${step * f.s} 0 L 0 0 0 ${step * f.s}`} fill="none" stroke="#2b3b5c" strokeWidth={1} />
          </pattern>
          {(['n', 'a', 'w'] as const).map((k) => (
            <marker key={k} id={`${ids}${k}`} markerWidth={10} markerHeight={10} refX={9} refY={5}
              orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M0,1.5 L9,5 L0,8.5 Z" fill={k === 'a' ? '#3d9ae8' : onPrint ? '#0f172a' : k === 'w' ? '#e6f1fd' : '#aebccd'} />
            </marker>
          ))}
        </defs>

        {/* THE PRINT UNDER THE WALLS. The sheet is the print's own size at its
            own scale, so a wall drawn along a line is that line's real length,
            and pan/zoom reaches the corner that a whole-page fit cuts off. */}
        {underlay && (
          <image href={underlay.url} x={X(0)} y={Y(0)}
            width={underlay.wMm * f.s} height={underlay.dMm * f.s}
            preserveAspectRatio="none" opacity={1} pointerEvents="none" />
        )}

        {/* The paper. In walls mode a drag on it draws; in outline mode a tap on
            it puts down whatever was picked up. */}
        <rect width={size.w} height={size.h} fill={`url(#${ids}g)`} opacity={underlay ? 0.2 : 1}
          className={styles.paper}            onPointerDown={pressPaper}
            onPointerMove={(e) => { move(e); if (armed && e.pointerType === 'mouse' && !dragFrom.current) setHover(snapWallPoint(plan, toMm(e), { ...snapOpts, from: armed })) }}
            onPointerUp={end} onPointerCancel={end} />
        <rect x={X(0)} y={Y(0)} width={plan.page.w * f.s} height={plan.page.d * f.s}
          fill="none" stroke="#3a4a63" strokeWidth={1} strokeDasharray="6 4" pointerEvents="none" />

        {shape && (
          <path d={outlinePath} fill={pickedUp ? 'rgba(61,154,232,0.32)' : 'rgba(61,154,232,0.20)'} pointerEvents="none" />
        )}
        {!shape && placed.map((r, i) => (
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
        {outlineMode && shape && (
          <path d={outlinePath} className={styles.body} fill="transparent"
            onPointerDown={(e) => { setCorner(null); pressHouse(e, 0) }}
            onPointerMove={move}
            onPointerUp={(e) => {
              if ((dragFrom.current?.moved ?? 0) < TAP_SLOP_PX) lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
              end(e)
            }}
            onPointerCancel={end} />
        )}
        {outlineMode && !shape && placed.map((r, i) => (
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

        {/* CIRCLES ARE CURVED WALLS. The ring is the line they are set out to —
            a trammel point and a string — and the chords under it are what gets
            framed: one stud bay a wall, so the sheathing has studs to bend over.
            Square caps, because consecutive chords share an end and a butt cap
            would notch the outside of every break. */}
        {planCircles(plan).map((c, i) => {
          const on = pickedCircle === i
          const s = circleStrings[i]
          return (
            <g key={`o${i}`}>
              <circle cx={X(c.cx)} cy={Y(c.cy)} r={c.r * f.s}
                fill="none" stroke={on ? '#3d9ae8' : '#64748b'}
                strokeWidth={on ? 2 : 1.5} strokeDasharray="7 5" opacity={on ? 1 : 0.7}
                pointerEvents="none" />
              {s.walls.map((w, k) => (
                <line key={k} x1={X(w.x1)} y1={Y(w.y1)} x2={X(w.x2)} y2={Y(w.y2)}
                  stroke={on ? '#3d9ae8' : onPrint ? '#0f172a' : '#cbd5e1'}
                  strokeWidth={on ? wallPx + 2 : wallPx} strokeLinecap="square"
                  opacity={outlineMode ? 0.55 : 1} pointerEvents="none" />
              ))}
              <circle cx={X(c.cx)} cy={Y(c.cy)} r={c.r * f.s}
                fill="none" stroke="transparent" strokeWidth={REACH_PX} className={styles.wallHit}
                onPointerDown={(e) => begin(e, { kind: 'circle', from: { x: c.cx, y: c.cy }, to: { x: c.cx, y: c.cy }, tapped: i })}
                onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              {!outlineMode && s.walls.map((w, k) => (
                <line key={`h${k}`} x1={X(w.x1)} y1={Y(w.y1)} x2={X(w.x2)} y2={Y(w.y2)}
                  stroke="transparent" strokeWidth={REACH_PX} className={styles.wallHit}
                  onPointerDown={(e) => begin(e, { kind: 'circle', from: { x: w.x1, y: w.y1 }, to: { x: w.x1, y: w.y1 }, tapped: i })}
                  onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              ))}
            </g>
          )
        })}
        {circleDrag && (
          <g pointerEvents="none">
            <circle cx={X(circleDrag.from.x)} cy={Y(circleDrag.from.y)} r={circleRadius(circleDrag, snapMm) * f.s}
              fill="rgba(61,154,232,0.12)" stroke="#3d9ae8" strokeWidth={2} strokeDasharray="8 4" />
            <line x1={X(circleDrag.from.x)} y1={Y(circleDrag.from.y)} x2={X(circleDrag.to.x)} y2={Y(circleDrag.to.y)}
              stroke="#3d9ae8" strokeWidth={1.5} strokeDasharray="4 4" />
          </g>
        )}

        {/* Inside walls. The wide invisible line is what a finger hits. */}
        {plan.walls.map((w, i) => {
          const sel = selectedWall === i
          return (
            <g key={`w${i}`}>
              <line x1={X(w.x1)} y1={Y(w.y1)} x2={X(w.x2)} y2={Y(w.y2)}
                stroke={sel ? '#3d9ae8' : onPrint ? '#0f172a' : '#cbd5e1'} strokeWidth={sel ? wallPx + 2 : wallPx}
                strokeLinecap="butt" opacity={outlineMode ? 0.55 : 1} pointerEvents="none" />
              {!outlineMode && !circleTool && (
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
        {/* THE CHAIN: where the next wall starts, and where it would go. */}
        {armed && (
          <circle cx={X(armed.x)} cy={Y(armed.y)} r={7} fill="none" stroke="#3d9ae8" strokeWidth={2.5} pointerEvents="none" />
        )}
        {armed && hover && !drawing && (
          <line x1={X(armed.x)} y1={Y(armed.y)} x2={X(hover.x)} y2={Y(hover.y)}
            stroke="#3d9ae8" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
        )}
        {drawing && (
          <line x1={X(drawing.x1)} y1={Y(drawing.y1)} x2={X(drawing.x2)} y2={Y(drawing.y2)}
            stroke="#3d9ae8" strokeWidth={wallPx} strokeDasharray="8 4" pointerEvents="none" />
        )}
        {/* The stretchy arrow: end to end on the wall being drawn, the way the
            dimension sits on a print, stretching with the finger. */}
        {drawing && wallLength(drawing) * f.s > 12 && (
          <line x1={X(drawing.x1)} y1={Y(drawing.y1)} x2={X(drawing.x2)} y2={Y(drawing.y2)}
            stroke={onPrint ? '#0f172a' : '#e6f1fd'} strokeWidth={2} pointerEvents="none"
            markerStart={`url(#${ids}w)`} markerEnd={`url(#${ids}w)`} />
        )}

        {dims.map((d) => {
          const on = active.has(d.key) || editing?.key === d.key
          const stroke = on ? '#3d9ae8' : onPrint ? '#334155' : '#aebccd'
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

      {/* AT ANY ANGLE: a + on each wall pulls out a new corner… */}
      {edges.map((e) => (e.plus && (
        <button key={`add${e.i}`} type="button" className={`${styles.grip} ${styles.gripAdd}`}
          style={{ left: e.px, top: e.py }}
          aria-label="Pull out a new corner here"
          onPointerDown={(ev) => {
            const next = addCorner(plan, e.i)
            onChange(next)
            setCorner(null)
            begin(ev, { kind: 'corner', index: e.i + 1, start: next })
          }}
          onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      )))}
      {/* …and every corner drags anywhere. */}
      {shapeOn && shape?.map((q, i) => {
        const on = drag?.kind === 'corner' && drag.index === i
        return (
          <button key={`c${i}`} type="button"
            className={[styles.grip, styles.gripCorner, on ? styles.gripOn : '', corner === i ? styles.gripPicked : ''].filter(Boolean).join(' ')}
            style={{ left: X(q.x), top: Y(q.y) }}
            aria-label={`Corner ${i + 1}: drag it anywhere`}
            onPointerDown={(e) => begin(e, { kind: 'corner', index: i, start: plan })}
            onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        )
      })}
      {shapeOn && cornerAt && corner != null && (shape?.length ?? 0) > 3 && (
        <button type="button" className={styles.cornerX}
          style={{ left: cornerAt.x, top: cornerAt.y }}
          onClick={() => {
            const next = removeCorner(plan, corner)
            if (next.shape && shapeOk(next.shape)) onChange(fitPage(next))
            setCorner(null)
          }}>
          ✕ Corner
        </button>
      )}

      {/* The picked circle's ✕. Sits outside the ring, on the side with room. */}
      {pickedCircle != null && planCircles(plan)[pickedCircle] && (() => {
        const c = planCircles(plan)[pickedCircle]
        return (
          <button type="button" className={styles.cornerX}
            style={{ left: Math.min(size.w - 56, X(c.cx + c.r) + 20), top: Y(c.cy) }}
            onClick={() => {
              onCommit?.(plan)
              onChange(removeCircle(plan, pickedCircle))
              setPickedCircle(null)
            }}>
            ✕ Circle
          </button>
        )
      })()}

      {/* The picked wall's two ends: drag one to stretch or swing the wall. */}
      {wallEnds.map((g) => (
        <button key={g.part} type="button"
          className={[styles.grip, g.part === 'body' ? styles.gripMove : '', g.on ? styles.gripOn : ''].filter(Boolean).join(' ')}
          style={{ left: g.x, top: g.y }}
          aria-label="Drag to move the wall"
          onPointerDown={(e) => begin(e, { kind: 'wall', index: g.index, part: g.part, start: plan })}
          onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      ))}

      {/* THE WALL WIDGET, on the plan by the wall it is about. A transient
          thing the user opened by picking a wall: tapping the paper puts it
          away, and it never covers the wall it names. */}
      {sel != null && selW && widgetAt && (
        <div className={styles.wallWidget} style={{ left: widgetAt.x, top: widgetAt.y }} data-tail={widgetAt.tail} role="group" aria-label="Wall">
          <div className={styles.widgetRow}>
            <button type="button" className={`${styles.wBtn} ${styles.wAngle}`}
              aria-label={`Wall angle ${angleDeg} degrees off square. Drag to swing the wall.`}
              onPointerDown={(e) => begin(e, { kind: 'angle', index: sel, start: plan })}
              onPointerMove={move} onPointerUp={end} onPointerCancel={end}
              onKeyDown={swingByKey}>
              ⟳ {angleDeg}°
            </button>
            <button type="button" className={styles.wBtn} onClick={squarePicked}
              title="Set it exactly level or plumb">⊾ Square</button>
            <button type="button" className={styles.wBtn} onClick={straightPicked} disabled={!parentWall}
              title={parentWall ? 'No corner here: in line with the wall it starts on' : 'It has to start on another wall to run straight on'}>
              ⌐ Straight
            </button>
          </div>
          <div className={styles.widgetRow}>
            <button type="button" className={styles.wBtn} onClick={onUndo} disabled={!canUndo}>↶ Undo</button>
            <button type="button" className={styles.wBtn} onClick={onRedo} disabled={!canRedo}>↷ Redo</button>
            <button type="button" className={`${styles.wBtn} ${styles.wRemove}`} onClick={removePicked}>✕ Remove</button>
          </div>
        </div>
      )}

      {[...dims.map((d) => ({
        key: d.key, x: (d.line[0] + d.line[2]) / 2, y: (d.line[1] + d.line[3]) / 2,
        valueMm: d.valueMm, vertical: d.vertical, live: false, on: active.has(d.key),
        what: d.field === 'w' ? 'Width' : d.field === 'd' ? 'Depth' : 'From the corner',
      })), ...wallChips.map((c) => ({
        key: c.key, x: c.x, y: c.y, valueMm: wallLength(c.w), vertical: false, live: c.live, on: true, what: 'Wall', withAngle: c.withAngle,
        // A diagonal reads its angle off square beside its length — while it is
        // being drawn. A picked wall does not: it has the angle ring, and two
        // readouts of the same number is exactly the clutter this replaces.
        angle: ('withAngle' in c && c.withAngle) ? wallAngleOffSquareDeg(c.w.x1, c.w.y1, c.w.x2, c.w.y2) % 90 : 0,
      })), ...planCircles(plan).map((c, i) => ({
        key: `circle:${i}`, x: X(c.cx + c.r), y: Y(c.cy), valueMm: c.r * 2, vertical: false,
        live: false, on: pickedCircle === i, what: 'Diameter', prefix: 'Ø ',
      })), ...edges.filter((e) => e.show).map((e) => ({
        key: `edge:${e.i}`, x: e.cx, y: e.cy, valueMm: e.len, vertical: false,
        live: drag?.kind === 'corner', on: false, what: 'Wall',
        angle: wallAngleOffSquareDeg(e.a.x, e.a.y, e.b.x, e.b.y) % 90,
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
            {'prefix' in c && typeof c.prefix === 'string' ? c.prefix : ''}{labelFor(c.valueMm)}{'angle' in c && c.angle ? ` · ${c.angle}°` : ''}
          </button>
        )
      })}

    </div>

      {/* THE CAMERA SITS BELOW THE PLAN, not on it. Mitchell, 30 Oct 2026:
          "move them outside the box." Laid over the drawing they were under the
          finger that was pulling a corner — a tap meant for a grip zoomed the
          page instead. Out here they are still one-handed, and the whole plan
          is drawing surface again. The button row is outside the pan/zoom
          surface, so it takes taps, not pinches. */}
      <div className={styles.cam}>
        {/* UNDO AND REDO, on the same line as the camera: both act on the plan
            below them, and neither belongs over the drawing. */}
        <div className={styles.camGroup} role="group" aria-label="Undo and redo">
          <button type="button" className={styles.camBtn} onClick={onUndo} disabled={!canUndo} aria-label="Undo">↶</button>
          <button type="button" className={styles.camBtn} onClick={onRedo} disabled={!canRedo} aria-label="Redo">↷</button>
        </div>
        <div className={styles.camGroup} role="group" aria-label="Zoom">
          <button type="button" className={styles.camBtn} onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
          <button type="button" className={styles.camBtn} onClick={() => zoomBy(1.5)} aria-label="Zoom in">+</button>
          {!home && (
            <button type="button" className={`${styles.camBtn} ${styles.camFit}`} onClick={() => setView(HOME_VIEW)} aria-label="Fit the whole page">Fit</button>
          )}
        </div>
      </div>
    </div>
  )
}
