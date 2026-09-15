/**
 * THE PRINT GETS BORED AND WANDERS OFF.
 *
 * Leave the app open and untouched for long enough — past the idle spin, well
 * past the point where anyone is watching — and the drawing sprouts a pair of
 * small cartoon legs and walks out of the workspace. Touch anything at all and
 * it is instantly back where it was, flat on the grid, as if nothing happened
 * and it had never moved.
 *
 * Rules it plays by, because an easter egg that costs you work is not a joke:
 *
 *   • It only ever moves the print IMAGE, which is `noPick` — a picture, not a
 *     target. The tap-catcher, the trace handles and every coordinate the app
 *     reasons about live in other meshes and are untouched. Nothing this does
 *     can move a wall or mis-place a trace.
 *   • It never starts while there is work in progress. Tracing, calibrating,
 *     placing, editing — the caller passes `enabled: false` and this is inert.
 *   • The way back is a hard reset, not a return animation. One frame, and the
 *     transform is identity again. "Instantly, as though nothing happened"
 *     means the user must never be made to WAIT for their drawing.
 *   • It respects prefers-reduced-motion by simply never running.
 *
 * The only thing it renders when idle is its own children, unchanged.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * How long the workspace has to be untouched first.
 *
 * Deliberately far past IDLE_MS in ModelViewer (4s, the idle spin). The spin is
 * ambient and happens while you are still sitting there thinking; this should
 * only ever be found by someone who walked away and came back, or who left it
 * running on a desk. Too eager and it stops being a surprise and starts being a
 * thing the app does.
 */
const IDLE_BEFORE_WALK_MS = 45_000

/** Legs push up out of the sheet over this long, before the first step. */
const SPROUT_MS = 1_100

/**
 * Strides per second. A wander, not a sprint — and slower than it was.
 *
 * The joke only lands if you can SEE it happen. At 1.6 Hz over a 0.42 walk the
 * sheet was off the grid in about four seconds, so someone glancing back at the
 * viewport caught the tail of it and read the whole thing as the print
 * glitching out rather than strolling off. It is an end-of-shift gag; it should
 * amble.
 */
const STRIDE_HZ = 1.0

/**
 * Distance covered per second, as a share of the print's own longest side, so
 * a small screenshot and a large permit sheet take about the same time to
 * leave. An absolute speed would make one crawl and the other bolt.
 */
const WALK_SPEED_PER_SIZE = 0.24

/** Stop animating once it is this many print-lengths away — it is gone. */
const GONE_AT = 1.9

/**
 * IT HAS TO STAND UP FIRST.
 *
 * The print lies flat on the grid and the camera looks down at it, so legs
 * hanging underneath are hidden by the sheet itself — the first version of this
 * walked correctly and looked like a drawing sliding along the floor, which is
 * not a joke, it is a bug.
 *
 * So it gets up: the sheet tilts towards upright as the legs grow, and walks
 * off on its edge like every cartoon that ever did this. Not quite vertical —
 * dead-on 90 degrees goes edge-on and disappears at some camera angles, and a
 * slight lean reads as walking anyway.
 *
 * It also SHRINKS as it goes. A permit sheet is metres across, so standing one
 * upright fills the screen no matter where it walks — the first attempt marched
 * a wall of paper into the lens. Receding to a third of its size reads as
 * distance, keeps the whole sheet in frame, and is what makes it look like a
 * small thing wandering off rather than a large thing arriving.
 */
const WALK_AWAY_SCALE = 0.34
const STAND_RAD = Math.PI * 0.30

interface Props {
  /**
   * May it wander? False whenever the workspace is busy, the print is hidden,
   * or the caller would rather it sat still. Going false mid-stroll resets it
   * on the next frame.
   */
  enabled: boolean
  /** The print's plane size, used to scale the legs and the stride. */
  width: number
  depth: number
  children: React.ReactNode
}

/**
 * Two legs and two feet, drawn small and simple on purpose.
 *
 * `phase` swings them in opposition; a leg lifts a little at the front of its
 * swing so it reads as a step rather than a pendulum.
 */
function Legs({ size, phase, grown, hangFrom }: {
  size: number
  phase: number
  grown: number
  /** Local Y of the sheet's bottom edge once it is standing — where legs go. */
  hangFrom: number
}) {
  // Big enough to READ as legs. At 0.085/0.011 against a whole permit sheet
  // they were a couple of hairlines under a wall of paper — present in the
  // scene, invisible in the viewport, which is why the sheet looked like it was
  // gliding off on nothing.
  const legLen = size * 0.115
  const legR = size * 0.016
  const spread = size * 0.13
  const footLen = legLen * 0.5

  const leg = (side: 1 | -1) => {
    const swing = Math.sin(phase + (side === 1 ? 0 : Math.PI))
    // Lift on the forward half of the swing, so it steps instead of sliding.
    const lift = Math.max(0, Math.sin(phase + (side === 1 ? 0 : Math.PI))) * legLen * 0.18
    return (
      <group
        key={side}
        position={[side * spread, -legLen / 2 + lift, 0]}
        rotation={[swing * 0.55, 0, 0]}
      >
        <mesh userData={{ noPick: true }}>
          <cylinderGeometry args={[legR, legR, legLen, 8]} />
          <meshBasicMaterial color="#1f2937" />
        </mesh>
        {/* Foot — a squat box, pointing the way it is going. */}
        <mesh position={[0, -legLen / 2, footLen * 0.35]} userData={{ noPick: true }}>
          <boxGeometry args={[legR * 2.6, legR * 1.6, footLen]} />
          <meshBasicMaterial color="#111827" />
        </mesh>
      </group>
    )
  }

  return (
    <group scale={[1, grown, 1]} position={[0, hangFrom, 0]}>
      {leg(1)}
      {leg(-1)}
    </group>
  )
}

export default function PrintWalkabout({ enabled, width, depth, children }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const { gl } = useThree()

  const size = Math.max(width, depth) || 1

  /**
   * Anyone touching anything sends it home.
   *
   * Starts at 0, not `performance.now()` — reading a clock during render is
   * impure and the compiler is right to reject it. The effect below stamps it
   * on mount, and `useFrame` treats 0 as "not started yet" so the print cannot
   * set off in the frame before that happens.
   */
  const lastInput = useRef(0)
  /** When the current walk began; null when it is sitting still. */
  const startedAt = useRef<number | null>(null)
  /** Drives the legs. Kept in state only so they mount and unmount. */
  const [walking, setWalking] = useState(false)
  const [phase, setPhase] = useState(0)
  const [grown, setGrown] = useState(0)

  const reducedMotion = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  /**
   * A way to SEE it without waiting three quarters of a minute.
   *
   * In dev only: `__walkNow()` in the console sets it off this instant, and any
   * click still sends it home exactly as it would have. Tuning a cartoon by
   * waiting out the real timer between every tweak is how a gag ends up
   * half-finished.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __walkNow?: () => void }
    w.__walkNow = () => { lastInput.current = performance.now() - IDLE_BEFORE_WALK_MS - 1 }
    return () => { delete w.__walkNow }
  }, [])

  useEffect(() => {
    const el = gl.domElement
    // Monotonic, and only ever used to measure an elapsed gap.
    const touch = () => { lastInput.current = performance.now() }
    touch()
    const opts = { passive: true } as const
    // Every way a person can say "I am here" — including simply looking, since
    // a pointer crossing the canvas counts.
    el.addEventListener('pointerdown', touch, opts)
    el.addEventListener('pointermove', touch, opts)
    el.addEventListener('wheel', touch, opts)
    window.addEventListener('keydown', touch, opts)
    window.addEventListener('touchstart', touch, opts)
    return () => {
      el.removeEventListener('pointerdown', touch)
      el.removeEventListener('pointermove', touch)
      el.removeEventListener('wheel', touch)
      window.removeEventListener('keydown', touch)
      window.removeEventListener('touchstart', touch)
    }
  }, [gl])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    // 0 means the listeners have not mounted yet; that is not 'idle forever'.
    const idleFor = lastInput.current === 0 ? 0 : performance.now() - lastInput.current
    const may = enabled && !reducedMotion

    /**
     * HOME, IMMEDIATELY.
     *
     * Not eased, not tweened. The moment the conditions stop holding, the print
     * is exactly where it was — because the user has just reached for it and
     * the thing they reach for has to be there.
     */
    if (!may || idleFor < IDLE_BEFORE_WALK_MS) {
      if (startedAt.current !== null) {
        startedAt.current = null
        g.position.set(0, 0, 0)
        g.rotation.set(0, 0, 0)
        g.scale.setScalar(1)
        setWalking(false)
        setGrown(0)
        setPhase(0)
      }
      return
    }

    if (startedAt.current === null) {
      startedAt.current = performance.now()
      setWalking(true)
    }

    const t = (performance.now() - startedAt.current) / 1000
    const sprout = Math.min(1, (t * 1000) / SPROUT_MS)
    // Ease the legs out so they push up rather than pop.
    const grownNow = sprout * sprout * (3 - 2 * sprout)

    // Standing still while it gets to its feet, then off it goes.
    const walkT = Math.max(0, t - SPROUT_MS / 1000)
    const dist = walkT * size * WALK_SPEED_PER_SIZE
    if (dist > size * GONE_AT) return // gone; stop touching the transform

    const ph = walkT * STRIDE_HZ * Math.PI * 2

    /**
     * Standing up raises the sheet's middle by half its own height, so it has
     * to be lifted by that much or it stands with its legs through the floor.
     * The rest is the bob of the stride and a little sway.
     */
    // Shrink towards WALK_AWAY_SCALE over the first print-length of walking.
    const away = Math.min(1, dist / size)
    const scale = 1 - (1 - WALK_AWAY_SCALE) * away
    g.scale.setScalar(scale)

    // Standing up raises the sheet's middle by half its own height — measured
    // at the CURRENT scale, or it stands with its legs through the floor.
    const standH = (depth / 2) * scale * Math.sin(STAND_RAD) * grownNow
    const bob = Math.abs(Math.sin(ph)) * size * scale * 0.012
    g.position.set(dist * 0.6, standH + size * 0.03 * grownNow + bob, -dist * 0.5)
    g.rotation.set(STAND_RAD * grownNow, 0, Math.sin(ph) * 0.05)

    setGrown(grownNow)
    setPhase(ph)
  })

  return (
    <group ref={groupRef}>
      {children}
      {walking && <Legs size={size} phase={phase} grown={grown} hangFrom={-depth / 2} />}
    </group>
  )
}
