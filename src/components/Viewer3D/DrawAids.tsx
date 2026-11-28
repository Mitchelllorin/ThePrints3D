/**
 * DRAW AIDS — what the drawing system shows while a wall run is drawn in the
 * main workspace. The rules live in services/drawSystem.ts (shared with Draw
 * it); this file only draws what a snap said it did:
 *
 *   - the guide along the held angle, and a dotted line to the corner the
 *     point lined up with;
 *   - a marker on the point: a ring on a wall end, a cross on a wall, a diamond
 *     on an alignment;
 *   - the close ring on the run's first point, bright when the next tap closes;
 *   - the corner angle, as plain text inside the corner, tap to type it;
 *   - Undo and Done, outlined text beside the corner, clear of the pointer;
 *   - the loupe: while a finger is down, the point drawn magnified ABOVE the
 *     finger, so the finger never hides where the corner lands.
 *
 * Everything is plain text and lines over the model. Readouts and controls
 * are placed in screen pixels each frame, so they hold their distance from the
 * point and the pointer at any zoom.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Tap from './Tap'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Grid, Html, Line } from '@react-three/drei'
import { DRAW, reachNow, type DrawSnap } from '../../services/drawSystem'
import styles from './WallDimension.module.css'
import { freeArea, placeClear } from './hudPlace'

type P3 = [number, number, number]
type PX = [number, number]

const STOP_KINDS = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick'] as const
const stopHere = (e: Event) => e.stopPropagation()
/** Stop a DOM control's events reaching the 3D surface under it, natively —
 *  React's stopPropagation is too late for R3F's own listeners. */
function useStopRef() {
  const ref = useRef<HTMLElement | null>(null)
  return useCallback((el: HTMLElement | null) => {
    const prev = ref.current
    if (prev) STOP_KINDS.forEach((k) => prev.removeEventListener(k, stopHere))
    ref.current = el
    if (el) STOP_KINDS.forEach((k) => el.addEventListener(k, stopHere))
  }, [])
}

/**
 * A chip anchored on the plan (a picked wall, room or balcony) that keeps itself
 * in the free part of the screen: under its point if that fits, over it if the
 * trace controls along the bottom are in the way, and slid sideways rather
 * than run off an edge or onto the rail. Measured each frame, because the
 * anchor moves with every pan and zoom. Returns the ref for the chip's div; it
 * also stops the chip's events reaching the canvas (see useStopRef).
 */
function useChipClear(gap = 24) {
  const stop = useStopRef()
  const el = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let raf = 0
    let ox = 0, oy = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const e = el.current
      if (!e) return
      const r = e.getBoundingClientRect()
      if (r.width === 0) return
      // Where the chip's centre is with no shift: the anchor (Html centres it).
      const anchor = { x: r.left + r.width / 2 - ox, y: r.top + r.height / 2 - oy }
      const h = r.height
      const area = freeArea({ width: window.innerWidth, height: window.innerHeight })
      const o = placeClear(anchor, [{ x: 0, y: gap + h / 2 }, { x: 0, y: -(gap + h / 2) }],
        { w: r.width, h }, area, [{ ...anchor, r: 14 }], 6)
      const nx = Math.round(o.x), ny = Math.round(o.y)
      if (nx !== ox || ny !== oy) {
        ox = nx; oy = ny
        e.style.transform = `translate(${ox}px, ${oy}px)`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [gap])
  return useCallback((node: HTMLDivElement | null) => { el.current = node; stop(node) }, [stop])
}

/** A chip's row: wraps to a second line rather than run off a 360-wide phone. */
const CHIP_ROW: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, alignItems: 'center',
  whiteSpace: 'nowrap', width: 'max-content',
  maxWidth: 'min(340px, calc(100vw - var(--rail-w, 44px) - 24px))',
}

const _v = new THREE.Vector3()
function toScreen(p: P3, camera: THREE.Camera, size: { width: number; height: number }) {
  _v.set(p[0], p[1], p[2]).project(camera)
  return { x: (_v.x + 1) / 2 * size.width, y: (1 - _v.y) / 2 * size.height }
}
const unit = (x: number, y: number) => { const L = Math.hypot(x, y); return L < 1e-9 ? { x: 0, y: 0 } : { x: x / L, y: y / L } }

/** A ring of `r` world units round `c`, as a closed line. */
function ring(c: P3, r: number, n = 28): P3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    return [c[0] + Math.cos(t) * r, c[1] + 0.01, c[2] + Math.sin(t) * r] as P3
  })
}

export function TraceAids({
  toWorld, worldPerScreenPx, anchor, runStart, prevDir, snap, color,
  onTypedAngle, onDone, showControls,
}: {
  toWorld: (px: PX) => P3
  /** World units per screen pixel at the anchor, to size markers in pixels. */
  worldPerScreenPx: number
  anchor: PX
  runStart: PX | null
  prevDir: PX | null
  snap: DrawSnap | null
  color: string
  onTypedAngle: (text: string, toward: PX) => boolean
  /** Unused: Undo is the one at the top of the screen. */
  onUndo?: () => void
  onDone: () => void
  canUndo?: boolean
  showControls: boolean
}) {
  const a3 = toWorld(anchor)
  const k = worldPerScreenPx
  const end: PX | null = snap ? [snap.point.x, snap.point.y] : null
  const e3 = end ? toWorld(end) : null
  const closing = !!snap?.closes
  const runOpen = !!runStart && !!prevDir && Math.hypot(runStart[0] - anchor[0], runStart[1] - anchor[1]) > 1e-6

  // ── the corner readout and the controls, placed in screen space ──────────
  const cornerRef = useRef<HTMLDivElement | null>(null)
  const ctrlRef = useRef<HTMLDivElement | null>(null)
  const stopCorner = useStopRef()
  const stopCtrl = useStopRef()
  const [typing, setTyping] = useState<{ toward: PX } | null>(null)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)
  const prevPt: P3 | null = prevDir ? toWorld([anchor[0] - prevDir[0] * 50, anchor[1] - prevDir[1] * 50]) : null
  useFrame(({ camera, size }) => {
    const A = toScreen(a3, camera, size)
    const E = e3 ? toScreen(e3, camera, size) : null
    const P = prevPt ? toScreen(prevPt, camera, size) : null
    const uE = E ? unit(E.x - A.x, E.y - A.y) : { x: 1, y: 0 }
    const uP = P ? unit(P.x - A.x, P.y - A.y) : null
    const area = freeArea(size)
    // The end being dragged, and where the loupe sits over it, stay clear.
    const avoid = E ? [E, ...(showControls ? [] : [{ x: E.x, y: E.y - DRAW.LOUPE_LIFT_PX }])] : []
    // Corner angle INSIDE the corner, on the bisector — where a print puts it.
    let cornerAt: { x: number; y: number } | null = null
    if (cornerRef.current && uP) {
      let bi = unit(uP.x + uE.x, uP.y + uE.y)
      if (bi.x === 0 && bi.y === 0) bi = { x: -uE.y, y: uE.x }
      const c = cornerRef.current
      const o = placeClear(A, [
        { x: bi.x * 46, y: bi.y * 46 }, { x: bi.x * 70, y: bi.y * 70 }, { x: -bi.x * 46, y: -bi.y * 46 },
      ], { w: c.offsetWidth || 56, h: c.offsetHeight || 48 }, area, avoid, 40)
      el(c, o.x, o.y)
      cornerAt = { x: A.x + o.x, y: A.y + o.y }
    }
    // Undo / Done behind the corner, away from the wall being drawn and off
    // the wall before it; never on the corner readout.
    if (ctrlRef.current) {
      let n = { x: -uE.y, y: uE.x }
      if (n.y < 0) n = { x: -n.x, y: -n.y }
      const back = { x: -uE.x, y: -uE.y }
      // Behind the corner first, then round it — never ahead of it, where
      // the pointer is going, and never along the wall before.
      const ring8 = Array.from({ length: 12 }, (_, i) => {
        const t = (i / 12) * Math.PI * 2
        return { x: Math.cos(t) * 92, y: Math.sin(t) * 92 }
      })
      const cands = [
        { x: back.x * 78 + n.x * 44, y: back.y * 78 + n.y * 44 },
        { x: back.x * 78 - n.x * 44, y: back.y * 78 - n.y * 44 },
        { x: n.x * 70, y: n.y * 70 },
        { x: -n.x * 70, y: -n.y * 70 },
        ...ring8,
      ].filter((c) => {
        const L = Math.hypot(c.x, c.y)
        return (c.x * uE.x + c.y * uE.y) / L < 0.35 && (!uP || (c.x * uP.x + c.y * uP.y) / L < 0.8)
      })
      const c = ctrlRef.current
      const o = placeClear(A, cands.length ? cands : [{ x: 0, y: 70 }], { w: c.offsetWidth || 110, h: c.offsetHeight || 48 }, area,
        [...avoid, A, ...(cornerAt ? [cornerAt] : [])], 34)
      el(c, o.x, o.y)
    }
  })

  const submit = () => {
    if (typing && onTypedAngle(draft, typing.toward)) { setTyping(null); setDraft(''); setBad(false) }
    else setBad(true)
  }

  const guide = snap?.guide
  const g3 = guide ? [toWorld([guide.a.x, guide.a.y]), toWorld([guide.b.x, guide.b.y])] as [P3, P3] : null
  const al = snap?.alignGuide
  const al3 = al ? [toWorld([al.a.x, al.a.y]), toWorld([al.b.x, al.b.y])] as [P3, P3] : null
  const lift = (p: P3, dy = 0.03): P3 => [p[0], p[1] + dy, p[2]]
  const mark = 9 * k

  return (
    <>
      {g3 && <Line points={[lift(g3[0]), lift(g3[1])]} color="#fbbf24" lineWidth={1.5} dashed dashSize={10 * k} gapSize={7 * k} />}
      {al3 && <Line points={[lift(al3[0]), lift(al3[1])]} color="#fbbf24" lineWidth={1.2} dashed dashSize={4 * k} gapSize={5 * k} />}

      {/* The marker on the point says what it caught. */}
      {e3 && snap && (snap.kind === 'end' || snap.kind === 'close') && (
        <Line points={ring(lift(e3, 0.04), mark)} color={closing ? '#4ade80' : '#fbbf24'} lineWidth={3} />
      )}
      {e3 && snap?.kind === 'line' && (
        <>
          <Line points={[lift([e3[0] - mark, e3[1], e3[2] - mark], 0.04), lift([e3[0] + mark, e3[1], e3[2] + mark], 0.04)]} color="#fbbf24" lineWidth={3} />
          <Line points={[lift([e3[0] - mark, e3[1], e3[2] + mark], 0.04), lift([e3[0] + mark, e3[1], e3[2] - mark], 0.04)]} color="#fbbf24" lineWidth={3} />
        </>
      )}
      {e3 && snap?.kind === 'align' && (
        <Line points={[[e3[0], e3[1] + 0.04, e3[2] - mark], [e3[0] + mark, e3[1] + 0.04, e3[2]], [e3[0], e3[1] + 0.04, e3[2] + mark], [e3[0] - mark, e3[1] + 0.04, e3[2]], [e3[0], e3[1] + 0.04, e3[2] - mark]]} color="#fbbf24" lineWidth={3} />
      )}

      {/* THE CLOSE RING: the run's first point. Tap inside it to close the shape. */}
      {runOpen && runStart && (
        <Line points={ring(lift(toWorld(runStart), 0.035), reachNow() * DRAW.CLOSE_REACH * k)}
          color={closing ? '#4ade80' : color} lineWidth={closing ? 4 : 2} dashed={!closing} dashSize={6 * k} gapSize={5 * k} />
      )}
      {/* The anchor: where this wall starts. */}
      <Line points={ring(lift(a3, 0.035), 6 * k, 18)} color={color} lineWidth={3} />

      {/* Corner angle — plain text inside the corner. Tap it to type one. */}
      {prevDir && snap?.cornerDeg != null && end && (
        <Html position={lift(a3)} center zIndexRange={[10, 10]}>
          <div ref={cornerRef} data-trace-corner>
            <div ref={stopCorner as (el: HTMLDivElement | null) => void} className={styles.chip}>
              {typing ? (
                <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit() }}>
                  <input className={`${styles.input} ${bad ? styles.bad : ''}`} autoFocus inputMode="decimal"
                    placeholder={`${snap.cornerDeg}°`}
                    onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(null); setDraft('') } }}
                    onBlur={(e) => { if (!(e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null))) { setTyping(null); setDraft('') } }}
                    aria-label="Corner angle in degrees" />
                  <button type="submit" className={styles.go}>Set</button>
                </form>
              ) : (
                <Tap className={`${styles.length} ${styles.minor}`}
                  onTap={() => setTyping({ toward: end })}
                  aria-label={`Corner ${snap.cornerDeg} degrees. Tap to type an exact angle`}>
                  {snap.cornerDeg}°
                </Tap>
              )}
            </div>
          </div>
        </Html>
      )}

      {/* Undo and Done, beside the corner — never out at the edge of the screen. */}
      {showControls && (
        <Html position={lift(a3)} center zIndexRange={[10, 10]}>
          <div ref={ctrlRef} data-trace-ctx>
            <div ref={stopCtrl as (el: HTMLDivElement | null) => void} className={styles.ctx} role="group" aria-label="Wall run">
              {/* No Undo here: the Undo at the top does it, and one is enough. */}
              <Tap className={styles.ctxBtn} onTap={onDone} aria-label="Finish this run of walls"><span>Done</span></Tap>
            </div>
          </div>
        </Html>
      )}
    </>
  )
}

function el(node: HTMLElement, x: number, y: number) {
  const t = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  if (node.style.transform !== t) node.style.transform = t
}

/**
 * THE LOUPE. While a finger is down the point is drawn again above it, two and
 * a half times bigger, with the print under it and the walls on it — the finger
 * covers the point, the loupe does not. A mouse has its own crosshair and gets
 * none.
 */
export function Loupe({
  at, pixel, rasterUrl, pxPerPrintPx, segments, snapped,
}: {
  at: P3
  /** The point, in print pixels. */
  pixel: PX
  rasterUrl: string | null
  /** Screen pixels per print pixel here. */
  pxPerPrintPx: number
  /** Walls to draw in the loupe, print pixels. The last one is the wall being drawn. */
  segments: Array<[number, number, number, number]>
  snapped: boolean
}) {
  const SIZE = 112
  const ZOOM = 2.5
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null)
  const img = loaded && loaded.url === rasterUrl ? loaded.img : null
  useEffect(() => {
    if (!rasterUrl) return
    const im = new Image()
    im.onload = () => setLoaded({ url: rasterUrl, img: im })
    im.src = rasterUrl
  }, [rasterUrl])
  useEffect(() => {
    const c = canvasRef.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== SIZE * dpr) { c.width = SIZE * dpr; c.height = SIZE * dpr }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, SIZE, SIZE)
    g.save()
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2); g.clip()
    g.fillStyle = '#e8edf3'
    g.fillRect(0, 0, SIZE, SIZE)
    const s = Math.max(0.05, pxPerPrintPx * ZOOM)        // loupe px per print px
    const X = (x: number) => SIZE / 2 + (x - pixel[0]) * s
    const Y = (y: number) => SIZE / 2 + (y - pixel[1]) * s
    if (img) g.drawImage(img, X(0), Y(0), img.naturalWidth * s, img.naturalHeight * s)
    segments.forEach(([x1, y1, x2, y2], i) => {
      const live = i === segments.length - 1
      g.strokeStyle = live ? '#0ea5e9' : '#1e3a8a'
      g.lineWidth = live ? 3 : 2.5
      g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke()
    })
    // The crosshair: the exact point.
    g.strokeStyle = snapped ? '#16a34a' : '#dc2626'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(SIZE / 2 - 14, SIZE / 2); g.lineTo(SIZE / 2 - 4, SIZE / 2)
    g.moveTo(SIZE / 2 + 4, SIZE / 2); g.lineTo(SIZE / 2 + 14, SIZE / 2)
    g.moveTo(SIZE / 2, SIZE / 2 - 14); g.lineTo(SIZE / 2, SIZE / 2 - 4)
    g.moveTo(SIZE / 2, SIZE / 2 + 4); g.lineTo(SIZE / 2, SIZE / 2 + 14)
    g.stroke()
    g.restore()
    g.strokeStyle = 'rgba(255,255,255,0.9)'
    g.lineWidth = 2
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2); g.stroke()
    g.strokeStyle = 'rgba(0,0,0,0.6)'
    g.lineWidth = 1
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 0.5, 0, Math.PI * 2); g.stroke()
  }, [img, pixel, pxPerPrintPx, segments, snapped])
  // ON SCREEN, ALWAYS. Above the finger by default; near the top edge there is
  // no room there, so it sits beside the finger instead (the side with room),
  // and it never hangs off the left or right edge either.
  const [shift, setShift] = useState<[number, number]>([0, -DRAW.LOUPE_LIFT_PX])
  useLayoutEffect(() => {
    const host = canvasRef.current?.parentElement
    if (!host) return
    const r = host.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const half = SIZE / 2, pad = 8, lift = DRAW.LOUPE_LIFT_PX
    let dx = 0, dy = -lift
    if (cy - lift - half < pad) {
      dy = 0
      dx = cx + lift + half <= window.innerWidth - pad ? lift : -lift
    }
    dx = Math.max(pad + half - cx, Math.min(window.innerWidth - pad - half - cx, dx))
    dy = Math.max(pad + half - cy, Math.min(window.innerHeight - pad - half - cy, dy))
    setShift((s0) => (s0[0] === dx && s0[1] === dy ? s0 : [dx, dy]))
  }, [pixel, at])
  return (
    <Html position={at} center zIndexRange={[10, 10]} style={{ pointerEvents: 'none' }}>
      <canvas ref={canvasRef} data-loupe
        style={{ width: SIZE, height: SIZE, transform: `translate(${shift[0]}px, ${shift[1]}px)`, pointerEvents: 'none', display: 'block' }} />
    </Html>
  )
}

/**
 * BEND A WALL: a ring on its middle. Drag it off the wall and the wall bows
 * through your finger, its two ends held where they are; let go and it goes in
 * as an arc. The radius reads on the arc as plain text — tap it to type one.
 */
export function BendHandle({
  a, b, bulge, toWorld, worldPerScreenPx, toPixel, color, radiusLabel, onBend, onTypedRadius,
}: {
  a: PX
  b: PX
  /** The bulge it already has (print px, left of a→b positive). */
  bulge: number
  toWorld: (px: PX) => P3
  worldPerScreenPx: number
  /** The print pixel under a pointer event. */
  toPixel: (e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => PX | null
  color: string
  radiusLabel: (bulge: number) => string | null
  onBend: (bulge: number) => void
  onTypedRadius: (text: string) => boolean
}) {
  const [live, setLive] = useState<number | null>(null)
  const s = live ?? bulge
  const c = Math.hypot(b[0] - a[0], b[1] - a[1])
  const pts = (() => {
    if (Math.abs(s) < 1e-6 || c < 1e-6) return [a, b]
    const out: PX[] = []
    for (let i = 0; i <= 32; i++) {
      // A parabola is close enough to draw; the commit lays the true arc.
      const t = i / 32
      const nx = -(b[1] - a[1]) / c, ny = (b[0] - a[0]) / c
      const h = 4 * s * t * (1 - t)
      out.push([a[0] + (b[0] - a[0]) * t + nx * h, a[1] + (b[1] - a[1]) * t + ny * h])
    }
    return out
  })()
  const nx = c > 0 ? -(b[1] - a[1]) / c : 0, ny = c > 0 ? (b[0] - a[0]) / c : 0
  const apex: PX = [(a[0] + b[0]) / 2 + nx * s, (a[1] + b[1]) / 2 + ny * s]
  const apex3 = toWorld(apex)
  const k = worldPerScreenPx
  const label = radiusLabel(s)
  const stopRef = useStopRef()
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)
  const bulgeAt = (p: PX) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    return Math.max(-c / 2, Math.min(c / 2, (p[0] - mx) * nx + (p[1] - my) * ny))
  }
  return (
    <>
      {live != null && <Line points={pts.map((p) => toWorld(p))} color={color} lineWidth={4} dashed dashSize={8 * k} gapSize={5 * k} />}
      <Line points={ring([apex3[0], apex3[1] + 0.04, apex3[2]], 9 * k, 20)} color="#fbbf24" lineWidth={3} />
      <mesh position={[apex3[0], apex3[1] + 0.05, apex3[2]]} rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.target as unknown as Element).setPointerCapture?.(e.pointerId)
          setLive(s)
        }}
        onPointerMove={(e) => {
          if (live == null) return
          e.stopPropagation()
          const p = toPixel(e)
          if (p) setLive(bulgeAt(p))
        }}
        onPointerUp={(e) => {
          if (live == null) return
          e.stopPropagation()
          ;(e.target as unknown as Element).releasePointerCapture?.(e.pointerId)
          const v = live
          setLive(null)
          // A press that never left the wall is a tap, not a bend.
          if (Math.abs(v - bulge) > c * 0.01) onBend(Math.abs(v) < c * 0.02 ? 0 : v)
        }}>
        <circleGeometry args={[24 * k, 20]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {label && (
        <Html position={[apex3[0], apex3[1] + 0.05, apex3[2]]} center zIndexRange={[10, 10]}>
          <div style={{ transform: `translate(0px, ${s >= 0 ? 40 : -40}px)` }}>
            <div ref={stopRef as (el: HTMLDivElement | null) => void} className={styles.chip}>
              {typing ? (
                <form className={styles.form} onSubmit={(e) => {
                  e.preventDefault()
                  if (onTypedRadius(draft)) { setTyping(false); setDraft(''); setBad(false) } else setBad(true)
                }}>
                  <input className={`${styles.input} ${bad ? styles.bad : ''}`} autoFocus inputMode="decimal"
                    placeholder={label} aria-label="Arc radius"
                    onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(false); setDraft('') } }} />
                  <button type="submit" className={styles.go}>Set</button>
                </form>
              ) : (
                <Tap className={`${styles.length} ${styles.minor}`} onTap={() => setTyping(true)}
                  aria-label={`Arc radius ${label}. Tap to type a radius`}>{label}</Tap>
              )}
            </div>
          </div>
        </Html>
      )}
    </>
  )
}

/**
 * GRAPH PAPER, ENDLESS — the Draw it sheet's dark squared paper. Looking straight down to draw, the workspace is a sheet
 * of squared paper with no edge: a plan you imported lies on it, and with no
 * plan it is the paper. Draw one building or fifty, anywhere on it.
 *
 * Squares are a foot (bold every 10 ft), or 100 mm (bold every metre) in metric.
 * It sits just under the print, so the print reads on top and the squares show
 * through where the print is light. It catches no taps.
 */
export function GraphPaper({ y, metric }: { y: number; metric: boolean }) {
  const cell = metric ? 0.1 : 0.3048
  const section = metric ? 1 : 3.048
  return (
    <group position={[0, y, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]} raycast={() => null} renderOrder={-2}>
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial color="#1e2833" depthWrite={false} />
      </mesh>
      <Grid
        position={[0, -0.004, 0]}
        infiniteGrid
        cellSize={cell}
        cellThickness={0.8}
        cellColor="#2b3b5c"
        sectionSize={section}
        sectionThickness={1.2}
        sectionColor="#3d5480"
        fadeDistance={600}
        fadeStrength={0.6}
        raycast={() => null}
        renderOrder={-1}
      />
    </group>
  )
}

/**
 * EVERY WALL'S LENGTH, the way the Draw it sheet showed them: plain text beside
 * each wall, off the line, while you draw. Curve facets and stubs are left
 * bare, or a circle would wear a ring of numbers. Taps go through to the paper.
 */
export function WallLengths({ walls, toWorld, label, offsetPx, minPx }: {
  walls: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number; bend?: boolean }>
  toWorld: (px: PX) => P3
  label: (lenPx: number) => string
  /** How far off the wall, in sheet pixels. */
  offsetPx: number
  /** Walls shorter than this, in sheet pixels, get no number. */
  minPx: number
}) {
  const shown = walls.filter((w) => !w.bend && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= minPx).slice(0, 300)
  return (
    <>
      {shown.map((w, i) => {
        const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
        const nx = -(w.y2 - w.y1) / L, ny = (w.x2 - w.x1) / L
        const m = toWorld([(w.x1 + w.x2) / 2 + nx * offsetPx, (w.y1 + w.y2) / 2 + ny * offsetPx])
        return (
          <Html key={`${i}:${w.x1},${w.y1}`} position={[m[0], m[1] + 0.05, m[2]]} center zIndexRange={[5, 5]}
            style={{ pointerEvents: 'none' }}>
            <span style={{
              color: '#e2e8f0', textShadow: 'var(--ink-on-model)', fontSize: 12, fontWeight: 600,
              whiteSpace: 'nowrap', userSelect: 'none',
            }}>{label(L)}</span>
          </Html>
        )
      })}
    </>
  )
}

/**
 * A WALL PICKED WITH ✎ EDIT. Lit up, a dot on each end (drag one: the wall
 * swings onto an angle about its other end), a + on its middle (drag it, or
 * anywhere along the wall: the wall is cut there and the new corner comes out
 * with your finger, so part of it goes on an angle). Beside it, its corner
 * angle — tap to type one — and Delete. While a dot is dragged the chip steps
 * aside and the length and angle read at the finger instead.
 */
export function WallEditAids({
  toWorld, worldPerScreenPx, a, b, angleDeg, onTypedAngle, onDelete, live,
}: {
  toWorld: (px: PX) => P3
  worldPerScreenPx: number
  a: PX
  b: PX
  /** The corner angle at the wall's held end (90 = square), or its angle off the plan's level. */
  angleDeg: number
  onTypedAngle: (text: string) => boolean
  onDelete: () => void
  /** While dragging: where the moving corner is and what it reads. */
  live: { at: PX; text: string } | null
}) {
  const k = worldPerScreenPx
  const lift = (p: P3, dy = 0.05): P3 => [p[0], p[1] + dy, p[2]]
  const A = lift(toWorld(a)), B = lift(toWorld(b))
  const mid: PX = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const M = lift(toWorld(mid))
  const chip = useChipClear(40)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)
  const plus = 7 * k
  const dx = B[0] - A[0], dz = B[2] - A[2]
  const L = Math.hypot(dx, dz) || 1
  const ux = dx / L, uz = dz / L
  const submit = () => {
    if (onTypedAngle(draft)) { setTyping(false); setDraft(''); setBad(false) } else setBad(true)
  }
  return (
    <>
      <Line points={[A, B]} color="#facc15" lineWidth={6} />
      {[A, B].map((p, i) => (
        <Line key={i} points={ring(p, 9 * k, 20)} color="#facc15" lineWidth={4} />
      ))}
      {/* The + on the middle: cut here and angle part of the wall. */}
      {!live && (
        <>
          <Line points={ring(M, 9 * k, 20)} color="#facc15" lineWidth={2} />
          <Line points={[[M[0] - ux * plus, M[1], M[2] - uz * plus], [M[0] + ux * plus, M[1], M[2] + uz * plus]]} color="#facc15" lineWidth={3} />
          <Line points={[[M[0] + uz * plus, M[1], M[2] - ux * plus], [M[0] - uz * plus, M[1], M[2] + ux * plus]]} color="#facc15" lineWidth={3} />
        </>
      )}
      {live ? (
        <Html position={lift(toWorld(live.at))} center zIndexRange={[10, 10]} style={{ pointerEvents: 'none' }}>
          <div className={styles.length} style={{ transform: 'translate(0, -44px)', whiteSpace: 'nowrap' }}>{live.text}</div>
        </Html>
      ) : (
        <Html position={M} center zIndexRange={[10, 10]}>
          <div ref={chip} className={styles.ctx} role="group" aria-label="Picked wall" style={CHIP_ROW}>
            {typing ? (
              <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit() }}>
                <input className={`${styles.input} ${bad ? styles.bad : ''}`} autoFocus inputMode="decimal"
                  placeholder={`${angleDeg}°`}
                  onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(false); setDraft('') } }}
                  aria-label="Wall angle in degrees" />
                <button type="submit" className={styles.go}>Set</button>
              </form>
            ) : (
              <Tap className={styles.ctxBtn} onTap={() => setTyping(true)} aria-label={`Angle ${angleDeg} degrees. Tap to type one`}>
                <span>∠ {angleDeg}°</span>
              </Tap>
            )}
            <Tap className={styles.ctxBtn} onTap={onDelete} aria-label="Delete this wall"><span>Delete</span></Tap>
          </div>
        </Html>
      )}
    </>
  )
}

/**
 * ▭ ROOMS — the room picked, filled pale blue, with its chip: the ceiling
 * height (tap, type), Bulkhead (then tap the walls it runs along), Reset.
 * Every room already given a height or a bulkhead carries a small label.
 */
export function RoomAids({
  toWorld, picked, labels, bulkLines, heightText, bulkMode, onTypedHeight, onBulkMode, onReset,
}: {
  toWorld: (px: PX) => P3
  /** The picked room's floor, as print-px rectangles, and where its chip goes. */
  picked: { rects: Array<[number, number, number, number]>; at: PX } | null
  /** Rooms with their own settings, labelled where they were tapped. */
  labels: Array<{ at: PX; text: string }>
  /** Bulkheads, as the line along the wall face. */
  bulkLines: Array<[PX, PX]>
  heightText: string
  bulkMode: boolean
  onTypedHeight: (text: string) => boolean
  onBulkMode: (on: boolean) => void
  onReset: (() => void) | null
}) {
  const chip = useChipClear()
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)
  const lift = (p: P3, dy = 0.04): P3 => [p[0], p[1] + dy, p[2]]
  const rects = picked?.rects
  const fill = useMemo(() => {
    if (!rects) return null
    const pos: number[] = []
    const at = (x: number, y: number) => { const p = toWorld([x, y]); return [p[0], p[1] + 0.02, p[2]] }
    for (const [x1, y1, x2, y2] of rects) {
      const a = at(x1, y1), b = at(x2, y1), c = at(x2, y2), d = at(x1, y2)
      pos.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [rects, toWorld])
  useEffect(() => () => fill?.dispose(), [fill])
  const submit = () => {
    if (onTypedHeight(draft)) { setTyping(false); setDraft(''); setBad(false) } else setBad(true)
  }
  return (
    <>
      {fill && (
        <mesh geometry={fill} renderOrder={5}>
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {bulkLines.map(([a, b], i) => (
        <Line key={i} points={[lift(toWorld(a)), lift(toWorld(b))]} color="#f97316" lineWidth={7} />
      ))}
      {labels.map((l, i) => (
        <Html key={i} position={lift(toWorld(l.at))} center zIndexRange={[9, 9]} style={{ pointerEvents: 'none' }}>
          <div className={styles.length} style={{ whiteSpace: 'nowrap', opacity: 0.85 }}>{l.text}</div>
        </Html>
      ))}
      {picked && (
        <Html position={lift(toWorld(picked.at))} center zIndexRange={[10, 10]}>
          <div ref={chip} className={styles.ctx} role="group" aria-label="Picked room" style={CHIP_ROW}>
            {bulkMode ? (
              <>
                <span style={{ padding: '0 4px' }}>Tap the walls it runs along</span>
                <Tap className={styles.ctxBtn} onTap={() => onBulkMode(false)} aria-label="Done adding bulkheads"><span>Done</span></Tap>
              </>
            ) : typing ? (
              <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit() }}>
                <input className={`${styles.input} ${bad ? styles.bad : ''}`} autoFocus inputMode="decimal"
                  placeholder={heightText}
                  onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(false); setDraft('') } }}
                  aria-label="Ceiling height of this room" />
                <button type="submit" className={styles.go}>Set</button>
              </form>
            ) : (
              <>
                <Tap className={styles.ctxBtn} onTap={() => setTyping(true)} aria-label={`Ceiling ${heightText}. Tap to type a height`}>
                  <span>Ceiling ↕ {heightText}</span>
                </Tap>
                <Tap className={styles.ctxBtn} onTap={() => onBulkMode(true)} aria-label="Add a bulkhead along a wall"><span>+ Bulkhead</span></Tap>
                {onReset && <Tap className={styles.ctxBtn} onTap={onReset} aria-label="Back to the building height, no bulkheads"><span>Reset</span></Tap>}
              </>
            )}
          </div>
        </Html>
      )}
    </>
  )
}

/**
 * ▱ BALCONY — every balcony on this floor outlined (a stacked one from below
 * dashed), the first tap of a new one marked, and the picked one's chip:
 * depth (tap, type), Concrete/Wood, Glass/Picket, Every floor above, Delete.
 */
export function BalconyAids({
  toWorld, outlines, first, picked, depthText, kind, guard, stack, onTypedDepth, onKind, onGuard, onStack, onDelete,
}: {
  toWorld: (px: PX) => P3
  outlines: Array<{ corners: [PX, PX, PX, PX]; picked: boolean; ghost: boolean }>
  first: PX | null
  picked: PX | null
  depthText: string
  kind: 'concrete' | 'wood'
  guard: 'glass' | 'picket'
  stack: boolean
  onTypedDepth: (text: string) => boolean
  onKind: () => void
  onGuard: () => void
  onStack: () => void
  onDelete: () => void
}) {
  const chip = useChipClear()
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)
  const lift = (p: P3, dy = 0.05): P3 => [p[0], p[1] + dy, p[2]]
  const submit = () => {
    if (onTypedDepth(draft)) { setTyping(false); setDraft(''); setBad(false) } else setBad(true)
  }
  return (
    <>
      {outlines.map((o, i) => {
        const pts = [...o.corners, o.corners[0]].map((c) => lift(toWorld(c)))
        return o.ghost
          ? <Line key={i} points={pts} color="#a78bfa" lineWidth={2} dashed dashSize={0.2} gapSize={0.12} />
          : <Line key={i} points={pts} color={o.picked ? '#facc15' : '#a78bfa'} lineWidth={o.picked ? 5 : 3} />
      })}
      {first && <Line points={ring(lift(toWorld(first)), 0.25, 20)} color="#a78bfa" lineWidth={4} />}
      {picked && (
        <Html position={lift(toWorld(picked))} center zIndexRange={[10, 10]}>
          <div ref={chip} className={styles.ctx} role="group" aria-label="Picked balcony" style={CHIP_ROW}>
            {typing ? (
              <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit() }}>
                <input className={`${styles.input} ${bad ? styles.bad : ''}`} autoFocus inputMode="decimal"
                  placeholder={depthText}
                  onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(false); setDraft('') } }}
                  aria-label="How far the balcony comes out" />
                <button type="submit" className={styles.go}>Set</button>
              </form>
            ) : (
              <>
                <Tap className={styles.ctxBtn} onTap={() => setTyping(true)} aria-label={`Depth ${depthText}. Tap to type one`}><span>Out ↔ {depthText}</span></Tap>
                <Tap className={styles.ctxBtn} onTap={onKind} aria-label="Concrete slab or wood deck"><span>{kind === 'concrete' ? 'Concrete' : 'Wood'}</span></Tap>
                <Tap className={styles.ctxBtn} onTap={onGuard} aria-label="Glass or picket guard"><span>{guard === 'glass' ? 'Glass guard' : 'Picket guard'}</span></Tap>
                <Tap className={styles.ctxBtn} onTap={onStack} aria-label="Same balcony on every floor above" aria-pressed={stack}><span>{stack ? '✓ Every floor above' : 'Every floor above'}</span></Tap>
                <Tap className={styles.ctxBtn} onTap={onDelete} aria-label="Delete this balcony"><span>Delete</span></Tap>
              </>
            )}
          </div>
        </Html>
      )}
    </>
  )
}
