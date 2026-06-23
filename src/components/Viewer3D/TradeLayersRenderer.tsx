/**
 * TradeLayersRenderer — draws traced trade runs in the 3D scene as real pipe/
 * cable. Each run lives in a height band (under-floor / in-wall / ceiling) and
 * renders at that elevation; straight runs get a coupling at every stock-length
 * joint (10'/12'). Auto-risers connect bands where runs meet and drop open ends
 * down to the floor — so runs go vertical + horizontal, not just along the base.
 * Runs are placed with the same overlay transform as the walls.
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { plumbingColor, electricalColor, hvacColor } from '../../data/traceLayers'
import { useExplodeChildren } from './explodeRuntime'
import type { TracedLine } from '../../types'

const UP = new THREE.Vector3(0, 1, 0)
const FLOOR_Y = 0.06
const BAND_Y: Record<string, number> = {
  // Was -0.25 (in the joist space BELOW the floor) — which meant plumbing was
  // hidden under the deck/print and read as "not rendering". Lift it just above
  // the print plane so the run is visible while you work (electrical/HVAC are
  // already up at in-wall/ceiling). Realistic depth can return via the explode
  // peel later; for now visibility wins ("so long as it renders and can be seen").
  'under-floor': 0.12,
  'in-wall': 1.2,        // mid-wall
  'ceiling': 2.5,        // near the top plate
}
const bandY = (l: TracedLine, fallback: string) => BAND_Y[l.band ?? fallback] ?? BAND_Y['in-wall']

/** A straight run as a single pipe with couplings at each stock joint. */
function PipeRun({ a, b, color, radius, stickM, coupling, glow = 0 }: {
  a: THREE.Vector3; b: THREE.Vector3; color: string
  radius: number; stickM: number; coupling: boolean; glow?: number
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
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.15} emissive={color} emissiveIntensity={glow} />
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

const GALV = '#c9ced6'         // bare galvanised sheet metal
const HANGER_SPACING = 1.2     // strap hanger every ~4'

/**
 * An HVAC duct as shiny galvanised metal — a RECTANGULAR trunk (Supply/Return/
 * Exhaust) or a ROUND branch (Branch / Flex), hung from above on strap hangers.
 */
function DuctRun({ a, b, element, sizeM }: { a: THREE.Vector3; b: THREE.Vector3; element: string; sizeM: number }) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.02) return null
  const ndir = dir.clone().normalize()
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const round = element === 'Branch / Flex'
  const ductW = round ? sizeM : sizeM
  const ductH = round ? sizeM : sizeM * 0.7
  const perp = new THREE.Vector3().crossVectors(ndir, UP).normalize()
  const hangers = Math.max(1, Math.floor(len / HANGER_SPACING))
  return (
    <group>
      {round ? (
        <mesh position={mid} quaternion={new THREE.Quaternion().setFromUnitVectors(UP, ndir)} castShadow>
          <cylinderGeometry args={[sizeM / 2, sizeM / 2, len, 16]} />
          <meshStandardMaterial color={GALV} roughness={0.24} metalness={0.92} />
        </mesh>
      ) : (
        <mesh position={mid} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ndir)} castShadow>
          <boxGeometry args={[ductW, ductH, len]} />
          <meshStandardMaterial color={GALV} roughness={0.24} metalness={0.92} />
        </mesh>
      )}
      {Array.from({ length: hangers }, (_, i) => {
        const p = new THREE.Vector3().lerpVectors(a, b, (i + 0.5) / hangers)
        const topY = p.y + ductH / 2
        return (
          <group key={i}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[p.x + perp.x * (ductW / 2) * s, topY + 0.12, p.z + perp.z * (ductW / 2) * s]}>
                <boxGeometry args={[0.012, 0.24, 0.012]} />
                <meshStandardMaterial color={GALV} roughness={0.3} metalness={0.9} />
              </mesh>
            ))}
            <mesh position={[p.x, p.y - ductH / 2 - 0.01, p.z]} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), perp)}>
              <boxGeometry args={[ductW + 0.06, 0.012, 0.025]} />
              <meshStandardMaterial color={GALV} roughness={0.3} metalness={0.9} />
            </mesh>
          </group>
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
  const hvacLines = useAppStore((s) => s.hvacLines)
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
  const hvacRisers = useMemo(() => computeRisers(hvacLines, 'ceiling', hvacColor), [hvacLines])

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'mep')

  const showPlumb = visibleLayers.has('plumbing')
  const showElec = visibleLayers.has('electrical')
  const showHvac = visibleLayers.has('hvac')
  if (!drawing || (!showPlumb && !showElec && !showHvac)) return null
  if (plumbingLines.length === 0 && electricalLines.length === 0 && hvacLines.length === 0) return null

  const RiserMesh = ({ r, radius, glow = 0 }: { r: Riser; radius: number; glow?: number }) => {
    const c = toWorld(r.px, r.py, (r.lo + r.hi) / 2)
    return (
      <mesh position={c} castShadow>
        <cylinderGeometry args={[radius, radius, r.hi - r.lo, 10]} />
        <meshStandardMaterial color={r.color} roughness={0.5} metalness={0.15} emissive={r.color} emissiveIntensity={glow} />
      </mesh>
    )
  }

  return (
    <group name="trade-layers" ref={groupRef}>
      {showPlumb && plumbingLines.map((l) => (
        <PipeRun key={l.id} a={toWorld(l.x1, l.y1, bandY(l, 'under-floor'))} b={toWorld(l.x2, l.y2, bandY(l, 'under-floor'))}
          color={plumbingColor(l)} radius={0.02} stickM={stickM} coupling />
      ))}
      {showPlumb && plumbRisers.map((r, i) => <RiserMesh key={`pr-${i}`} r={r} radius={0.02} />)}
      {/* Electrical wires are exaggerated (thicker + a soft glow) so the runs
          stay readable while routing — you can orbit to find the best path. */}
      {showElec && electricalLines.map((l) => (
        <PipeRun key={l.id} a={toWorld(l.x1, l.y1, bandY(l, 'in-wall'))} b={toWorld(l.x2, l.y2, bandY(l, 'in-wall'))}
          color={electricalColor(l)} radius={0.013} stickM={stickM} coupling={false} glow={0.45} />
      ))}
      {showElec && elecRisers.map((r, i) => <RiserMesh key={`er-${i}`} r={r} radius={0.013} glow={0.45} />)}
      {/* HVAC ducts — shiny galvanised metal; rectangular trunks (Supply/Return/
          Exhaust) + round branches (Branch / Flex), hung from strap hangers. */}
      {showHvac && hvacLines.map((l) => (
        <DuctRun key={l.id} a={toWorld(l.x1, l.y1, bandY(l, 'ceiling'))} b={toWorld(l.x2, l.y2, bandY(l, 'ceiling'))}
          element={l.elementType} sizeM={(parseFloat(l.size) || 6) * 0.0254} />
      ))}
      {showHvac && hvacRisers.map((r, i) => <RiserMesh key={`hr-${i}`} r={r} radius={0.09} />)}
    </group>
  )
}
