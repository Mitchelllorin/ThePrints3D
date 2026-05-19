import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedWall } from '../../types'
import { reduceStrokeToWall } from '../../services/wallTraceReducer'
import type { StrokePoint } from '../../services/wallTraceReducer'
import styles from './WallTracer.module.css'

export const WALL_COLOR_AUTO = 'rgba(52,211,153,0.55)'
export const WALL_COLOR_LOW_CONFIDENCE = 'rgba(251,191,36,0.55)'
export const WALL_COLOR_USER = '#60a5fa'

export const WALL_LEGEND_AUTO = 'rgb(52,211,153)'
export const WALL_LEGEND_LOW_CONFIDENCE = 'rgb(251,191,36)'

const DRAG_THRESHOLD = 8
const DEBOUNCE_MS = 400

type Phase = 'idle' | 'dragging' | 'pending-finalize' | 'cad-first'

interface Props {
  active: boolean
  imageWidth: number
  imageHeight: number
  walls: ParsedWall[]
  onAddWall: (wall: ParsedWall) => void
  onRequestConfirm?: (wall: ParsedWall, midpoint: { x: number; y: number }) => void
}

export default function WallTracer({ active, imageWidth, imageHeight, walls, onAddWall, onRequestConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [anchor, setAnchor] = useState<StrokePoint | null>(null)
  const [cursor, setCursor] = useState<StrokePoint | null>(null)
  const [cadFirstPoint, setCadFirstPoint] = useState<StrokePoint | null>(null)

  const anchorRef = useRef<StrokePoint | null>(null)
  const cadRef = useRef<StrokePoint | null>(null)
  const endRef = useRef<StrokePoint | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDown = useRef(false)
  const [, setTick] = useState(0)

  const userWalls = useMemo(() => walls.filter((w) => w.source === 'user'), [walls])
  const autoWalls = useMemo(() => walls.filter((w) => w.source !== 'user'), [walls])

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const emitWall = useCallback((startPt: StrokePoint, endPt: StrokePoint) => {
    const wall = reduceStrokeToWall([startPt, endPt])
    if (!wall) return
    const midX = (wall.x1 + wall.x2) / 2
    const midY = (wall.y1 + wall.y2) / 2
    if (onRequestConfirm) {
      onRequestConfirm(wall, { x: midX, y: midY })
    } else {
      onAddWall(wall)
    }
  }, [onRequestConfirm, onAddWall])

  const cleanup = useCallback(() => {
    cancelDebounce()
    isDown.current = false
    anchorRef.current = null
    endRef.current = null
    setAnchor(null)
    setCursor(null)
    setTick((t) => t + 1)
  }, [cancelDebounce])

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

    const sx = canvas.clientWidth / imageWidth
    const sy = canvas.clientHeight / imageHeight

    for (const wall of autoWalls) {
      const confidence = wall.detectionConfidence ?? 1
      const isLowConfidence = confidence < 0.65
      ctx.strokeStyle = isLowConfidence ? WALL_COLOR_LOW_CONFIDENCE : WALL_COLOR_AUTO
      ctx.lineWidth = Math.max(3, (wall.thickness > 1 ? wall.thickness : 4) * ((sx + sy) / 2) * 0.35)
      ctx.setLineDash(isLowConfidence ? [4, 4] : [])
      ctx.beginPath()
      ctx.moveTo(wall.x1 * sx, wall.y1 * sy)
      ctx.lineTo(wall.x2 * sx, wall.y2 * sy)
      ctx.stroke()
    }
    ctx.setLineDash([])

    for (const wall of userWalls) {
      ctx.strokeStyle = WALL_COLOR_USER
      ctx.lineWidth = Math.max(4, wall.thickness * ((sx + sy) / 2))
      ctx.beginPath()
      ctx.moveTo(wall.x1 * sx, wall.y1 * sy)
      ctx.lineTo(wall.x2 * sx, wall.y2 * sy)
      ctx.stroke()
    }

    // CAD first-point indicator
    const cp = cadRef.current
    if (cp && phase === 'cad-first') {
      const px = cp.x * sx
      const py = cp.y * sy
      ctx.fillStyle = '#38bdf8'
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#f1f5f9'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px sans-serif'
      ctx.fillText('Tap second point', px + 10, py + 4)
    }

    // Anchor dot
    const a = anchor ?? anchorRef.current
    if (a && phase !== 'cad-first') {
      const px = a.x * sx
      const py = a.y * sy
      ctx.fillStyle = '#38bdf8'
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#f1f5f9'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Preview line from anchor to cursor
    const start = anchor ?? anchorRef.current
    const end = cursor
    if (start && end && phase !== 'idle' && phase !== 'cad-first') {
      const x1 = start.x * sx
      const y1 = start.y * sy
      const x2 = end.x * sx
      const y2 = end.y * sy
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 3
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])

      const angle = Math.atan2(y2 - y1, x2 - x1)
      const headLen = 10
      ctx.fillStyle = '#f59e0b'
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4))
      ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4))
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#f59e0b'
      ctx.beginPath()
      ctx.arc(x2, y2, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [imageHeight, imageWidth, userWalls, autoWalls, anchor, cursor, phase])

  useEffect(() => { redraw() }, [redraw])

  const eventToPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const rx = (event.clientX - rect.left) / rect.width
    const ry = (event.clientY - rect.top) / rect.height
    return {
      x: Math.max(0, Math.min(imageWidth, rx * imageWidth)),
      y: Math.max(0, Math.min(imageHeight, ry * imageHeight)),
    }
  }, [imageHeight, imageWidth])

  // ─── Pointer handlers ─────────────────────────────────────────────────────

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const p = eventToPoint(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    isDown.current = true

    // If awaiting finalize → cancel debounce and resume from existing anchor
    if (phase === 'pending-finalize') {
      cancelDebounce()
      setPhase('dragging')
      setCursor(p)
      setTick((t) => t + 1)
      return
    }

    // If CAD first point set, finalize on second tap
    const cp = cadRef.current
    if (cp) {
      const wall = reduceStrokeToWall([cp, p])
      if (wall) {
        cadRef.current = null
        setCadFirstPoint(null)
        setPhase('idle')
        const midX = (wall.x1 + wall.x2) / 2
        const midY = (wall.y1 + wall.y2) / 2
        if (onRequestConfirm) onRequestConfirm(wall, { x: midX, y: midY })
        else onAddWall(wall)
      }
      return
    }

    // Start new drag
    anchorRef.current = p
    endRef.current = p
    setAnchor(p)
    setCursor(p)
    setPhase('dragging')
    setTick((t) => t + 1)
  }, [active, eventToPoint, phase, cancelDebounce, onRequestConfirm, onAddWall])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !isDown.current) return
    if (phase !== 'dragging') return
    const p = eventToPoint(event)
    if (!p) return
    endRef.current = p
    setCursor(p)
    setTick((t) => t + 1)
  }, [active, eventToPoint, phase])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !isDown.current) return
    isDown.current = false

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (phase !== 'dragging') return

    const endPt = eventToPoint(event)
    const startPt = anchorRef.current
    if (!startPt || !endPt) {
      cleanup()
      return
    }

    const dx = endPt.x - startPt.x
    const dy = endPt.y - startPt.y
    const moved = Math.hypot(dx, dy)

    if (moved < DRAG_THRESHOLD) {
      // Tap → CAD double-tap mode
      const cp = cadRef.current
      if (cp) {
        // Second tap → complete wall
        const wall = reduceStrokeToWall([cp, endPt])
        if (wall) {
          cadRef.current = null
          setCadFirstPoint(null)
          const midX = (wall.x1 + wall.x2) / 2
          const midY = (wall.y1 + wall.y2) / 2
          if (onRequestConfirm) onRequestConfirm(wall, { x: midX, y: midY })
          else onAddWall(wall)
        }
        cleanup()
      } else {
        // First tap → set CAD point
        cadRef.current = endPt
        setCadFirstPoint(endPt)
        setPhase('cad-first')
        anchorRef.current = null
        setAnchor(null)
        setCursor(null)
        setTick((t) => t + 1)
      }
      return
    }

    // Drag → enter debounce window
    endRef.current = endPt
    setPhase('pending-finalize')
    setTick((t) => t + 1)

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      const s = anchorRef.current
      const e = endRef.current
      cleanup()
      if (s && e) {
        emitWall(s, e)
      }
    }, DEBOUNCE_MS)
  }, [active, eventToPoint, phase, cleanup, emitWall, onRequestConfirm, onAddWall])

  const onPointerCancel = useCallback(() => {
    cleanup()
    cadRef.current = null
    setCadFirstPoint(null)
    setPhase('idle')
    setTick((t) => t + 1)
  }, [cleanup])

  if (!active) return null

  return (
    <div className={`${styles.overlay} ${styles.active}`}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {phase === 'idle' && (
        <div className={styles.hint}>Drag to draw · Tap twice for CAD mode</div>
      )}
      {phase === 'dragging' && (
        <div className={styles.hint}>Release to confirm · tap again to continue</div>
      )}
      {phase === 'pending-finalize' && (
        <div className={styles.hint}>Tap to continue drawing · wait to finalize</div>
      )}
      {phase === 'cad-first' && (
        <div className={`${styles.hint} ${styles.hintCad}`}>
          Tap a second point to complete the wall
        </div>
      )}
    </div>
  )
}
