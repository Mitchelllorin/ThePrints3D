/**
 * DRAW IT — type the building, get the building.
 *
 * The first question a job asks is how big it is, and until now the only way to
 * answer it here was to photograph a drawing and hope the app read the scale
 * off it. This asks instead. Four answers, three of them already filled in:
 * how wide, how deep, what the shell is framed from, and what goes underneath.
 *
 * Sizes are OUTSIDE FACE TO OUTSIDE FACE, the way a tape reads across a
 * building and the way a slab is quoted. Typed the way the trade writes them —
 * 40, 40', 40' 6", 40-6, 12.2m — because a field that only takes one of those
 * is a field that gets typed into wrong.
 *
 * A transient sheet the user opened, so it is allowed to be solid and to cross
 * the middle of the screen: it goes away in one tap and the model is behind it.
 */
import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { WALL_TYPES } from '../../data/members'
import { parseSizeMm, ftIn, type FloorChoice } from '../../services/drawnProject'
import styles from './DrawItSheet.module.css'

/** What a first footprint is, more often than not: a 40 x 30 single storey. */
const DEFAULT_WIDTH = "40'"
const DEFAULT_DEPTH = "30'"

const FLOORS: Array<{ id: FloorChoice; label: string; note: string }> = [
  { id: 'slab', label: 'Slab', note: '4" on grade' },
  { id: 'joists', label: 'Joists', note: '2×10 floor' },
  { id: 'none', label: 'Later', note: 'decide after' },
]

export default function DrawItSheet({ onClose }: { onClose: () => void }) {
  const startDrawnProject = useAppStore((s) => s.startDrawnProject)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [depth, setDepth] = useState(DEFAULT_DEPTH)
  const [wallTypeKey, setWallTypeKey] = useState('wood-2x6')
  const [floor, setFloor] = useState<FloorChoice>('slab')

  const widthMm = parseSizeMm(width)
  const depthMm = parseSizeMm(depth)
  // A building smaller than a shed or bigger than a city block is a typo.
  const sane = (mm: number | null) => mm !== null && mm >= 1000 && mm <= 120000
  const ready = sane(widthMm) && sane(depthMm)

  const start = () => {
    if (!ready) return
    startDrawnProject({ widthMm: widthMm!, depthMm: depthMm!, wallTypeKey, floor, name: 'New project' })
    onClose()
  }

  return (
    <>
      {/* The scrim carries no text and takes the tap that dismisses this. */}
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <div className={styles.sheet} role="dialog" aria-label="Draw it — start from typed sizes">
        <div className={styles.head}>
          <h2 className={styles.title}>Draw it</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className={styles.lead}>Outside face to outside face. Everything here is editable after.</p>

        <div className={styles.sizes}>
          <label className={styles.field}>
            <span className={styles.label}>Width</span>
            <input
              className={styles.input}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              inputMode="text"
              autoComplete="off"
              aria-label="Building width"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Depth</span>
            <input
              className={styles.input}
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              inputMode="text"
              autoComplete="off"
              aria-label="Building depth"
            />
          </label>
        </div>
        {/* Read the typed size back in feet and inches, so a mistyped unit shows
            up here rather than as a building the wrong size. */}
        <p className={ready ? styles.echo : styles.echoBad}>
          {ready
            ? `${ftIn(widthMm!)} × ${ftIn(depthMm!)}`
            : 'Type a size: 40, 40′, 40′ 6″, or 12.2m'}
        </p>

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

        <button className={styles.go} onClick={start} disabled={!ready}>
          Start drawing
        </button>
        <p className={styles.after}>Walls, doors and the roof come next — one step at a time.</p>
      </div>
    </>
  )
}
