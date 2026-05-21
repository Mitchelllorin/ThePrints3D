import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedWall } from '../../types'
import { reduceStrokeToWall, type StrokePoint } from '../../services/wallTraceReducer'
import styles from './WallTracer.module.css'

/** Overlay colors for the three wall categories. */
export const WALL_COLOR_AUTO = 'rgba(52,211,153,0.55)'
export const WALL_COLOR_LOW_CONFIDENCE = 'rgba(251,191,36,0.55)'
export const WALL_COLOR_USER = '#60a5fa'

/** Solid variants used in text legends. */
export const WALL_LEGEND_AUTO = 'rgb(52,211,153)'
export const WALL_LEGEND_LOW_CONFIDENCE = 'rgb(251,191,36)'

interface Props {
  active: boolean
  imageWidth: number
  imageHeight: number
  walls: ParsedWall[]
  onAddWall: (wall: ParsedWall) => void
}

export default function WallTracer({ active, imageWidth, imageHeight, walls, onAddWall }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [startPoint, setStartPoint] = useState<StrokePoint | null>(null)
  const [cursor, setCursor] = useState<StrokePoint | null>(null)
  const drawingRef = useRef(false)
  const moveRafRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<StrokePoint | null>(null)

  const userWalls = useMemo(() => walls.filter((w) => w.source === 'user'), [walls])
  const autoWalls = useMemo(() => walls.filter((w) => w.source !== 'user'), [walls])

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

    // Auto-detected walls — always visible so the user can see what was found
    // and know where to supplement with manual traces.
    for (const wall of autoWalls) {
      const confidence = wall.detectionConfidence ?? 1
      const isLowConfidence = confidence < 0.65
      ctx.strokeStyle = isLowConfidence
        ? WALL_COLOR_LOW_CONFIDENCE  // amber for low-confidence walls
        : WALL_COLOR_AUTO            // teal for normal auto walls
      ctx.lineWidth = Math.max(1.5, (wall.thickness > 1 ? wall.thickness : 4) * ((sx + sy) / 2) * 0.35)
      ctx.setLineDash(isLowConfidence ? [4, 4] : [])
      ctx.beginPath()
      ctx.moveTo(wall.x1 * sx, wall.y1 * sy)
      ctx.lineTo(wall.x2 * sx, wall.y2 * sy)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // User-traced walls — shown in blue, always on top
    for (const wall of userWalls) {
      ctx.strokeStyle = WALL_COLOR_USER
      ctx.lineWidth = Math.max(2, wall.thickness * ((sx + sy) / 2))
      ctx.beginPath()
      ctx.moveTo(wall.x1 * sx, wall.y1 * sy)
      ctx.lineTo(wall.x2 * sx, wall.y2 * sy)
      ctx.stroke()
    }

    if (startPoint && cursor) {
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.beginPath()
      ctx.moveTo(startPoint.x * sx, startPoint.y * sy)
      ctx.lineTo(cursor.x * sx, cursor.y * sy)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [imageHeight, imageWidth, startPoint, cursor, userWalls, autoWalls])

  useEffect(() => {
    redraw()
  }, [redraw])

  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) {
        window.cancelAnimationFrame(moveRafRef.current)
      }
    }
  }, [])

  const eventToPoint = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
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

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!active) return
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const p = eventToPoint(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    pendingCursorRef.current = p
    setStartPoint(p)
    setCursor(p)
  }, [active, eventToPoint])

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!active || !drawingRef.current) return
    const p = eventToPoint(event)
    if (!p) return
    pendingCursorRef.current = p
    if (moveRafRef.current !== null) return
    moveRafRef.current = window.requestAnimationFrame(() => {
      moveRafRef.current = null
      setCursor(pendingCursorRef.current)
    })
  }, [active, eventToPoint])

  const onPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!active) return
    if (!drawingRef.current) return
    const p = eventToPoint(event)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drawingRef.current = false
    const end = p ?? cursor ?? startPoint
    if (startPoint && end) {
      const wall = reduceStrokeToWall([startPoint, end])
      if (wall) onAddWall(wall)
    }
    setStartPoint(null)
    setCursor(null)
    pendingCursorRef.current = null
    if (moveRafRef.current !== null) {
      window.cancelAnimationFrame(moveRafRef.current)
      moveRafRef.current = null
    }
  }, [active, eventToPoint, onAddWall, startPoint, cursor])

  const onPointerCancel = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drawingRef.current = false
    setStartPoint(null)
    setCursor(null)
    pendingCursorRef.current = null
    if (moveRafRef.current !== null) {
      window.cancelAnimationFrame(moveRafRef.current)
      moveRafRef.current = null
    }
  }, [])

  const arrowEnd = cursor ?? startPoint

  return (
    <div className={`${styles.overlay} ${active ? styles.active : ''}`}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
      />
      {active && (
        <svg
          className={styles.capture}
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          preserveAspectRatio="none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <defs>
            <marker
              id="trace-arrow-end"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
            </marker>
            <marker
              id="trace-arrow-start"
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 10 0 L 0 5 L 10 10 z" fill="#38bdf8" />
            </marker>
          </defs>
          {startPoint && arrowEnd && (
            <line
              x1={startPoint.x}
              y1={startPoint.y}
              x2={arrowEnd.x}
              y2={arrowEnd.y}
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="6 3"
              strokeLinecap="round"
              markerStart="url(#trace-arrow-start)"
              markerEnd="url(#trace-arrow-end)"
            />
          )}
        </svg>
      )}
      {active && <div className={styles.hint}>Trace main walls with your finger/mouse</div>}
    </div>
  )
}
