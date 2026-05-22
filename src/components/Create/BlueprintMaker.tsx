import { useState, useRef, useCallback } from 'react'
import { useAppStore } from '../../store/useAppStore'
import styles from './BlueprintMaker.module.css'

interface Point { x: number; y: number }

export default function BlueprintMaker() {
  const [walls, setWalls] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([])
  const [drawing, setDrawing] = useState(false)
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const setView = useAppStore((s) => s.setView)

  const getSvgPoint = useCallback((e: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = getSvgPoint(e)
    setStart(p)
    setCurrent(p)
    setDrawing(true)
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return
    setCurrent(getSvgPoint(e))
  }

  const handlePointerUp = () => {
    if (!drawing || !start || !current) return
    const dx = current.x - start.x
    const dy = current.y - start.y
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      setWalls((prev) => [...prev, { x1: start.x, y1: start.y, x2: current.x, y2: current.y }])
    }
    setDrawing(false)
    setStart(null)
    setCurrent(null)
  }

  const clearAll = () => {
    setWalls([])
    setDrawing(false)
    setStart(null)
    setCurrent(null)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>✏️ Blueprint Maker</h2>
        <p className={styles.subtitle}>Draw walls directly on the canvas — click and drag to create wall segments</p>
        <div className={styles.actions}>
          <span className={styles.wallCount}>{walls.length} walls</span>
          <button className={styles.clearBtn} onClick={clearAll}>Clear All</button>
          <button className={styles.backBtn} onClick={() => setView('upload')}>← Back</button>
        </div>
      </div>

      <div className={styles.canvasWrap}>
        <svg
          ref={svgRef}
          className={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Grid */}
          <defs>
            <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth={0.5} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Existing walls */}
          {walls.map((w, i) => (
            <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#38bdf8" strokeWidth={4} strokeLinecap="round" />
          ))}

          {/* Live preview */}
          {drawing && start && current && (
            <line x1={start.x} y1={start.y} x2={current.x} y2={current.y} stroke="#f59e0b" strokeWidth={3} strokeDasharray="6 3" strokeLinecap="round" />
          )}
        </svg>
      </div>
    </div>
  )
}
