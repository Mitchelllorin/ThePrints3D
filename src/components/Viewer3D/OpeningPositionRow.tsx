/**
 * OpeningPositionRow — type where a door or window sits in its wall.
 *
 * "Window, 4′-6″ to centre from the left corner." That is how a print places an
 * opening and how it gets laid out on the plate, so it is how the app takes it:
 * a distance, typed, from a named end. Tapping on the wall got it roughly there;
 * this gets it exactly there. See services/openingLayout for what the number
 * measures and why.
 *
 * Mounted only while a door or window is selected, so the extra framing-plan
 * read costs nothing the rest of the time.
 */
import * as THREE from 'three'
import { useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { PlacedObject } from '../../types'
import { locateOpening, centreFromEnd, moveOpeningTo } from '../../services/openingLayout'
import { useWallPlans } from './useWallPlans'
import { worldDeltaToPixel } from './editMath'
import styles from './OpeningPositionRow.module.css'

const M_PER_IN = 0.0254

/** 4′-6″, to the nearest inch — the resolution a tape is read at on a plate. */
function ftIn(m: number): string {
  const total = Math.round(m / M_PER_IN)
  return `${Math.floor(total / 12)}′-${total % 12}″`
}

export default function OpeningPositionRow({ object }: { object: PlacedObject }) {
  const plans = useWallPlans()
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const drawings = useAppStore((s) => s.drawings)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)
  /** Measure from the left/top end (true) or the right/bottom one. */
  const [fromNear, setFromNear] = useState(true)
  const ftRef = useRef<HTMLInputElement>(null)
  const inRef = useRef<HTMLInputElement>(null)

  const spot = locateOpening(plans, object.id)
  if (!spot) {
    return (
      <p className={styles.note}>
        Not in a wall yet — drop it on a wall to type its position.
      </p>
    )
  }

  const dist = centreFromEnd(spot, fromNear)
  const totalIn = Math.round(dist / M_PER_IN)
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  const [nearEnd, farEnd] = spot.ends
  const end = fromNear ? nearEnd : farEnd
  const otherEnd = fromNear ? farEnd : nearEnd

  const commit = () => {
    const f = Number(ftRef.current?.value)
    const i = Number(inRef.current?.value)
    if (!Number.isFinite(f) || !Number.isFinite(i)) return
    const want = (f * 12 + i) * M_PER_IN
    if (Math.abs(want - dist) < M_PER_IN / 4) return
    const to = moveOpeningTo(spot, { x: object.x, z: object.z }, want, fromNear)
    // The print position is what the wall edits tow along, so it moves too —
    // by the same step, through the same transform every layer uses.
    const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0]
    const patch: Partial<PlacedObject> = { x: to.x, z: to.z }
    if (drawing && object.pxX != null && object.pxY != null) {
      const [dpx, dpy] = worldDeltaToPixel(
        to.x - object.x, to.z - object.z,
        THREE.MathUtils.degToRad(overlay.rotationDeg), overlay.scale[0], overlay.scale[1],
        drawing.rasterWidth ?? 1400, drawing.rasterHeight ?? 900,
      )
      patch.pxX = object.pxX + dpx
      patch.pxY = object.pxY + dpy
    }
    updatePlacedObject(object.id, patch)
    // A clamped move leaves the fields showing the typed number, so put back
    // what was actually done.
    const shown = Math.round(to.distM / M_PER_IN)
    if (ftRef.current) ftRef.current.value = String(Math.floor(shown / 12))
    if (inRef.current) inRef.current.value = String(shown % 12)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>Centre from the</span>
      <button
        type="button"
        className={styles.end}
        onClick={() => setFromNear((v) => !v)}
        aria-label={`Measuring from the ${end} end. Measure from the ${otherEnd} end instead`}
      >
        {end} end ⇄
      </button>
      <div className={styles.fields}>
        {/* Keyed on the value, so a move made anywhere else (drag, wall edit)
            refreshes the fields — and typing is never fought mid-keystroke,
            because nothing is written until the field is left. */}
        <input key={`f${ft}-${end}`} ref={ftRef} type="number" inputMode="numeric" min={0}
          className={styles.num} defaultValue={ft} onBlur={commit} onKeyDown={onKey}
          aria-label="Feet" />
        <span className={styles.unit}>ft</span>
        <input key={`i${inch}-${end}`} ref={inRef} type="number" inputMode="numeric" min={0} max={11}
          className={styles.num} defaultValue={inch} onBlur={commit} onKeyDown={onKey}
          aria-label="Inches" />
        <span className={styles.unit}>in</span>
      </div>
      <p className={styles.note}>
        Wall {spot.wall.index + 1}, {ftIn(spot.lengthM)} long · {ftIn(spot.lengthM - dist)} to the {otherEnd} end
      </p>
    </div>
  )
}
