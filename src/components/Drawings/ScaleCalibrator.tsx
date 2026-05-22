import { useState, useRef, useCallback, useEffect } from 'react'
import styles from './ScaleCalibrator.module.css'

interface Point { x: number; y: number }

interface Props {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  existingMmPerPx: number | null
  onCalibrate: (mmPerPx: number, notation: string) => void
  onClose: () => void
}

type Phase = 'idle' | 'point-a' | 'point-b' | 'enter-distance'

export default function ScaleCalibrator({
  imageUrl,
  imageWidth,
  imageHeight,
  existingMmPerPx,
  onCalibrate,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ptA, setPtA] = useState<Point | null>(null)
  const [ptB, setPtB] = useState<Point | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [distInput, setDistInput] = useState('')
  const [unit, setUnit] = useState<'mm' | 'm' | 'ft' | 'in'>('mm')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const touchRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number; cx: number; cy: number; zoom: number; px: number; py: number } | null>(null)
  const panRef = useRef(pan)
  panRef.current = pan
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  function toMm(value: number): number {
    switch (unit) {
      case 'm': return value * 1000
      case 'ft': return value * 304.8
      case 'in': return value * 25.4
      default: return value
    }
  }

  const clientToImagePx = useCallback((clientX: number, clientY: number): Point | null => {
    const el = imgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const scaleX = imageWidth / rect.width
    const scaleY = imageHeight / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }, [imageWidth, imageHeight])

  // ─── Pointer handlers on SVG overlay ──────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return
    const p = clientToImagePx(e.clientX, e.clientY)
    if (!p) return

    if (phase === 'point-a') {
      setPtA(p)
      setPtB(null)
      setPhase('point-b')
      isDragging.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    } else if (phase === 'point-b' && !isDragging.current) {
      // Second click (pointer was released between clicks)
      setPtB(p)
      setPhase('enter-distance')
    }
  }, [phase, clientToImagePx])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (phase !== 'point-a' && phase !== 'point-b') return
    const p = clientToImagePx(e.clientX, e.clientY)
    if (p) setCursor(p)
  }, [phase, clientToImagePx])

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (phase === 'point-b' && isDragging.current) {
      const p = clientToImagePx(e.clientX, e.clientY)
      if (p && ptA) {
        const dx = p.x - ptA.x
        const dy = p.y - ptA.y
        const moved = Math.hypot(dx, dy)
        if (moved >= 8) {
          setPtB(p)
          setPhase('enter-distance')
        }
      }
      isDragging.current = false
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
  }, [phase, ptA, clientToImagePx])

  const onPointerCancel = useCallback(() => {
    isDragging.current = false
  }, [])

  function pixelDistance(): number {
    if (!ptA || !ptB) return 0
    return Math.sqrt((ptB.x - ptA.x) ** 2 + (ptB.y - ptA.y) ** 2)
  }

  function livePixelDistance(): number {
    if (!ptA || !cursor || phase !== 'point-b') return 0
    return Math.sqrt((cursor.x - ptA.x) ** 2 + (cursor.y - ptA.y) ** 2)
  }

  function confirm() {
    const realDist = parseFloat(distInput)
    if (!isFinite(realDist) || realDist <= 0) return
    const realMm = toMm(realDist)
    const pxDist = pixelDistance()
    if (pxDist < 1) return
    const mmPerPx = realMm / pxDist
    const notationRatio = Math.round((25.4 / 72) * (1 / mmPerPx))
    const notation = notationRatio > 0 ? `1:${notationRatio}` : `custom`
    onCalibrate(mmPerPx, notation)
  }

  // Touch pinch-to-zoom on the image wrap
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        touchRef.current.set(t.identifier, { x: t.clientX, y: t.clientY })
      }
      if (touchRef.current.size >= 2) {
        e.preventDefault()
        const pts = Array.from(touchRef.current.values())
        const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        pinchRef.current = { dist, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, zoom: zoomRef.current, px: panRef.current.x, py: panRef.current.y }
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        touchRef.current.set(t.identifier, { x: t.clientX, y: t.clientY })
      }
      if (touchRef.current.size >= 2) {
        e.preventDefault()
        const p = pinchRef.current
        if (!p) return
        const pts = Array.from(touchRef.current.values())
        const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const ratio = dist / p.dist
        const mx = (pts[0].x + pts[1].x) / 2
        const my = (pts[0].y + pts[1].y) / 2
        setZoom(() => Math.max(0.25, Math.min(6, p.zoom * ratio)))
        setPan(() => ({ x: p.px + (mx - p.cx), y: p.py + (my - p.cy) }))
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        touchRef.current.delete(e.changedTouches[i].identifier)
      }
      if (touchRef.current.size < 2) pinchRef.current = null
    }
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const instructions: Record<Phase, string> = {
    idle: 'Click "Start Calibration" then pick two points on the drawing with a known real-world distance',
    'point-a': 'Click or drag on the drawing to set the FIRST point of your measurement',
    'point-b': 'Click to set the SECOND point, or drag from point A to position it',
    'enter-distance': 'Enter the real-world distance between the two points you picked',
  }

  const arrowEnd: Point | null = ptB ?? (phase === 'point-b' ? cursor : null)
  const livePx = livePixelDistance()
  const liveRealMm = existingMmPerPx && livePx > 0 ? livePx * existingMmPerPx : null

  const showOverlay = phase === 'point-a' || phase === 'point-b' || phase === 'enter-distance'
  const dotR = Math.max(8, Math.min(imageWidth, imageHeight) / 120)
  const strokeW = Math.max(4, Math.min(imageWidth, imageHeight) / 250)

  const stepNum = phase === 'idle' ? 0 : phase === 'point-a' ? 1 : phase === 'point-b' ? 2 : 3

  const isActivePhase = phase === 'point-a' || phase === 'point-b'

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>📏 Scale Calibration</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {existingMmPerPx !== null && (
          <div className={styles.currentScale}>
            Current: <strong>{existingMmPerPx.toFixed(4)} mm/px</strong> —{' '}
            approx 1:{Math.round((25.4 / 72) / existingMmPerPx)}
          </div>
        )}

        {/* Step indicator */}
        <div className={styles.steps}>
          {['Start', 'Point A', 'Point B', 'Distance'].map((label, i) => (
            <div key={i} className={`${styles.step} ${i === stepNum ? styles.stepActive : ''} ${i < stepNum ? styles.stepDone : ''}`}>
              <span className={styles.stepDot}>{i < stepNum ? '✓' : i + 1}</span>
              <span className={styles.stepLabel}>{label}</span>
            </div>
          ))}
        </div>

        <p className={styles.instruction}>{instructions[phase]}</p>

        <div className={styles.actions}>
          {phase === 'idle' && (
            <button className={styles.startBtn} onClick={() => setPhase('point-a')}>
              Start Calibration
            </button>
          )}

          {(phase === 'point-a' || phase === 'point-b') && (
            <button className={styles.cancelBtn} onClick={() => { setPhase('idle'); setPtA(null); setPtB(null); setCursor(null); isDragging.current = false }}>
              Cancel
            </button>
          )}

          {phase === 'enter-distance' && (
            <>
              <div className={styles.distRow}>
                <input
                  className={styles.distInput}
                  type="number"
                  min="0.001"
                  step="any"
                  placeholder="e.g. 3000"
                  value={distInput}
                  onChange={(e) => setDistInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && confirm()}
                />
                <select
                  className={styles.unitSelect}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as typeof unit)}
                >
                  <option value="mm">mm</option>
                  <option value="m">m</option>
                  <option value="ft">ft</option>
                  <option value="in">in</option>
                </select>
                <button className={styles.confirmBtn} onClick={confirm}>
                  Apply
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button className={styles.cancelBtn} onClick={() => { setPhase('idle'); setPtA(null); setPtB(null); setCursor(null); isDragging.current = false }}>
                  Redo from start
                </button>
                <button className={styles.cancelBtn} onClick={() => { setPhase('point-b'); setPtB(null) }}>
                  ← Redo point B
                </button>
              </div>
            </>
          )}
        </div>

        {/* Zoom slider */}
        <div className={styles.zoomRow}>
          <button onClick={() => setZoom((s) => Math.max(0.25, s - 0.25))}>−</button>
          <input
            type="range"
            min={25} max={600}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(parseInt(e.target.value) / 100)}
            style={{ flex: 1, accentColor: '#38bdf8' }}
          />
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>⟲</button>
        </div>

        <div className={styles.imageWrap} ref={wrapRef}>
          <div
            className={styles.imageContainer}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'top left' }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Drawing preview"
              className={styles.image}
              draggable={false}
            />
            {showOverlay && (
              <svg
                ref={svgRef}
                data-testid="calibration-overlay"
                className={`${styles.svg} ${isActivePhase ? styles.svgActive : ''}`}
                viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                preserveAspectRatio="none"
                onPointerDown={isActivePhase ? onPointerDown : undefined}
                onPointerMove={isActivePhase ? onPointerMove : undefined}
                onPointerUp={isActivePhase ? onPointerUp : undefined}
                onPointerCancel={isActivePhase ? onPointerCancel : undefined}
              >
                <defs>
                  <marker
                    id="cal-arrow-end"
                    viewBox="0 0 14 14"
                    refX="12" refY="7"
                    markerWidth="12" markerHeight="12"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 14 7 L 0 14 z" fill="#f59e0b" stroke="#fbbf24" strokeWidth={1} />
                  </marker>
                  <marker
                    id="cal-arrow-start"
                    viewBox="0 0 14 14"
                    refX="2" refY="7"
                    markerWidth="12" markerHeight="12"
                    orient="auto-start-reverse"
                  >
                    <path d="M 14 0 L 0 7 L 14 14 z" fill="#f59e0b" stroke="#fbbf24" strokeWidth={1} />
                  </marker>
                </defs>

                {phase === 'point-a' && cursor && (
                  <circle cx={cursor.x} cy={cursor.y} r={dotR} fill="#38bdf8" fillOpacity={0.7} stroke="#fff" strokeWidth={2.5} style={{ filter: 'drop-shadow(0 0 4px rgba(56,189,248,0.6))' }} />
                )}

                {ptA && arrowEnd && (
                  <g data-testid="calibration-arrow">
                    <line x1={ptA.x} y1={ptA.y} x2={arrowEnd.x} y2={arrowEnd.y} stroke="#f59e0b" strokeWidth={strokeW} strokeDasharray={ptB ? '8 4' : undefined} strokeLinecap="round" markerStart="url(#cal-arrow-start)" markerEnd="url(#cal-arrow-end)" style={{ filter: 'drop-shadow(0 0 3px rgba(245,158,11,0.5))' }} />
                  </g>
                )}

                {ptA && (
                  <g>
                    <circle cx={ptA.x} cy={ptA.y} r={dotR + 4} fill="none" stroke="#38bdf8" strokeWidth={3} opacity={0.35} />
                    <circle cx={ptA.x} cy={ptA.y} r={dotR} fill="#38bdf8" stroke="#fff" strokeWidth={2.5} />
                    <text x={ptA.x + dotR + 6} y={ptA.y + 5} fill="#38bdf8" fontSize={14} fontWeight={700}>A</text>
                  </g>
                )}
                {ptB && (
                  <g>
                    <circle cx={ptB.x} cy={ptB.y} r={dotR + 4} fill="none" stroke="#f59e0b" strokeWidth={3} opacity={0.35} />
                    <circle cx={ptB.x} cy={ptB.y} r={dotR} fill="#f59e0b" stroke="#fff" strokeWidth={2.5} />
                    <text x={ptB.x + dotR + 6} y={ptB.y + 5} fill="#f59e0b" fontSize={14} fontWeight={700}>B</text>
                  </g>
                )}

                {ptA && arrowEnd && phase === 'point-b' && livePx > 0 && (
                  <g pointerEvents="none">
                    <rect x={(ptA.x + arrowEnd.x) / 2 - 60} y={(ptA.y + arrowEnd.y) / 2 - 24} width={120} height={22} rx={4} fill="rgba(15, 23, 42, 0.85)" stroke="#f59e0b" strokeWidth={1} />
                    <text x={(ptA.x + arrowEnd.x) / 2} y={(ptA.y + arrowEnd.y) / 2 - 9} fill="#fbbf24" fontSize={Math.max(11, Math.min(imageWidth, imageHeight) / 80)} fontFamily="ui-monospace, monospace" textAnchor="middle" dominantBaseline="middle">
                      {liveRealMm !== null ? `${livePx.toFixed(0)} px ≈ ${(liveRealMm / 1000).toFixed(2)} m` : `${livePx.toFixed(0)} px`}
                    </text>
                  </g>
                )}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
