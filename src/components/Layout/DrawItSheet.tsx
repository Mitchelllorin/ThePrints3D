/**
 * DRAW IT — pull the building to size.
 *
 * The first question a job asks is how big it is. This used to answer it with
 * four form fields and a little preview underneath — a sheet called Draw it
 * where nothing was drawn. Now the plan is the input: drag an edge and the
 * building follows your finger, with a dimension on every size reading live in
 * the unit chosen in Settings. Tap a number to type it exact. See
 * FootprintEditor for the gesture and services/footprintEdit for the arithmetic.
 *
 * Sizes are OUTSIDE FACE TO OUTSIDE FACE, the way a tape reads across a
 * building and the way a slab is quoted.
 *
 * A transient sheet the user opened, so it is allowed to be solid and to cross
 * the middle of the screen: it goes away in one tap and the model is behind it.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { WALL_TYPES } from '../../data/members'
import { type FloorChoice } from '../../services/drawnProject'
import { placeBoxes, footprintAreaMm2, type AttachSide, type FootprintBox } from '../../services/footprint'
import { normalizeBoxes } from '../../services/footprintEdit'
import { formatMeasureMm } from '../../services/unitConverter'
import FootprintEditor from './FootprintEditor'
import styles from './DrawItSheet.module.css'

const FT = 304.8
/**
 * What a first footprint is, more often than not: a 40 x 30 single storey — or
 * its round-number cousin in metric, so nobody starts at 12.192 m.
 */
const firstBox = (metric: boolean): FootprintBox =>
  metric ? { widthMm: 12000, depthMm: 9000 } : { widthMm: 40 * FT, depthMm: 30 * FT }
/** A new section: 12 x 14 off the back, or 3.6 x 4.2 m. Drag it where it goes. */
const newSection = (metric: boolean): FootprintBox => ({
  ...(metric ? { widthMm: 3600, depthMm: 4200 } : { widthMm: 12 * FT, depthMm: 14 * FT }),
  attach: { side: 'bottom', offsetMm: 0 },
})

/** Where a section can go, in plan words rather than screen words. */
const SIDES: Array<{ id: AttachSide; label: string }> = [
  { id: 'bottom', label: 'Back' },
  { id: 'top', label: 'Front' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

const FLOORS: Array<{ id: FloorChoice; label: string; note: string }> = [
  { id: 'slab', label: 'Slab', note: '4" on grade' },
  { id: 'joists', label: 'Joists', note: '2×10 floor' },
  { id: 'none', label: 'Later', note: 'decide after' },
]

export default function DrawItSheet({ onClose }: { onClose: () => void }) {
  const startDrawnProject = useAppStore((s) => s.startDrawnProject)
  const standWalls = useAppStore((s) => s.standWalls)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)
  const setConfig = useConfigStore((s) => s.set)
  const metric = lengthFormat === 'decimal' && (activeUnit === 'mm' || activeUnit === 'cm' || activeUnit === 'm')
  const fmt = (mm: number) => formatMeasureMm(mm, activeUnit, lengthFormat)
  // A finger lands on clean numbers: 6" in feet and inches, 100 mm in metric.
  // Typing a number on the dimension is never snapped.
  const snapMm = metric ? 100 : 6 * 25.4

  // MOST HOUSES ARE NOT ONE BOX. An L off the back, a garage on the side, a
  // bump-out for the dining room — each of those is a section hung off the main
  // one, and the walls follow the outline they make together. The first box is
  // the main one; the rest carry which side they hang off and how far along.
  const [boxes, setBoxes] = useState<FootprintBox[]>(() => [firstBox(metric)])
  const [wallTypeKey, setWallTypeKey] = useState('wood-2x6')
  const [floor, setFloor] = useState<FloorChoice>('slab')

  const edit = (next: FootprintBox[]) => setBoxes(normalizeBoxes(next))
  const addWing = () => edit([...boxes, newSection(metric)])
  const setSide = (i: number, side: AttachSide) =>
    edit(boxes.map((b, k) => (k === i ? { ...b, attach: { side, offsetMm: 0 } } : b)))
  const dropWing = (i: number) => edit(boxes.filter((_, k) => k !== i))

  // Metric sets the Settings unit to metres; feet-and-inches keeps any
  // fractional format already chosen rather than rounding it away.
  const useMetric = () => setConfig({ lengthFormat: 'decimal', activeUnit: metric ? activeUnit : 'm' })
  const useImperial = () => { if (lengthFormat === 'decimal') setConfig({ lengthFormat: 'ft-in' }) }

  const areaMm2 = footprintAreaMm2(placeBoxes(boxes))
  const area = metric
    ? `${(areaMm2 / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`
    : `${Math.round(areaMm2 / (FT * FT)).toLocaleString()} ft²`

  const start = () => {
    const [main, ...wings] = boxes
    startDrawnProject({
      widthMm: main.widthMm, depthMm: main.depthMm, wallTypeKey, floor, name: 'New project',
      wings,
    })
    // THE WALLS ARE ALREADY UP. A drawn project's shell draws itself standing
    // the moment it exists, but the model was left marked unbuilt — so the
    // step chip asked you to "Stand them up" while you were looking at them
    // standing. Stand them here, so what the app says matches what is on
    // screen and the next thing it asks for is the inside walls.
    standWalls()
    onClose()
  }

  return (
    <>
      {/* The scrim carries no text and takes the tap that dismisses this. */}
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <div className={styles.sheet} role="dialog" aria-label="Draw it — drag the footprint to size">
        <div className={styles.top}>
        <div className={styles.head}>
          <h2 className={styles.title}>Draw it</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className={styles.lead}>Drag an edge to size it. Tap a number to type it exact.</p>

        {/* Units live with the numbers they change. Same setting as Settings. */}
        <div className={styles.row} role="group" aria-label="Units">
          <button className={`${styles.unit} ${!metric ? styles.chosen : ''}`} onClick={useImperial} aria-pressed={!metric}>
            {!metric ? '✓ ' : ''}ft-in
          </button>
          <button className={`${styles.unit} ${metric ? styles.chosen : ''}`} onClick={useMetric} aria-pressed={metric}>
            {metric ? '✓ ' : ''}Metric
          </button>
        </div>
        </div>

        {/* The plan. Its own box, so landscape can stand it full height on the left. */}
        <div className={styles.plan}>
          <FootprintEditor boxes={boxes} onChange={edit} format={fmt} snapMm={snapMm} metric={metric} />
        </div>

        <div className={styles.rest}>
        <p className={styles.echo}>{area} · outside face to outside face</p>

        <span className={styles.label}>Sections</span>
        {boxes.slice(1).map((b, k) => {
          const i = k + 1
          return (
            <div key={i} className={styles.wing}>
              <div className={styles.wingHead}>
                <span className={styles.wingName}>Section {i + 1} — hangs off the</span>
                <button className={styles.wingDrop} onClick={() => dropWing(i)} aria-label={`Remove section ${i + 1}`}>Remove</button>
              </div>
              <div className={styles.row}>
                {SIDES.map((sd) => (
                  <button
                    key={sd.id}
                    className={`${styles.side} ${b.attach?.side === sd.id ? styles.chosen : ''}`}
                    onClick={() => setSide(i, sd.id)}
                    aria-pressed={b.attach?.side === sd.id}
                  >{b.attach?.side === sd.id ? '✓ ' : ''}{sd.label}</button>
                ))}
              </div>
            </div>
          )
        })}
        <button className={styles.addWing} onClick={addWing}>+ Add a section</button>

        <span className={styles.label}>Shell</span>
        <select
          className={styles.select}
          value={wallTypeKey}
          onChange={(e) => setWallTypeKey(e.target.value)}
          aria-label="Shell wall type"
        >
          {WALL_TYPES.filter((t) => !t.isMasonry).map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>

        <span className={styles.label}>Floor</span>
        <div className={styles.row}>
          {FLOORS.map((f) => (
            <button
              key={f.id}
              className={`${styles.choice} ${floor === f.id ? styles.chosen : ''}`}
              onClick={() => setFloor(f.id)}
              aria-pressed={floor === f.id}
            >
              {/* On-state is a fill AND a check, never colour alone. */}
              <span className={styles.choiceLabel}>{floor === f.id ? '✓ ' : ''}{f.label}</span>
              <span className={styles.choiceNote}>{f.note}</span>
            </button>
          ))}
        </div>

        <button className={styles.go} onClick={start}>
          Frame it
        </button>
        </div>
      </div>
    </>
  )
}
