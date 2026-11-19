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
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import styles from './WallDimension.module.css'
import { freeArea, placeClear, regionOf } from './hudPlace'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

type P3 = [number, number, number]

const STOP_KINDS = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick'] as const
const stopHere = (e: Event) => e.stopPropagation()

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
/** Pixels off the line, so the chip never sits on the wall it measures. */
const SIDE_PX = 34
/** Keep the chip at least this far, along the wall, from the end you are moving. */
const END_CLEAR_PX = 120

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
   * WHERE THE CHIP SITS. It used to sit on the middle of the wall, which on a
   * short wall is right over the end you are dragging — the number covered the
   * point you were trying to place (Mitchell, 18 Nov). It now hangs off the
   * START of the wall, toward the end but never within END_CLEAR_PX of it, and
   * SIDE_PX off the line on its upper side; on a wall too short for that it
   * sits just behind the start. Placed in screen pixels each frame, so it holds
   * the same distance at any zoom.
   */
  const placeRef = useRef<HTMLDivElement | null>(null)
  const lastXY = useRef('')

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
  const lift: P3 = [start[0], start[1] + 0.02, start[2]]
  useFrame(({ camera, size, gl }) => {
    const el = placeRef.current
    if (!el) return
    _a.set(lift[0], lift[1], lift[2]).project(camera)
    _b.set(end[0], lift[1], end[2]).project(camera)
    const ax = (_a.x + 1) / 2 * size.width, ay = (1 - _a.y) / 2 * size.height
    const bx = (_b.x + 1) / 2 * size.width, by = (1 - _b.y) / 2 * size.height
    let dx = bx - ax, dy = by - ay
    const L = Math.hypot(dx, dy)
    if (L < 1) { dx = 1; dy = 0 } else { dx /= L; dy /= L }
    // The upper side of the line, so the number reads above the wall.
    let nx = -dy, ny = dx
    if (ny > 0) { nx = -nx; ny = -ny }
    const along = L > END_CLEAR_PX + 40 ? Math.min(L * 0.3, L - END_CLEAR_PX) : -56
    // In order: off the start toward the end, above the line; the same below
    // it; behind the start; square off the start either side. The first that
    // is clear of the end being dragged (and the loupe over it) and clear of
    // the rail and the top icons wins.
    const cands = [
      { x: dx * along + nx * SIDE_PX, y: dy * along + ny * SIDE_PX },
      { x: dx * along - nx * SIDE_PX, y: dy * along - ny * SIDE_PX },
      { x: -dx * 64 + nx * SIDE_PX, y: -dy * 64 + ny * SIDE_PX },
      { x: -dx * 64 - nx * SIDE_PX, y: -dy * 64 - ny * SIDE_PX },
      { x: nx * 64, y: ny * 64 },
      { x: -nx * 64, y: -ny * 64 },
      // Then anywhere round the start, further out.
      ...Array.from({ length: 12 }, (_, i) => ({ x: Math.cos(i * Math.PI / 6) * 96, y: Math.sin(i * Math.PI / 6) * 96 })),
    ]
    const box = { w: el.offsetWidth || 90, h: el.offsetHeight || 48 }
    const o = placeClear({ x: ax, y: ay }, cands, box, freeArea(size),
      [{ x: bx, y: by }, ...(useFloorplanLocalStore.getState().traceTouchDown ? [{ x: bx, y: by - 96 }] : []),
        ...[regionOf('[data-trace-ctx]', gl.domElement), regionOf('[data-trace-corner]', gl.domElement)].filter((r): r is NonNullable<typeof r> => !!r)], 56)
    const key = `${Math.round(o.x)},${Math.round(o.y)}`
    if (key !== lastXY.current) {
      lastXY.current = key
      el.style.transform = `translate(${Math.round(o.x)}px, ${Math.round(o.y)}px)`
    }
  })
  const len = Math.hypot(end[0] - start[0], end[2] - start[2])
  if (len < 0.05 && !typing) return null
  const barb = Math.min(0.35, len * 0.25)

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
      <Html position={lift} center zIndexRange={[10, 10]}>
        <div ref={placeRef}>
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
        </div>
      </Html>
    </>
  )
}
