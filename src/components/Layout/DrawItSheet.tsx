/**
 * DRAW IT — one wall at a time, on the paper.
 *
 * THERE IS ONE WAY TO DRAW A BUILDING. A house, a shed, a lean-to, a carport, a
 * fence line, a retaining wall: they are all runs of walls on a sheet, so the
 * sheet is paper and walls and nothing else. The old sheet asked what you were
 * building first — House, Shed, Walls — and answered it with a box you had to
 * pull to size, which is a lie about anything that is not a box. It is gone.
 *
 * WHAT YOU DO HERE:
 *   - Tap the paper to park the start of a wall, tap again and the wall is
 *     there; the end of it is the next start. Corner after corner, one wall at
 *     a time, and the run finishes when you tap the parked end again. A drag
 *     does the same in one motion.
 *   - Tap a wall to pick it and the widget on it sets the angle, squares it,
 *     runs it straight on from the wall it came off, removes it.
 *   - With a print open the print is the paper, at its own scale, so a wall
 *     drawn along a line is that line's real length. Blank sheet is the same
 *     squared paper when there is no plan to trace.
 *   - Every wall on the page is the same building: draw a second run away from
 *     the first and it is a second structure in the same space, not a new job.
 *
 * Frame the walls once and they are all framed at the wall type chosen here.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { WALL_TYPES, } from '../../data/members'
import { shellThicknessMm } from '../../services/drawnProject'
import { wallsBounds, wallsPlan, type DrawItPlan } from '../../services/drawItPlan'
import { formatMeasureMm } from '../../services/unitConverter'
import FootprintEditor from './FootprintEditor'
import styles from './DrawItSheet.module.css'

const FT = 304.8
/** The blank sheet: a 40 x 30 building's worth of paper, or its metric cousin. */
const blankPage = (metric: boolean) => ({ w: metric ? 12000 : 40 * FT, d: metric ? 9000 : 30 * FT })

export default function DrawItSheet({ onClose }: { onClose: () => void }) {
  const startDrawnProject = useAppStore((s) => s.startDrawnProject)
  const standWalls = useAppStore((s) => s.standWalls)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)
  const setConfig = useConfigStore((s) => s.set)
  // The same setting as Settings, changed where the numbers are.
  const useImperial = () => setConfig({ lengthFormat: 'ft-in', activeUnit: 'ft' })
  const useMetric = () => setConfig({ lengthFormat: 'decimal', activeUnit: 'm' })
  const metric = lengthFormat === 'decimal' && (activeUnit === 'mm' || activeUnit === 'cm' || activeUnit === 'm')
  const fmt = (mm: number) => formatMeasureMm(mm, activeUnit, lengthFormat)
  // A finger lands on clean numbers: 6" in feet and inches, 100 mm in metric.
  // Typing a number on the dimension is never snapped.
  const snapMm = metric ? 100 : 6 * 25.4

  /** The sheet already open: the print, when its scale is known. */
  const drawing = useAppStore((s) => s.drawings.find((d) => d.id === s.selectedDrawingId) ?? s.drawings[0])
  const print = drawing?.rasterUrl && drawing.scaleMmPerPx && drawing.rasterWidth && drawing.rasterHeight
    ? {
      url: drawing.rasterUrl,
      wMm: drawing.rasterWidth * drawing.scaleMmPerPx,
      dMm: drawing.rasterHeight * drawing.scaleMmPerPx,
    }
    : null

  const [plan, setPlan] = useState<DrawItPlan>(() => wallsPlan(print ? { w: print.wMm, d: print.dMm } : blankPage(metric)))
  const [selectedWall, setSelectedWall] = useState<number | null>(null)
  const [wallTypeKey, setWallTypeKey] = useState('wood-2x6')
  /** What the paper draws: a wall, or a circle (a round post, a footing, a pit). */
  const [tool, setTool] = useState<'wall' | 'circle'>('wall')
  const [onPrint, setOnPrint] = useState(true)
  const printOn = onPrint && !!print

  /**
   * UNDO AND REDO over the plan, one step per thing done. The editor hands back
   * the plan as it was when a gesture started, so a drag that moved a wall the
   * length of the screen is one step — and the buttons under the plan and the
   * ones in the wall widget drive the same two stacks.
   */
  const [past, setPast] = useState<DrawItPlan[]>([])
  const [future, setFuture] = useState<DrawItPlan[]>([])
  const commit = (before: DrawItPlan) => {
    setPast((p) => (p[p.length - 1] === before ? p : [...p.slice(-40), before]))
    setFuture([])
  }
  const change = (next: DrawItPlan) => { commit(plan); setPlan(next) }
  const undo = () => {
    const last = past[past.length - 1]
    if (!last) return
    setPast(past.slice(0, -1))
    setFuture([plan, ...future])
    setPlan(last)
    setSelectedWall(null)
  }
  const redo = () => {
    const [next, ...rest] = future
    if (!next) return
    setFuture(rest)
    setPast([...past, plan])
    setPlan(next)
    setSelectedWall(null)
  }

  /** The print under the walls, or squared paper. Same walls either way. */
  const choosePaper = (usePrint: boolean) => {
    setOnPrint(usePrint)
    change({ ...plan, page: usePrint && print ? { w: print.wMm, d: print.dMm } : blankPage(metric) })
  }

  const frame = () => {
    const b = wallsBounds(plan.walls)
    if (!b) return
    startDrawnProject({
      widthMm: b.w, depthMm: b.d, wallTypeKey, floor: 'none', name: 'New project',
      page: { originMm: { x: 0, y: 0 }, wMm: plan.page.w, dMm: plan.page.d },
      freeWalls: plan.walls,
    })
    // THE WALLS ARE ALREADY UP: a drawn project's shell draws itself standing,
    // but the model was left marked unbuilt, so the step chip asked you to
    // stand up what you were looking at standing. Stand them here.
    standWalls()
    onClose()
  }

  const lead = tool === 'circle'
    ? 'Drag out from the centre of the circle. Tap one to set its diameter or take it out.'
    : selectedWall != null
    ? 'Drag the wall, or its ring, to set it. Tap the number to type the length.'
    : 'Tap the paper to start a wall, tap again to turn the corner. Tap the last end to finish.'

  return (
    <>
      {/* The scrim carries no text. */}
      <div className={styles.scrim} aria-hidden />
      <div className={styles.sheet} role="dialog" aria-label="Draw it">
        <div className={styles.top}>
          <div className={styles.head}>
            <h2 className={styles.title}>Draw it</h2>
            {/* Units live with the numbers they change. Same setting as Settings. */}
            <div className={styles.units} role="group" aria-label="Units">
              <button
                className={`${styles.unit} ${!metric ? styles.chosen : ''}`}
                onClick={useImperial}
                aria-pressed={!metric}
              >
                {!metric ? '✓ ' : ''}ft-in
              </button>
              <button
                className={`${styles.unit} ${metric ? styles.chosen : ''}`}
                onClick={useMetric}
                aria-pressed={metric}
              >
                {metric ? '✓ ' : ''}Metric
              </button>
            </div>
            <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
          </div>
          <p className={styles.lead}>{lead}</p>
        </div>

        {/* The plan. It takes whatever height the rest leaves it. */}
        <div className={styles.plan}>
          <FootprintEditor
            plan={plan} onChange={setPlan} mode="walls"
            selectedWall={selectedWall} onSelectWall={setSelectedWall}
            format={fmt} snapMm={snapMm} metric={metric} shellMm={shellThicknessMm(wallTypeKey)}
            wallsOnly circleTool={tool === 'circle'} underlay={printOn ? print : null}
            onCommit={commit} canUndo={past.length > 0} canRedo={future.length > 0} onUndo={undo} onRedo={redo} />
        </div>

        <div className={styles.rest}>
          <p className={styles.echo}>
            {plan.walls.length} wall{plan.walls.length === 1 ? '' : 's'}
            {(plan.circles?.length ?? 0) > 0 ? ` · ${plan.circles!.length} circle${plan.circles!.length === 1 ? '' : 's'}` : ''}
            {printOn ? ' over the print' : ''} · tap one to pick it
          </p>

          {/* WHAT THE WALL IS MADE OF. Every type in the catalogue, both
              masonry ones included — a wall drawn on its own can be a garden
              wall or a retaining wall, not only a stud partition. */}
          <select className={styles.select} value={wallTypeKey}
            onChange={(e) => setWallTypeKey(e.target.value)} aria-label="Wall type">
            {WALL_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>

          {/* WHAT THE PAPER DRAWS. Walls are the building; circles are the
              round things in it — a post, a footing, a fire pit. */}
          <div className={styles.row} role="group" aria-label="What to draw">
            <button className={`${styles.mode} ${tool === 'wall' ? styles.chosen : ''}`}
              onClick={() => { setTool('wall'); setSelectedWall(null) }} aria-pressed={tool === 'wall'}>
              {tool === 'wall' ? '✓ ' : ''}Walls
            </button>
            <button className={`${styles.mode} ${tool === 'circle' ? styles.chosen : ''}`}
              onClick={() => { setTool('circle'); setSelectedWall(null) }} aria-pressed={tool === 'circle'}>
              {tool === 'circle' ? '✓ ' : ''}Circles
            </button>
          </div>

          {/* THE PRINT AS THE PAPER. Two fingers pan and zoom it, so a sheet
              that does not all fit at once is not a dead end. */}
          {print && (
            <div className={styles.row} role="group" aria-label="Paper under the walls">
              <button className={`${styles.mode} ${onPrint ? styles.chosen : ''}`} onClick={() => choosePaper(true)} aria-pressed={onPrint}>
                {onPrint ? '✓ ' : ''}Over the print
              </button>
              <button className={`${styles.mode} ${!onPrint ? styles.chosen : ''}`} onClick={() => choosePaper(false)} aria-pressed={!onPrint}>
                {!onPrint ? '✓ ' : ''}Blank sheet
              </button>
            </div>
          )}
        </div>

        {/* THE ONE THAT FINISHES IT, pinned to the bottom edge of the sheet. */}
        <button className={styles.go} onClick={frame} disabled={plan.walls.length === 0}>
          Frame the walls
        </button>
      </div>
    </>
  )
}
