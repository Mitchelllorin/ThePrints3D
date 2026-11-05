/**
 * DetectedWallsPanel — the walls the app found on this sheet, and the way to
 * throw them away.
 *
 * Detection reads ink. On a clean architectural PDF that is usually the building;
 * on a photo, a scan, or a print somebody has marked up, it is regularly not.
 * Until now there was no way to say so: the walls were in the model, in the
 * framing and in the takeoff, and the only cure was to start the job again and
 * hope. Two reports in one day — "it inferred the walls incorrectly and I want
 * to get rid of them", "select all" — are the same missing control.
 *
 * So they are shown: one row per detected wall, its length in real units where
 * the scale is known and in print pixels where it is not, All / None, and a
 * Remove that asks once. TRACED walls are not in this list at all — the user
 * drew those, and a panel that cannot reach them is what makes one tap to arm
 * and one to remove enough.
 *
 * Lives in the EDIT dock, with the other wall verbs, because that is what this
 * is: deciding a wall the app found is wrong and taking it off the model is the
 * same job as moving, stretching or deleting one. The dock's “Walls N” chip
 * opens it; Done, or Escape, puts it away.
 */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { ParsedWall } from '../../types'
import styles from './WorkspaceLayout.module.css'

/** Real length when the scale is known, print pixels when it is not — never a
 *  bare number, and never a guess dressed up as a measurement. */
function wallLength(w: ParsedWall, scaleMmPerPx: number | null): string {
  const px = Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
  if (!scaleMmPerPx) return `${Math.round(px)} px`
  const m = (px * scaleMmPerPx) / 1000
  return m >= 10 ? `${m.toFixed(0)} m` : `${m.toFixed(1)} m`
}

/** Which way it runs, in the drawing's own terms. A wall is one or the other
 *  often enough that it is worth a letter on a 360px row. */
function wallRuns(w: ParsedWall): string {
  return Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1) ? '↔' : '↕'
}

export default function DetectedWallsPanel({ onClose }: { onClose?: () => void }) {
  const drawings = useAppStore((s) => s.drawings)
  const overlayId = useAppStore((s) => s.floorplanOverlay.drawingId)
  const removeDetectedWalls = useAppStore((s) => s.removeDetectedWalls)
  const drawing = drawings.find((d) => d.id === overlayId) ?? drawings[0] ?? null
  const sheet = drawing?.id ?? null

  /** The detected walls, each with its index in `parsedWalls` — the same index
   *  the store action takes, so what is tapped is what is deleted. */
  const detected = useMemo(
    () => (drawing?.parsedWalls ?? [])
      .map((wall, at) => ({ wall, at }))
      .filter(({ wall }) => (wall.source ?? 'auto') !== 'user'),
    [drawing],
  )

  /**
   * THE SELECTION BELONGS TO A SHEET, so it is stored with that sheet's id
   * rather than cleared afterwards. A different plan has different walls, and a
   * selection carried across would delete something nobody chose; keying it means
   * the stale answer is simply never read, with no effect to synchronise.
   */
  const [sel, setSel] = useState<{ sheet: string | null; picked: number[] }>({ sheet: null, picked: [] })
  const picked = sel.sheet === sheet ? sel.picked : []
  const setPicked = (next: number[]) => setSel({ sheet, picked: next })

  /** Armed for one sheet, for a few seconds — never left loaded for a stray tap. */
  const [armedOn, setArmedOn] = useState<string | null>(null)
  const armed = armedOn !== null && armedOn === sheet
  useEffect(() => {
    if (!armedOn) return
    const t = window.setTimeout(() => setArmedOn(null), 4000)
    return () => window.clearTimeout(t)
  }, [armedOn])

  if (!drawing) return null

  const allPicked = detected.length > 0 && picked.length === detected.length
  const toggleOne = (at: number) => {
    setArmedOn(null)
    setPicked(picked.includes(at) ? picked.filter((x) => x !== at) : [...picked, at])
  }
  const setAll = (on: boolean) => {
    setArmedOn(null)
    setPicked(on ? detected.map((d) => d.at) : [])
  }
  const remove = () => {
    if (picked.length === 0) return
    if (!armed) { setArmedOn(sheet); return }
    removeDetectedWalls(drawing.id, picked)
    setArmedOn(null)
    setSel({ sheet, picked: [] })
  }

  return (
    <div>
      <div className={styles.layerRow}>
        <span className={styles.layerName}>
          Detected walls
          <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}> · {detected.length}</span>
        </span>
        <button
          className={`${styles.layerToggle} ${allPicked ? styles.layerToggleOn : ''}`}
          onClick={() => setAll(!allPicked)}
          disabled={detected.length === 0}
          aria-pressed={allPicked}
        >All</button>
        <button className={styles.layerToggle} onClick={() => setAll(false)} disabled={picked.length === 0}>None</button>
        {onClose && (
          <button className={`${styles.layerToggle} ${styles.layerToggleOn}`} onClick={onClose}>Done</button>
        )}
      </div>

      {detected.length === 0 ? (
        <p className={styles.sectionNote}>No detected walls on this sheet.</p>
      ) : (
        <>
          {/* Scrolls rather than clipping: a busy sheet reports forty of these and
              the panel must not run under the rows below it. */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {detected.map(({ wall, at }, i) => {
              const on = picked.includes(at)
              return (
                <button
                  key={at}
                  className={`${styles.layerRow} ${on ? styles.layerRowActive : ''}`}
                  onClick={() => toggleOne(at)}
                  aria-pressed={on}
                  title={`Wall ${i + 1} — ${wallLength(wall, drawing.scaleMmPerPx)}`}
                >
                  <span className={styles.layerToggle} aria-hidden="true">{on ? '✓' : ''}</span>
                  <span className={styles.layerName} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {i + 1}. {wallRuns(wall)} {wallLength(wall, drawing.scaleMmPerPx)}
                  </span>
                  <span className={styles.layerName} style={{ flex: '0 0 auto', opacity: 0.65 }}>
                    L{(wall.level ?? 0) + 1}
                  </span>
                </button>
              )
            })}
          </div>

          <button
            className={styles.specBtn}
            onClick={remove}
            disabled={picked.length === 0}
            style={armed ? { color: '#f87171' } : undefined}
          >
            {picked.length === 0
              ? 'Remove selected'
              : armed
                ? `Sure? Remove ${picked.length}`
                : `Remove ${picked.length} selected`}
          </button>
          <p className={styles.sectionNote}>
            Walls you traced are never in this list. Undo puts the removed ones back.
          </p>
        </>
      )}
    </div>
  )
}
