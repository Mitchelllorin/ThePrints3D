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
import type { AttachSide, FootprintBox } from '../../services/footprint'
import FootprintPreview from './FootprintPreview'
import styles from './DrawItSheet.module.css'

/** What a first footprint is, more often than not: a 40 x 30 single storey. */
const DEFAULT_WIDTH = "40'"
const DEFAULT_DEPTH = "30'"

/** A section, as typed. Kept as text so a half-typed size does not wipe itself. */
interface WingDraft { id: number; width: string; depth: string; side: AttachSide; offset: string }

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
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [depth, setDepth] = useState(DEFAULT_DEPTH)
  const [wallTypeKey, setWallTypeKey] = useState('wood-2x6')
  const [floor, setFloor] = useState<FloorChoice>('slab')
  // MOST HOUSES ARE NOT ONE BOX. An L off the back, a garage on the side, a
  // bump-out for the dining room — each of those is a section hung off the main
  // one, and the walls follow the outline they make together.
  const [wings, setWings] = useState<WingDraft[]>([])

  const widthMm = parseSizeMm(width)
  const depthMm = parseSizeMm(depth)
  // A building smaller than a shed or bigger than a city block is a typo.
  const sane = (mm: number | null) => mm !== null && mm >= 1000 && mm <= 120000
  const mainOk = sane(widthMm) && sane(depthMm)

  // Only the sections that measure to something real are drawn or built; a
  // half-typed one waits rather than throwing the shape away.
  const boxes: FootprintBox[] = mainOk ? [
    { widthMm: widthMm!, depthMm: depthMm! },
    ...wings.flatMap((w) => {
      const ww = parseSizeMm(w.width), wd = parseSizeMm(w.depth)
      if (!sane(ww) || !sane(wd)) return []
      const off = w.offset.trim() === '' ? 0 : parseSizeMm(w.offset.replace(/^-/, ''))
      if (off === null) return []
      return [{ widthMm: ww!, depthMm: wd!, attach: { side: w.side, offsetMm: w.offset.trim().startsWith('-') ? -off : off } }]
    }),
  ] : []
  const ready = mainOk

  const addWing = () => setWings((ws) => [...ws, { id: Date.now(), width: "12'", depth: "14'", side: 'bottom', offset: '0' }])
  const setWing = (id: number, patch: Partial<WingDraft>) =>
    setWings((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  const dropWing = (id: number) => setWings((ws) => ws.filter((w) => w.id !== id))

  const start = () => {
    if (!ready) return
    startDrawnProject({
      widthMm: widthMm!, depthMm: depthMm!, wallTypeKey, floor, name: 'New project',
      wings: boxes.slice(1),
    })
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

        {/* The shape, drawn, while it is typed. */}
        {boxes.length > 0 && (
          <div className={styles.preview}>
            <FootprintPreview boxes={boxes} />
          </div>
        )}

        <span className={styles.label}>Sections</span>
        {wings.map((w, i) => (
          <div key={w.id} className={styles.wing}>
            <div className={styles.wingHead}>
              <span className={styles.wingName}>Section {i + 2}</span>
              <button className={styles.wingDrop} onClick={() => dropWing(w.id)} aria-label={`Remove section ${i + 2}`}>Remove</button>
            </div>
            <div className={styles.sizes}>
              <label className={styles.field}>
                <span className={styles.label}>Width</span>
                <input className={styles.input} value={w.width} onChange={(e) => setWing(w.id, { width: e.target.value })} aria-label={`Section ${i + 2} width`} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Depth</span>
                <input className={styles.input} value={w.depth} onChange={(e) => setWing(w.id, { depth: e.target.value })} aria-label={`Section ${i + 2} depth`} />
              </label>
            </div>
            <div className={styles.row}>
              {SIDES.map((sd) => (
                <button
                  key={sd.id}
                  className={`${styles.side} ${w.side === sd.id ? styles.chosen : ''}`}
                  onClick={() => setWing(w.id, { side: sd.id })}
                  aria-pressed={w.side === sd.id}
                >{w.side === sd.id ? '✓ ' : ''}{sd.label}</button>
              ))}
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Along that side, from the corner</span>
              <input className={styles.input} value={w.offset} onChange={(e) => setWing(w.id, { offset: e.target.value })} aria-label={`Section ${i + 2} offset`} />
            </label>
          </div>
        ))}
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

        <button className={styles.go} onClick={start} disabled={!ready}>
          Start drawing
        </button>
        <p className={styles.after}>Walls, doors and the roof come next — one step at a time.</p>
      </div>
    </>
  )
}
