/**
 * TourGhost — someone doing the step, on the actual plan, while it is explained.
 *
 * Not a diagram. The points land on the real print at real coordinates, the
 * rubber band stretches between them exactly the way it does under your own
 * finger, and the wall or floor pops in at the end. There is no hand drawn:
 * you see the two points appear and the thing build itself, which is what a
 * person watching over your shoulder would see anyway. Visual, in place, and
 * repeating — you learn the gesture by watching it, then do it.
 *
 * It lives INSIDE the scene rather than as an overlay so it obeys the camera:
 * orbit the model and the demonstration orbits with it, because it is drawn on
 * the plan and not on the glass.
 *
 * Two hard rules:
 *  · It never touches the pointer. Nothing here is raycastable.
 *  · It stands down the moment a real point is placed — see TutorialCoach.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line, Html } from '@react-three/drei'

import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { TUTORIAL_STEPS, clampStep } from '../../services/tutorial'
import { LAYER_COLORS } from '../../data/traceLayers'

/** Seconds for one full demonstration. Long enough that the finished assembly
 *  is held up for a good couple of seconds — the flash was the complaint. */
const LOOP = 7.5
/** Just above the print so the ghost never z-fights with the sheet. */
const LIFT = 0.06

type Phase = { pointA: boolean; band: number; pointB: boolean; result: number; fade: number }

/** Where we are in the loop, as plain numbers the renderer can read. */
function phaseAt(t: number): Phase {
  const p = (v: number, a: number, b: number) => Math.max(0, Math.min(1, (v - a) / (b - a)))
  return {
    pointA: t > 0.06,
    band: p(t, 0.14, 0.5),          // stretches from A to B
    pointB: t > 0.5,
    result: p(t, 0.54, 0.74),       // the wall/floor arriving, rising as it goes
    fade: 1 - p(t, 0.93, 1),        // held, then dimmed just before the next pass
  }
}

export default function TourGhost() {
  const active = useFloorplanLocalStore((s) => s.tutorialActive)
  const rawStep = useFloorplanLocalStore((s) => s.tutorialStep)
  const traceStart = useFloorplanLocalStore((s) => s.traceStart)
  const traceStroke = useFloorplanLocalStore((s) => s.traceStroke)
  const overlay = useAppStore((s) => s.floorplanOverlay)

  const [t, setT] = useState(0)
  const elapsed = useRef(0)
  useFrame((_, delta) => {
    elapsed.current = (elapsed.current + delta) % LOOP
    setT(elapsed.current / LOOP)
  })

  const step = TUTORIAL_STEPS[clampStep(rawStep)]
  const kind = step?.demo

  /**
   * The two points, in world space, taken from the sheet the user is actually
   * looking at. A fixed fraction of the print rather than fixed metres, so the
   * demonstration is the same size relative to the plan whether it is a garage
   * or a four-bedroom house.
   */
  const pts = useMemo(() => {
    const [w, d] = overlay.scale
    const [cx, cz] = overlay.position
    if (!w || !d) return null
    // NEARLY THE WHOLE SHEET. The first pass boxed in about a third of the
    // print, which demonstrates the wrong thing: laying a floor means taking
    // the corners of the BUILDING, and a small box in the middle reads as some
    // other, smaller move. Inset just enough to sit inside the sheet margin.
    const ix = w * 0.40
    const iz = d * 0.36
    // Calibration is measured along ONE known edge, not across the building —
    // you pick two points you can put a real dimension between.
    if (kind === 'calibrate') {
      return {
        a: [cx - ix, LIFT, cz + iz] as [number, number, number],
        b: [cx + ix, LIFT, cz + iz] as [number, number, number],
      }
    }
    const a: [number, number, number] = [cx - ix, LIFT, cz - iz]
    const b: [number, number, number] = kind === 'wallRun'
      ? [cx + ix, LIFT, cz - iz]      // a wall runs the length of one side
      : [cx + ix, LIFT, cz + iz]      // a floor takes both far corners
    return { a, b }
  }, [overlay.scale, overlay.position, kind])

  // Nothing to demonstrate, no plan to demonstrate it on, or the user has
  // started for real — in every case, get out of the way.
  if (!active || !kind || !pts || !overlay.visible) return null
  if (traceStart || (traceStroke && traceStroke.length > 0)) return null

  const ph = phaseAt(t)
  /**
   * THE GHOST CANNOT WEAR WHITE.
   *
   * It used the layer's own colour, which is right for floors (a tan that reads
   * against everything) and useless for framing, whose colour is #ffffff — a
   * white translucent box laid over a pale grey print is invisible, and the
   * wall step looked like nothing happened at all. Real walls stay white; the
   * DEMONSTRATION of a wall borrows the accent, which reads over both the dark
   * grid and the sheet.
   */
  const colour = kind === 'wallRun' ? '#38bdf8'
    // The same amber the real calibration arrow uses (FloorplanOverlay), so the
    // demonstration and the thing being demonstrated are the same colour.
    : kind === 'calibrate' ? '#f59e0b'
    : LAYER_COLORS.floors
  const { a, b } = pts

  // Where the band's leading end has reached — this is the "finger", implied by
  // the line that follows it rather than drawn as a cursor.
  const tip: [number, number, number] = [
    a[0] + (b[0] - a[0]) * ph.band,
    LIFT,
    a[2] + (b[2] - a[2]) * ph.band,
  ]

  const rect: [number, number, number][] = [
    [a[0], LIFT, a[2]], [b[0], LIFT, a[2]], [b[0], LIFT, b[2]], [a[0], LIFT, b[2]], [a[0], LIFT, a[2]],
  ]

  return (
    <group raycast={() => null}>
      {/* Point one, dropped. */}
      {ph.pointA && <GhostPoint at={a} colour={colour} opacity={ph.fade} />}

      {/* The rubber band, stretching to where the finger is. */}
      {ph.band > 0 && ph.band < 1 && (
        <Line points={[a, tip]} color={colour} lineWidth={3} transparent opacity={0.85 * ph.fade} />
      )}

      {/* Point two. */}
      {ph.pointB && <GhostPoint at={b} colour={colour} opacity={ph.fade} />}

      {/* What it made. A wall stands up; a floor fills in. */}
      {/* The wall standing up out of the line you just drew. Solid enough to be
          unmistakable — this is the payoff of the step, not a hint. */}
      {ph.result > 0 && kind === 'wallRun' && (
        <>
          <mesh
            position={[(a[0] + b[0]) / 2, (2.4 * ph.result) / 2, a[2]]}
            raycast={() => null}
          >
            <boxGeometry args={[Math.abs(b[0] - a[0]), Math.max(0.001, 2.4 * ph.result), 0.16]} />
            <meshBasicMaterial color={colour} transparent opacity={0.55 * ph.fade} depthWrite={false} />
          </mesh>
          {/* Top plate line: gives the wall a hard edge against the sky so it
              reads as a wall rather than a coloured haze. */}
          <Line
            points={[[a[0], 2.4 * ph.result, a[2]], [b[0], 2.4 * ph.result, b[2]]]}
            color={colour}
            lineWidth={3}
            transparent
            opacity={0.95 * ph.fade}
          />
        </>
      )}
      {ph.result > 0 && kind === 'twoCorners' && (
        <>
          <Line points={rect} color={colour} lineWidth={2.5} transparent opacity={0.9 * ph.fade} />
          <GhostFloor a={a} b={b} colour={colour} grow={ph.result} fade={ph.fade} />
        </>
      )}

      {/* CALIBRATION: the pull is the whole answer — two points and the line
          between them. What arrives at the end is the DIMENSION, because the
          measurement is the thing being asked for; the line on its own is just
          a line, and the step's sentence is about knowing how big things are. */}
      {ph.result > 0 && kind === 'calibrate' && (
        <>
          <Line points={[a, b]} color={colour} lineWidth={4} transparent opacity={0.95 * ph.fade} />
          {/* Tick marks at each end, the way a dimension is drawn on a print. */}
          {[a, b].map((p, i) => (
            <Line
              key={i}
              points={[[p[0], LIFT, p[2] - 0.5], [p[0], LIFT, p[2] + 0.5]]}
              color={colour}
              lineWidth={3}
              transparent
              opacity={0.95 * ph.fade}
            />
          ))}
          <Html
            position={[(a[0] + b[0]) / 2, LIFT + 0.35, (a[2] + b[2]) / 2]}
            center
            style={{ pointerEvents: 'none' }}
          >
            <span style={{
              color: colour,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              opacity: ph.fade,
              textShadow: '0 1px 3px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.9)',
            }}>a known distance</span>
          </Html>
        </>
      )}
    </group>
  )
}

/**
 * The floor that gets built — a deck with JOISTS under it, lifted and tipped so
 * you can see the underside.
 *
 * A translucent rectangle flashing on the plan was not teaching anything: it
 * showed that something happened, not what. A floor is a deck carried on joists
 * at a spacing, and that is the whole idea the step is trying to land — so the
 * demonstration builds one, raises it off the plan, and tilts it just enough
 * that the ribs underneath come into view. You watch a floor get made, from
 * below, which is a thing you cannot see on a real job once it is down.
 */
function GhostFloor({ a, b, colour, grow, fade }: {
  a: [number, number, number]
  b: [number, number, number]
  colour: string
  /** 0 → 1 as the assembly arrives. */
  grow: number
  fade: number
}) {
  const w = Math.abs(b[0] - a[0])
  const d = Math.abs(b[2] - a[2])
  const cx = (a[0] + b[0]) / 2
  const cz = (a[2] + b[2]) / 2

  /** 16" on centre, the spacing the step's own picker is set to. */
  const OC = 0.4064
  const JOIST_W = 0.045
  const JOIST_H = 0.235
  const DECK = 0.05

  // Enough to read as a field of joists without building a thousand meshes on a
  // large plan — beyond that the eye cannot tell anyway.
  const joists = useMemo(() => {
    const n = Math.min(40, Math.max(3, Math.floor(w / OC)))
    const step = w / (n + 1)
    return Array.from({ length: n }, (_, i) => -w / 2 + step * (i + 1))
  }, [w])

  // Sits where a floor sits. It used to rise and tip itself to show the ribs,
  // which read as the floor falling over rather than as a look underneath —
  // the camera does that job now, once, after the real floor is laid.
  const rise = 0.1 + 0.05 * grow

  return (
    <group position={[cx, rise, cz]} raycast={() => null}>
      {/* The deck. */}
      <mesh raycast={() => null}>
        <boxGeometry args={[w, DECK, d]} />
        <meshBasicMaterial color={colour} transparent opacity={0.5 * fade} depthWrite={false} />
      </mesh>

      {/* The joists carrying it — the point of the whole picture. */}
      {joists.map((x) => (
        <mesh key={x} position={[x, -(DECK / 2 + JOIST_H / 2), 0]} raycast={() => null}>
          <boxGeometry args={[JOIST_W, JOIST_H, d]} />
          <meshBasicMaterial color={colour} transparent opacity={0.85 * fade} depthWrite={false} />
        </mesh>
      ))}

      {/* Rim joist, so the assembly reads as closed rather than as loose sticks. */}
      {[-d / 2 + JOIST_W / 2, d / 2 - JOIST_W / 2].map((z) => (
        <mesh key={z} position={[0, -(DECK / 2 + JOIST_H / 2), z]} raycast={() => null}>
          <boxGeometry args={[w, JOIST_H, JOIST_W]} />
          <meshBasicMaterial color={colour} transparent opacity={0.85 * fade} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** A dropped point: the same read as a real trace point, at half the confidence. */
function GhostPoint({ at, colour, opacity }: {
  at: [number, number, number]
  colour: string
  opacity: number
}) {
  return (
    <mesh position={at} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <circleGeometry args={[0.16, 20]} />
      <meshBasicMaterial color={colour} transparent opacity={0.95 * opacity} depthWrite={false} />
    </mesh>
  )
}
