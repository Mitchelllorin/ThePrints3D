/**
 * WallDimension — the stretchy arrow on a wall being drawn, with its length on it.
 *
 * Drawing a wall used to be a thin line to the finger and a length readout at
 * the top of the screen — two places to look, and the number was not even the
 * length you would get, because it measured to the raw finger while the wall
 * squared itself on commit. Now the dimension sits ON the wall, the way it sits
 * on a print: an arrow end to end that stretches as you drag, reading live feet
 * and inches, measured to the squared end that will actually be built.
 *
 * AND YOU CAN TYPE IT. Drawing is the easy way and gets you close; the number is
 * how you get it exact. Tap the length, type 12 6, and the wall goes down at
 * 12′-6″ in the direction you were drawing, then carries on from its end like any
 * other. Same parser as Draw it, so 12, 12 6, 12'6" and 3.6 m all read.
 */
import { useCallback, useRef, useState } from 'react'
import { Html, Line } from '@react-three/drei'
import styles from './WallDimension.module.css'

type P3 = [number, number, number]

const STOP_KINDS = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick'] as const
const stopHere = (e: Event) => e.stopPropagation()

/** Arrowhead barbs at `tip`, pointing away from `from`. */
function barbs(from: P3, tip: P3, len: number): [P3, P3, P3] {
  const theta = Math.atan2(tip[2] - from[2], tip[0] - from[0]) + Math.PI
  const a = (25 * Math.PI) / 180
  return [
    [tip[0] + Math.cos(theta + a) * len, tip[1], tip[2] + Math.sin(theta + a) * len],
    tip,
    [tip[0] + Math.cos(theta - a) * len, tip[1], tip[2] + Math.sin(theta - a) * len],
  ]
}

export default function WallDimension({
  start, end: liveEnd, endPixel, color, label, onTyped,
}: {
  start: P3
  end: P3
  /** The same end, in print pixels — the direction a typed length is laid along. */
  endPixel: [number, number]
  color: string
  /** The live length, already formatted in the user's units. */
  label: string
  /** A length was typed, toward `endPixel`. Returns false when it could not be read. */
  onTyped: (text: string, endPixel: [number, number]) => boolean
}) {
  /** While typing, the arrow holds still where it was pointing when you tapped
   *  it — otherwise the chip you are typing into chases the pointer. */
  const [typing, setTyping] = useState<{ end: P3; endPixel: [number, number] } | null>(null)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)
  const chipRef = useRef<HTMLDivElement | null>(null)

  /**
   * The label lives in the canvas's own container, so a tap on it would ALSO
   * reach the workspace underneath and drop a wall end where the chip is. React
   * stopPropagation runs too late for that — the 3D layer listens natively — so
   * it is stopped natively, at the chip. A callback ref, because the chip comes
   * and goes with the arrow and an effect would only ever see the first one.
   */
  const attachChip = useCallback((el: HTMLDivElement | null) => {
    const prev = chipRef.current
    if (prev) STOP_KINDS.forEach((k) => prev.removeEventListener(k, stopHere))
    chipRef.current = el
    if (el) STOP_KINDS.forEach((k) => el.addEventListener(k, stopHere))
  }, [])

  const end = typing?.end ?? liveEnd
  const len = Math.hypot(end[0] - start[0], end[2] - start[2])
  if (len < 0.05 && !typing) return null
  const barb = Math.min(0.35, len * 0.25)
  const mid: P3 = [(start[0] + end[0]) / 2, start[1] + 0.02, (start[2] + end[2]) / 2]

  const submit = () => {
    if (typing && onTyped(draft, typing.endPixel)) { setTyping(null); setDraft(''); setBad(false) }
    else setBad(true)
  }

  return (
    <>
      <Line points={[start, end]} color={color} lineWidth={4} />
      {len >= 0.05 && (
        <>
          <Line points={barbs(start, end, barb)} color={color} lineWidth={4} />
          <Line points={barbs(end, start, barb)} color={color} lineWidth={4} />
        </>
      )}
      <Html position={mid} center zIndexRange={[10, 10]}>
        <div ref={attachChip} className={styles.chip}>
          {typing ? (
            <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit() }}>
              <input
                className={`${styles.input} ${bad ? styles.bad : ''}`}
                autoFocus
                inputMode="decimal"
                placeholder={label}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setBad(false) }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setTyping(null); setDraft('') } }}
                // Tapping away puts the number down; tapping Set does not count as away.
                onBlur={(e) => {
                  if (!chipRef.current?.contains(e.relatedTarget as Node | null)) { setTyping(null); setDraft('') }
                }}
                aria-label="Wall length — feet and inches, e.g. 12 6"
              />
              <button type="submit" className={styles.go}>Set</button>
            </form>
          ) : (
            <button
              type="button"
              className={styles.length}
              onClick={() => setTyping({ end: liveEnd, endPixel })}
              aria-label={`Length ${label}. Tap to type an exact length`}
            >
              {label}
            </button>
          )}
        </div>
      </Html>
    </>
  )
}
