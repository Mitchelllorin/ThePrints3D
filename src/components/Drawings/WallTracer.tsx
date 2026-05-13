import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedWall } from '../../types'
import { reduceStrokeToWall, type StrokePoint } from '../../services/wallTraceReducer'
import styles from './WallTracer.module.css'

interface Props {
  active: boolean
  imageWidth: number
  imageHeight: number
  walls: ParsedWall[]
  onAddWall: (wall: ParsedWall) => void
}

export default function WallTracer({ active, imageWidth, imageHeight, walls, onAddWall }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stroke, setStroke] = useState<StrokePoint[]>([])

  const userWalls = useMemo(() => walls.filter((w) => w.source === 'user'), [walls])

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

    for (const wall of userWalls) {
      ctx.strokeStyle = '#60a5fa'
      ctx.lineWidth = Math.max(2, wall.thickness * ((sx + sy) / 2))
      ctx.beginPath()
      ctx.moveTo(wall.x1 * sx, wall.y1 * sy)
      ctx.lineTo(wall.x2 * sx, wall.y2 * sy)
      ctx.stroke()
    }

    if (stroke.length > 1) {
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(stroke[0].x * sx, stroke[0].y * sy)
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x * sx, stroke[i].y * sy)
      }
      ctx.stroke()
    }
  }, [imageHeight, imageWidth, stroke, userWalls])

  useEffect(() => {
    redraw()
  }, [redraw])

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

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    const p = eventToPoint(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setStroke([p])
  }, [active, eventToPoint])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    const p = eventToPoint(event)
    if (!p) return
    setStroke((prev) => (prev.length === 0 ? prev : [...prev, p]))
  }, [active, eventToPoint])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    const p = eventToPoint(event)
    setStroke((prev) => {
      const points = p ? [...prev, p] : prev
      const wall = reduceStrokeToWall(points)
      if (wall) onAddWall(wall)
      return []
    })
  }, [active, eventToPoint, onAddWall])

  return (
    <div className={`${styles.overlay} ${active ? styles.active : ''}`}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {active && <div className={styles.hint}>Trace main walls with your finger/mouse</div>}
    </div>
  )
}
