import { useState, useRef, useCallback } from 'react'
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
const MIN_MANUAL_MM_PER_PX = 0.01
const MAX_MANUAL_MM_PER_PX = 200

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
  const imgRef = useRef<HTMLImageElement>(null)

  // Convert unit to mm
  function toMm(value: number): number {
    switch (unit) {
      case 'm': return value * 1000
      case 'ft': return value * 304.8
      case 'in': return value * 25.4
      default: return value
    }
  }

  // Map a DOM event to image pixel coordinates.
  const eventToImagePx = useCallback((clientX: number, clientY: number): Point | null => {
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

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (phase !== 'point-a' && phase !== 'point-b') return
      const p = eventToImagePx(e.clientX, e.clientY)
      if (!p) return
      if (phase === 'point-a') {
        setPtA(p)
        setPtB(null)
        setPhase('point-b')
      } else {
        setPtB(p)
        setPhase('enter-distance')
      }
    },
    [phase, eventToImagePx]
  )

  // Rubber-band: track cursor while in point-a / point-b so the user sees a
  // live stretchy arrow growing from their first click toward the cursor.
  const handleImageMove = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (phase !== 'point-a' && phase !== 'point-b') return
      const p = eventToImagePx(e.clientX, e.clientY)
      if (p) setCursor(p)
    },
    [phase, eventToImagePx]
  )

  const handleImageLeave = useCallback(() => {
    setCursor(null)
  }, [])

  function pixelDistance(): number {
    if (!ptA || !ptB) return 0
    return Math.sqrt((ptB.x - ptA.x) ** 2 + (ptB.y - ptA.y) ** 2)
  }

  // Distance from ptA to current cursor while picking point B (live preview).
  function livePixelDistance(): number {
    if (!ptA || !cursor || phase !== 'point-b') return 0
    return Math.sqrt((cursor.x - ptA.x) ** 2 + (cursor.y - ptA.y) ** 2)
  }

  function confirm() {
    const realDist = parseFloat(distInput)
    if (!isFinite(realDist) || realDist <= 0) return
    const realMm = toMm(realDist)
    const pxDist = pixelDistance()
    if (!Number.isFinite(pxDist) || pxDist < 1) return
    const mmPerPx = realMm / pxDist
    if (!Number.isFinite(mmPerPx) || mmPerPx < MIN_MANUAL_MM_PER_PX || mmPerPx > MAX_MANUAL_MM_PER_PX) return
    const notationRatio = Math.round((25.4 / 72) * (1 / mmPerPx))
    const notation = notationRatio > 0 ? `1:${notationRatio}` : `custom`
    onCalibrate(mmPerPx, notation)
  }

  const instructions: Record<Phase, string> = {
    idle: 'Click "Start Calibration" to set a known distance on the drawing',
    'point-a': 'Click the FIRST point of your known measurement',
    'point-b': 'Click the SECOND point — drag along the dimension line',
    'enter-distance': 'Enter the real-world distance between those two points',
  }

  // The arrow endpoint: locked point B if set, otherwise live cursor.
  const arrowEnd: Point | null = ptB ?? (phase === 'point-b' ? cursor : null)
  const livePx = livePixelDistance()
  const liveRealMm = existingMmPerPx && livePx > 0 ? livePx * existingMmPerPx : null

  // Show the SVG overlay whenever the user is actively placing points or has
  // placed at least one, so the cursor-preview dot appears even in point-a.
  const showOverlay = phase === 'point-a' || phase === 'point-b' || phase === 'enter-distance'
  const dotR = Math.max(5, Math.min(imageWidth, imageHeight) / 200)
  const strokeW = Math.max(2, Math.min(imageWidth, imageHeight) / 400)

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

        <p className={styles.instruction}>{instructions[phase]}</p>

        {phase === 'idle' && (
          <button className={styles.startBtn} onClick={() => setPhase('point-a')}>
            Start Calibration
          </button>
        )}

        {(phase === 'point-a' || phase === 'point-b') && (
          <button className={styles.cancelBtn} onClick={() => { setPhase('idle'); setPtA(null); setPtB(null); setCursor(null) }}>
            Cancel
          </button>
        )}

        {phase === 'enter-distance' && (
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
            <button className={styles.cancelBtn} onClick={() => { setPhase('point-a'); setPtB(null) }}>
              Redo
            </button>
          </div>
        )}

        <div className={styles.imageWrap}>
          {/*
           * imageContainer sizes itself to the displayed image so the SVG
           * overlay covers it exactly — avoiding any coordinate misalignment
           * that would occur if the SVG were sized to a larger parent container.
           */}
          <div className={styles.imageContainer}>
            {showOverlay && (
              <svg
                data-testid="calibration-overlay"
                className={styles.svg}
                viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                preserveAspectRatio="none"
              >
                <defs>
                  {/* Reusable arrowheads */}
                  <marker
                    id="cal-arrow-end"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                  </marker>
                  <marker
                    id="cal-arrow-start"
                    viewBox="0 0 10 10"
                    refX="1"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 10 0 L 0 5 L 10 10 z" fill="#f59e0b" />
                  </marker>
                </defs>

                {/* Cursor-preview dot in point-a phase so the user can see
                    exactly where their first click will land. */}
                {phase === 'point-a' && cursor && (
                  <circle
                    data-testid="cursor-preview"
                    cx={cursor.x} cy={cursor.y}
                    r={dotR}
                    fill="#38bdf8"
                    fillOpacity={0.6}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                )}

                {/* Rubber-band arrow: stretches from ptA to the cursor while the
                    user moves toward point B, then locks to a dashed line once
                    both points are confirmed. */}
                {ptA && arrowEnd && (
                  <g data-testid="calibration-arrow">
                    <line
                      x1={ptA.x} y1={ptA.y}
                      x2={arrowEnd.x} y2={arrowEnd.y}
                      stroke="#f59e0b"
                      strokeWidth={strokeW}
                      strokeDasharray={ptB ? '6 3' : undefined}
                      strokeLinecap="round"
                      markerStart="url(#cal-arrow-start)"
                      markerEnd="url(#cal-arrow-end)"
                    />
                  </g>
                )}

                {ptA && (
                  <circle
                    cx={ptA.x} cy={ptA.y}
                    r={dotR}
                    fill="#38bdf8" stroke="#fff" strokeWidth={1.5}
                  />
                )}
                {ptB && (
                  <circle
                    cx={ptB.x} cy={ptB.y}
                    r={dotR}
                    fill="#f59e0b" stroke="#fff" strokeWidth={1.5}
                  />
                )}

                {/* Live pixel/distance readout floating at the arrow midpoint */}
                {ptA && arrowEnd && phase === 'point-b' && livePx > 0 && (
                  <g pointerEvents="none">
                    <rect
                      x={(ptA.x + arrowEnd.x) / 2 - 60}
                      y={(ptA.y + arrowEnd.y) / 2 - 24}
                      width={120}
                      height={22}
                      rx={4}
                      fill="rgba(15, 23, 42, 0.85)"
                      stroke="#f59e0b"
                      strokeWidth={1}
                    />
                    <text
                      x={(ptA.x + arrowEnd.x) / 2}
                      y={(ptA.y + arrowEnd.y) / 2 - 9}
                      fill="#fbbf24"
                      fontSize={Math.max(11, Math.min(imageWidth, imageHeight) / 80)}
                      fontFamily="ui-monospace, monospace"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {liveRealMm !== null
                        ? `${livePx.toFixed(0)} px ≈ ${(liveRealMm / 1000).toFixed(2)} m`
                        : `${livePx.toFixed(0)} px`}
                    </text>
                  </g>
                )}
              </svg>
            )}
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Drawing preview"
              className={`${styles.image} ${
                phase === 'point-a' || phase === 'point-b' ? styles.imageCrosshair : ''
              }`}
              onClick={handleImageClick}
              onMouseMove={handleImageMove}
              onMouseLeave={handleImageLeave}
              draggable={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
