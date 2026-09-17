/**
 * NameplateStrip — the fixed data plate for the 3D view.
 *
 * Real equipment carries a data plate in one place on the housing, and you
 * learn where to look once. This is that: a compact block in a fixed HUD
 * corner reading out the selected member's metrics in one unchanging field
 * order — member, depth, spacing, span, grade.
 *
 * It exists to replace the floating labels that hung in the air above every
 * wall. Those broke three rules between them: text sitting straight on the
 * canvas (unreadable the moment the model turns), labels overlapping each other
 * wherever two walls ran close, and — the one that actually matters — a whole
 * storey of floating dimensions standing in front of the model somebody opened
 * the app to look at.
 *
 * Nothing selected, nothing shown. Silence is the resting state; the plate is
 * for the thing you are working on.
 */
import { Fragment, useMemo } from 'react'
import styles from './NameplateStrip.module.css'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { wallNameplate, nameplateHasContent, type NameplateField } from '../../services/nameplate'
import type { ParsedWall } from '../../types'

/** Inches to mm — stud spacing is stored as the 16 or 24 people say out loud. */
const IN_MM = 25.4

function Rows({ fields }: { fields: NameplateField[] }) {
  return (
    <div className={styles.rows}>
      {fields.map((f) => (
        <Fragment key={f.key}>
          <span className={styles.label}>{f.label}</span>
          <span className={`${styles.value} ${f.value == null ? styles.empty : ''}`}>
            {/* An empty slot keeps its place. A dash says "not applicable
                here"; dropping the row lets the next field jump into the gap,
                which is the same bug as reordering the plate. */}
            {f.value ?? '—'}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

export default function NameplateStrip() {
  const drawings = useAppStore((s) => s.drawings)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)
  const studSpacingIn = useConfigStore((s) => s.studSpacingIn)
  const dimensionsMode = useUISettingsStore((s) => s.dimensionsMode)
  const selectedWallIndex = useFloorplanLocalStore((s) => s.selectedWallIndex)
  const panelOpen = useFloorplanLocalStore((s) =>
    s.buildDrawerOpen || s.settingsDrawerOpen || s.askDrawerOpen || s.placeDrawerOpen || s.railPanelOpen)

  /**
   * Walls are addressed by INDEX into the active drawing's list, not by id —
   * there is no id on a ParsedWall. So the plate reads the same drawing the
   * selection was made against: the first one carrying walls.
   */
  const active = useMemo(() => drawings.find((d) => (d.parsedWalls ?? []).length > 0) ?? null, [drawings])
  const wall: ParsedWall | null =
    selectedWallIndex == null ? null : (active?.parsedWalls ?? [])[selectedWallIndex] ?? null

  const fields = useMemo(() => {
    if (!wall) return null
    // Walls live in image-pixel space; the drawing carries the scale that turns
    // those into millimetres. Without a scale there is no span to report, and a
    // pixel count presented as a length would be worse than an empty slot.
    const mmPerPx = active?.scaleMmPerPx ?? 0
    const lengthM = mmPerPx > 0
      ? (Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) * mmPerPx) / 1000
      : 0
    return wallNameplate({
      framingType: wall.framingType,
      wallRole: wall.wallRole,
      lengthM,
      spacingMm: studSpacingIn * IN_MM,
      activeUnit,
      lengthFormat,
    })
  }, [wall, active, studSpacingIn, activeUnit, lengthFormat])

  // 'off' silences every readout in the app, including this one — it is the
  // same setting the floating labels answered to, so turning dimensions off
  // still means off.
  if (dimensionsMode === 'off') return null
  // A drawer or rail column is open over this corner. It covers the plate but
  // not all of it, so a sliver of "Grade —" peeked out underneath — and the
  // open panel is already showing this wall's details. Stand aside until it closes.
  if (panelOpen) return null
  if (!wall || !fields || !nameplateHasContent(fields)) return null

  return (
    <div className={styles.plate} role="status" aria-label="Selected member">
      <div className={styles.title}>{wall.wallRole ? `${wall.wallRole} wall` : 'Wall'}</div>
      <Rows fields={fields} />
    </div>
  )
}
