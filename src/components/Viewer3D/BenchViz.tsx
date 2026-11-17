/**
 * THE BENCH IN THE SCENE — the part, the break, and the camera that goes to it.
 *
 * The dashboard owns the numbers; this is the other half of the order: when the
 * member reaches factored resistance, the bench sweeps in, everything else fades
 * and the part is left standing on its own with the break visible in it.
 *
 * WHY THE FADE IS A SCENE TRAVERSAL AND NOT A LAYER TOGGLE. "Everything else
 * fades out over the sweep" cannot be done with the layer switches: those are
 * on/off, permanent, and the user's own. So the materials are dipped directly —
 * each one's original opacity and transparent flag saved before the first touch
 * and put back exactly. The bench's own group is skipped by identity, and the
 * objects that reach zero are hidden as well as made transparent, because a
 * transparent material still writes depth and would punch a hole in the bench
 * behind it.
 *
 * WHAT IS DRAWN. The beam, in two halves that meet at midspan, on two blocks —
 * because the failure is a rupture and a beam that breaks should break. Bending
 * takes both halves down from the joint; shear drops the end that split. The
 * heat glow lives on a separate shell around the failing zone so the beam keeps
 * its own shading and its shape (a white-hot silhouette is not a failure, it is
 * a bug), and the char is a colour change on the beam's own material, not a
 * second object.
 *
 * WHERE THE PART LANDS. The canvas is the whole viewport, and the dashboard /
 * failure card are DOM surfaces over its bottom edge. Centring the beam in the
 * raw canvas would park it behind that chrome, so the projection is shifted up
 * by half the chrome's height (see benchViewOffsetPx): the part ends centred in
 * the band that is actually visible, which is what the acceptance test measures.
 * The offset is cleared on reset, so the camera the user left is the camera they
 * get back.
 *
 * NOTHING HERE RUNS PER FRAME IN REACT. The ramp already re-renders the panel at
 * ~11 Hz; this component writes to materials, transforms and the camera inside
 * `useFrame`, and React sees the store only when the break lands, the specimen
 * changes or the panel opens.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useBenchStore } from '../../store/useBenchStore'
import { arenaRoster, isRateable } from '../../services/arena'
import {
  BENCH_SWEEP_SECONDS, BENCH_Y, benchBeam, benchPose, benchViewOffsets, easeInOut, lerpPose,
  type BenchPose,
} from '../../services/arena/bench'
import { cameraControls } from './cameraControls'

const WOOD = new THREE.Color('#c9a978')
const CHAR = new THREE.Color('#14100c')
const HOT = new THREE.Color('#ff7a33')

/** Metres a puffed smoke grain climbs over the burn. */
const SMOKE_RISE = 1.1

export default function BenchViz() {
  const open = useBenchStore((s) => s.open)
  const specimenId = useBenchStore((s) => s.specimenId)
  const spanFt = useBenchStore((s) => s.setup.spanFt)
  const breakState = useBenchStore((s) => s.break)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)
  const { scene, camera, size } = useThree()

  const specimen = useMemo(
    () => arenaRoster().find((s) => s.id === specimenId && isRateable(s)) ?? null,
    [specimenId],
  )
  const beam = specimen ? benchBeam(specimen, spanFt) : null

  const benchRef = useRef<THREE.Group>(null)
  const halfL = useRef<THREE.Group>(null)
  const halfR = useRef<THREE.Group>(null)
  const puffRefs = useRef<Array<THREE.Mesh | null>>([])

  const beamMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: WOOD.clone(), roughness: 0.78, metalness: 0.02,
  }), [])
  const supportMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#8b8f96', roughness: 0.9, metalness: 0.1,
  }), [])
  const hotMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: HOT.clone(), transparent: true, opacity: 0, depthWrite: false,
  }), [])
  const smoke = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({
      seed: i / 5,
      mat: new THREE.MeshBasicMaterial({ color: '#6f6f6f', transparent: true, opacity: 0, depthWrite: false }),
    })),
    [],
  )

  useEffect(() => () => {
    beamMat.dispose(); supportMat.dispose(); hotMat.dispose()
    smoke.forEach((s) => s.mat.dispose())
  }, [beamMat, supportMat, hotMat, smoke])

  /* ── the visible band ───────────────────────────────────────────────────── */

  const viewOffsetX = useRef(0)
  const viewOffsetY = useRef(0)
  const lastMeasure = useRef(0)

  const clearView = useCallback(() => {
    if (viewOffsetX.current === 0 && viewOffsetY.current === 0) return
    viewOffsetX.current = 0
    viewOffsetY.current = 0
    camera.clearViewOffset()
  }, [camera])

  /**
   * How much of the canvas the bottom chrome owns, measured from the surfaces
   * themselves. The strip carries id `arena-strip`; the card `bench-fail-card`.
   * Both are DOM, so this is the one place the scene asks the page a question.
   */
  const chromeBottomPx = useCallback((canvasHeight: number) => {
    if (typeof document === 'undefined') return 0
    let top = canvasHeight
    for (const id of ['arena-strip', 'bench-fail-card']) {
      const el = document.getElementById(id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.height > 0) top = Math.min(top, r.top)
    }
    return Math.max(0, canvasHeight - top)
  }, [])

  const applyView = useCallback((force = false) => {
    const now = performance.now()
    if (!force && now - lastMeasure.current < 200) return
    lastMeasure.current = now
    if (!beam) return
    const aspect = size.width / Math.max(1, size.height)
    const pose = benchPose([0, BENCH_Y, 0], beam.lengthM, aspect)
    const off = benchViewOffsets(pose, beam, {
      widthPx: size.width,
      heightPx: size.height,
      chromeBottomPx: chromeBottomPx(size.height),
    })
    if (Math.abs(off.x - viewOffsetX.current) < 0.5 && Math.abs(off.y - viewOffsetY.current) < 0.5) return
    viewOffsetX.current = off.x
    viewOffsetY.current = off.y
    camera.setViewOffset(size.width, size.height, off.x, off.y, size.width, size.height)
  }, [beam, camera, chromeBottomPx, size.width, size.height])

  /* ── the fade ───────────────────────────────────────────────────────────── */

  const saved = useRef(new Map<string, { mat: THREE.Material; opacity: number; transparent: boolean }>())
  const hidden = useRef(new Map<THREE.Object3D, boolean>())

  const applyFade = useCallback((amount: number) => {
    const bench = benchRef.current
    scene.traverse((o) => {
      const obj = o as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
      if (!obj.material) return
      // Walk up to see whether this object lives inside the bench.
      let node: THREE.Object3D | null = o
      while (node) { if (node === bench) return; node = node.parent }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (!m) continue
        let entry = saved.current.get(m.uuid)
        if (!entry) {
          entry = { mat: m, opacity: m.opacity, transparent: m.transparent }
          saved.current.set(m.uuid, entry)
        }
        m.transparent = true
        m.opacity = entry.opacity * (1 - amount)
      }
      // Depth is not a suggestion: a zero-opacity mesh still occludes.
      const gone = amount >= 0.995
      if (gone) {
        if (!hidden.current.has(o)) hidden.current.set(o, o.visible)
        o.visible = false
      } else if (hidden.current.has(o)) {
        o.visible = hidden.current.get(o) ?? true
        hidden.current.delete(o)
      }
    })
  }, [scene])

  const restoreFade = useCallback(() => {
    for (const e of saved.current.values()) {
      e.mat.opacity = e.opacity
      e.mat.transparent = e.transparent
    }
    saved.current.clear()
    for (const [obj, was] of hidden.current) obj.visible = was
    hidden.current.clear()
  }, [])

  /** Put the beam back the way it was, before the next run. */
  const resetBurn = useCallback(() => {
    beamMat.color.copy(WOOD)
    beamMat.emissive.setRGB(0, 0, 0)
    hotMat.opacity = 0
    for (const ref of [halfL, halfR]) if (ref.current) ref.current.rotation.z = 0
    for (const s of smoke) { s.mat.opacity = 0 }
    for (const m of puffRefs.current) if (m) m.visible = false
  }, [beamMat, hotMat, smoke])

  /* ── the sweep and the burn ─────────────────────────────────────────────── */

  const phase = useRef<'idle' | 'sweep' | 'burn'>('idle')
  const clock = useRef(0)
  const from = useRef<BenchPose | null>(null)

  useEffect(() => {
    if (!breakState) {
      phase.current = 'idle'
      clock.current = 0
      restoreFade()
      resetBurn()
      clearView()
      return
    }
    const ctl = cameraControls.current
    from.current = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: ctl ? [ctl.target.x, ctl.target.y, ctl.target.z] : [0, BENCH_Y, 0],
    }
    phase.current = 'sweep'
    clock.current = 0
    // The card/strip are in the DOM by the time this effect runs, so measure
    // the visible band now rather than on the first frame.
    applyView(true)
  }, [breakState, camera, restoreFade, resetBurn, clearView, applyView])

  // A rotation or a window resize moves the band; re-measure while broken.
  useEffect(() => {
    if (!breakState) return
    applyView(true)
  }, [size.width, size.height, breakState, applyView])

  // The bench is a thing you opened; closing it puts the scene back.
  useEffect(() => () => { restoreFade(); resetBurn(); clearView() }, [restoreFade, resetBurn, clearView])

  useFrame((_, delta) => {
    const b = useBenchStore.getState().break
    if (!b || !beam) {
      if (phase.current !== 'idle') {
        phase.current = 'idle'
        restoreFade()
        resetBurn()
        clearView()
      }
      return
    }

    const aspect = size.width / Math.max(1, size.height)
    const centre: [number, number, number] = [0, BENCH_Y, 0]
    const target = benchPose(centre, beam.lengthM, aspect)

    if (phase.current === 'sweep') {
      applyView()
      clock.current = Math.min(BENCH_SWEEP_SECONDS, clock.current + delta)
      const k = easeInOut(clock.current / BENCH_SWEEP_SECONDS)
      setCameraPreset(lerpPose(from.current ?? target, target, k))
      applyFade(k)
      // Everything is gone by the time the part is centred; now it can burn.
      if (k >= 1) { phase.current = 'burn'; clock.current = 0; applyView(true) }
      return
    }

    if (phase.current !== 'burn') return
    clock.current += delta
    const t = clock.current

    // Heat first, then the char follows it — a part that goes black before it
    // glows reads as a texture swap rather than as something being loaded.
    const heat = Math.min(1, t / 0.85)
    hotMat.opacity = 0.9 * heat * (1 - 0.45 * heat)
    beamMat.emissive.copy(HOT).multiplyScalar(0.45 * heat * (1 - heat))

    const char = easeInOut(Math.min(1, Math.max(0, (t - 0.25) / 0.9)))
    beamMat.color.copy(WOOD).lerp(CHAR, char * 0.85)

    // The break itself: both halves drop from midspan for bending, one end
    // gives way at the support for shear. Small — 4° is a member that has
    // failed, not a mousetrap.
    const droop = THREE.MathUtils.degToRad(4) * easeInOut(Math.min(1, Math.max(0, (t - 0.2) / 0.8)))
    if (halfL.current) halfL.current.rotation.z = b.check === 'shear' ? -droop * 2.2 : -droop
    if (halfR.current) halfR.current.rotation.z = b.check === 'shear' ? 0 : droop

    const zoneX = b.check === 'shear' ? -beam.lengthM / 2 + 0.45 : 0
    for (let i = 0; i < smoke.length; i++) {
      const mesh = puffRefs.current[i]
      if (!mesh) continue
      const s = smoke[i]
      const rise = Math.min(1, Math.max(0, (t - 0.5 - s.seed * 0.35) / 1.6))
      mesh.visible = rise > 0
      s.mat.opacity = rise > 0 ? 0.5 * (1 - rise) : 0
      mesh.position.set(
        zoneX + (s.seed - 0.5) * 0.5 + rise * 0.25,
        beam.depthM * 0.4 + rise * SMOKE_RISE,
        (s.seed - 0.5) * 0.22,
      )
      mesh.scale.setScalar(0.7 + rise * 1.8)
    }
  })

  if (!open || !specimen || !beam) return null

  const zoneX = breakState?.check === 'shear' ? -beam.lengthM / 2 + 0.45 : 0
  const supportH = Math.max(0.1, BENCH_Y - beam.depthM / 2)

  return (
    <group ref={benchRef} name="bench" position={[0, BENCH_Y, 0]}>
      {/* Two halves, pivoting at their supports, so the break has somewhere to
          happen. The joint is the hidden seam in the middle. */}
      <group ref={halfL} position={[-beam.lengthM / 2, 0, 0]}>
        <mesh position={[beam.lengthM / 4, 0, 0]} material={beamMat} castShadow receiveShadow>
          <boxGeometry args={[beam.lengthM / 2, beam.depthM, beam.widthM]} />
        </mesh>
      </group>
      <group ref={halfR} position={[beam.lengthM / 2, 0, 0]}>
        <mesh position={[-beam.lengthM / 4, 0, 0]} material={beamMat} castShadow receiveShadow>
          <boxGeometry args={[beam.lengthM / 2, beam.depthM, beam.widthM]} />
        </mesh>
      </group>

      {/* The heat shell. Sits around the failing zone only, so the rest of the
          member keeps its own shading — the order is explicit that the failure
          must not become a white silhouette. */}
      <mesh material={hotMat} position={[zoneX, -beam.depthM * 0.15, 0]} renderOrder={2}>
        <boxGeometry args={[0.95, beam.depthM * 1.06, beam.widthM * 1.1]} />
      </mesh>

      {/* Bearing blocks. */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          material={supportMat}
          position={[s * beam.lengthM / 2, -beam.depthM / 2 - supportH / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.32, supportH, 0.4]} />
        </mesh>
      ))}

      {smoke.map((s, i) => (
        <mesh
          key={i}
          ref={(el) => { puffRefs.current[i] = el }}
          material={s.mat}
          visible={false}
          renderOrder={3}
        >
          <sphereGeometry args={[0.07, 8, 6]} />
        </mesh>
      ))}
    </group>
  )
}
