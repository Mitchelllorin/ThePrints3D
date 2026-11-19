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
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { DRAW, type DrawSnap } from '../../services/drawSystem'
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
  onTypedAngle, onUndo, onDone, canUndo, showControls,
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
  onUndo: () => void
  onDone: () => void
  canUndo: boolean
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
        <Line points={ring(lift(toWorld(runStart), 0.035), DRAW.REACH_PX * DRAW.CLOSE_REACH * k)}
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
                    placeholder={`${snap.cornerDeg}°`} value={draft}
                    onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(null); setDraft('') } }}
                    onBlur={(e) => { if (!(e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null))) { setTyping(null); setDraft('') } }}
                    aria-label="Corner angle in degrees" />
                  <button type="submit" className={styles.go}>Set</button>
                </form>
              ) : (
                <button type="button" className={`${styles.length} ${styles.minor}`}
                  onClick={() => setTyping({ toward: end })}
                  aria-label={`Corner ${snap.cornerDeg} degrees. Tap to type an exact angle`}>
                  {snap.cornerDeg}°
                </button>
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
              {canUndo && (
                <button type="button" className={styles.ctxBtn} onClick={onUndo} aria-label="Undo the last wall"><span>Undo</span></button>
              )}
              <button type="button" className={styles.ctxBtn} onClick={onDone} aria-label="Finish this run of walls"><span>Done</span></button>
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
  return (
    <Html position={at} center zIndexRange={[10, 10]} style={{ pointerEvents: 'none' }}>
      <canvas ref={canvasRef} data-loupe
        style={{ width: SIZE, height: SIZE, transform: `translateY(${-DRAW.LOUPE_LIFT_PX}px)`, pointerEvents: 'none', display: 'block' }} />
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
                    placeholder={label} value={draft} aria-label="Arc radius"
                    onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(false); setDraft('') } }} />
                  <button type="submit" className={styles.go}>Set</button>
                </form>
              ) : (
                <button type="button" className={`${styles.length} ${styles.minor}`} onClick={() => setTyping(true)}
                  aria-label={`Arc radius ${label}. Tap to type a radius`}>{label}</button>
              )}
            </div>
          </div>
        </Html>
      )}
    </>
  )
}
