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

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (phase !== 'point-a' && phase !== 'point-b') return
      const rect = imgRef.current!.getBoundingClientRect()
      // Map click to image pixel coords
      const scaleX = imageWidth / rect.width
      const scaleY = imageHeight / rect.height
      const px = (e.clientX - rect.left) * scaleX
      const py = (e.clientY - rect.top) * scaleY

      if (phase === 'point-a') {
        setPtA({ x: px, y: py })
        setPtB(null)
        setPhase('point-b')
      } else {
        setPtB({ x: px, y: py })
        setPhase('enter-distance')
      }
    },
    [phase, imageWidth, imageHeight]
  )

  function pixelDistance(): number {
    if (!ptA || !ptB) return 0
    return Math.sqrt((ptB.x - ptA.x) ** 2 + (ptB.y - ptA.y) ** 2)
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

  // Map image pixel coord to display coord (CSS space)
  function toCssCoord(p: Point) {
    if (!imgRef.current) return { left: 0, top: 0 }
    const rect = imgRef.current.getBoundingClientRect()
    return {
      left: (p.x / imageWidth) * rect.width,
      top: (p.y / imageHeight) * rect.height,
    }
  }

  const cssPtA = ptA ? toCssCoord(ptA) : null
  const cssPtB = ptB ? toCssCoord(ptB) : null

  const instructions: Record<Phase, string> = {
    idle: 'Click "Start Calibration" to set a known distance on the drawing',
    'point-a': 'Click the FIRST point of your known measurement',
    'point-b': 'Click the SECOND point of your known measurement',
    'enter-distance': 'Enter the real-world distance between those two points',
  }

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
          <button className={styles.cancelBtn} onClick={() => { setPhase('idle'); setPtA(null); setPtB(null) }}>
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
          {/* SVG overlay for measurement line */}
          {(cssPtA || cssPtB) && (
            <svg className={styles.svg}>
              {cssPtA && cssPtB && (
                <line
                  x1={cssPtA.left} y1={cssPtA.top}
                  x2={cssPtB.left} y2={cssPtB.top}
                  stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3"
                />
              )}
              {cssPtA && (
                <circle cx={cssPtA.left} cy={cssPtA.top} r={6} fill="#38bdf8" stroke="#fff" strokeWidth={1.5} />
              )}
              {cssPtB && (
                <circle cx={cssPtB.left} cy={cssPtB.top} r={6} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
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
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}
