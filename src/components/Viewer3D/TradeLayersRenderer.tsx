/**
 * TradeLayersRenderer — draws traced trade runs in the 3D scene as real pipe/
 * cable. Each run lives in a height band (under-floor / in-wall / ceiling) and
 * renders at that elevation; straight runs get a coupling at every stock-length
 * joint (10'/12'). Auto-risers connect bands where runs meet and drop open ends
 * down to the floor — so runs go vertical + horizontal, not just along the base.
 * Runs are placed with the same overlay transform as the walls.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { plumbingColor, electricalColor } from '../../data/traceLayers'
import type { TracedLine } from '../../types'

const UP = new THREE.Vector3(0, 1, 0)
const FLOOR_Y = 0.06
const BAND_Y: Record<string, number> = {
  'under-floor': -0.25,  // in the joist space below the floor
  'in-wall': 1.2,        // mid-wall
  'ceiling': 2.5,        // near the top plate
}
const bandY = (l: TracedLine, fallback: string) => BAND_Y[l.band ?? fallback] ?? BAND_Y['in-wall']

/** A straight run as a single pipe with couplings at each stock joint. */
function PipeRun({ a, b, color, radius, stickM, coupling }: {
  a: THREE.Vector3; b: THREE.Vector3; color: string
  radius: number; stickM: number; coupling: boolean
}) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.02) return null
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const joints = coupling ? Math.max(0, Math.ceil(len / stickM) - 1) : 0
  return (
    <group>
      <mesh position={mid} quaternion={quat} castShadow>
        <cylinderGeometry args={[radius, radius, len, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.15} />
      </mesh>
      {Array.from({ length: joints }, (_, i) => {
        const t = Math.min(1, ((i + 1) * stickM) / len)
        const p = new THREE.Vector3().lerpVectors(a, b, t)
        return (
          <mesh key={i} position={p} quaternion={quat}>
            <cylinderGeometry args={[radius * 1.6, radius * 1.6, radius * 3.2, 10]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
          </mesh>
        )
      })}
    </group>
  )
}

interface Riser { px: number; py: number; lo: number; hi: number; color: string }

/** Vertical connectors: where runs of different bands meet, and where an open
 *  end sits above the floor (a drop/stub). Keyed by shared pixel endpoint. */
function computeRisers(lines: TracedLine[], fallback: string, colorOf: (l: TracedLine) => string): Riser[] {
  const nodes = new Map<string, { px: number; py: number; ys: Set<number>; deg: number; color: string }>()
  for (const l of lines) {
    const y = bandY(l, fallback)
    for (const [px, py] of [[l.x1, l.y1], [l.x2, l.y2]] as const) {
      const key = `${Math.round(px)},${Math.round(py)}`
      let n = nodes.get(key)
      if (!n) { n = { px, py, ys: new Set(), deg: 0, color: colorOf(l) }; nodes.set(key, n) }
      n.ys.add(y); n.deg++
    }
  }
  const risers: Riser[] = []
  for (const n of nodes.values()) {
    const ys = [...n.ys]
    let lo = Math.min(...ys)
    const hi = Math.max(...ys)
    // Open end above the floor → drop a riser to the floor.
    if (n.deg === 1 && lo > FLOOR_Y + 0.02) lo = FLOOR_Y
    if (hi - lo > 0.06) risers.push({ px: n.px, py: n.py, lo, hi, color: n.color })
  }
  return risers
}

export default function TradeLayersRenderer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const pipeStickLengthFt = useConfigStore((s) => s.pipeStickLengthFt)
  const stickM = pipeStickLengthFt * 0.3048

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  const toWorld = useMemo(() => (px: number, py: number, y: number): THREE.Vector3 => {
    const localX = ((px / imageWidth) - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ).applyAxisAngle(UP, rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, y, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  const plumbRisers = useMemo(() => computeRisers(plumbingLines, 'under-floor', plumbingColor), [plumbingLines])
  const elecRisers = useMemo(() => computeRisers(electricalLines, 'in-wall', electricalColor), [electricalLines])

  const showPlumb = visibleLayers.has('plumbing')
  const showElec = visibleLayers.has('electrical')
  if (!drawing || (!showPlumb && !showElec)) return null
  if (plumbingLines.length === 0 && electricalLines.length === 0) return null

  const RiserMesh = ({ r, radius }: { r: Riser; radius: number }) => {
    const c = toWorld(r.px, r.py, (r.lo + r.hi) / 2)
    return (
      <mesh position={c} castShadow>
        <cylinderGeometry args={[radius, radius, r.hi - r.lo, 10]} />
        <meshStandardMaterial color={r.color} roughness={0.5} metalness={0.15} />
      </mesh>
    )
  }

  return (
    <group name="trade-layers">
      {showPlumb && plumbingLines.map((l) => (
        <PipeRun key={l.id} a={toWorld(l.x1, l.y1, bandY(l, 'under-floor'))} b={toWorld(l.x2, l.y2, bandY(l, 'under-floor'))}
          color={plumbingColor(l)} radius={0.013} stickM={stickM} coupling />
      ))}
      {showPlumb && plumbRisers.map((r, i) => <RiserMesh key={`pr-${i}`} r={r} radius={0.013} />)}
      {showElec && electricalLines.map((l) => (
        <PipeRun key={l.id} a={toWorld(l.x1, l.y1, bandY(l, 'in-wall'))} b={toWorld(l.x2, l.y2, bandY(l, 'in-wall'))}
          color={electricalColor(l)} radius={0.007} stickM={stickM} coupling={false} />
      ))}
      {showElec && elecRisers.map((r, i) => <RiserMesh key={`er-${i}`} r={r} radius={0.007} />)}
    </group>
  )
}
