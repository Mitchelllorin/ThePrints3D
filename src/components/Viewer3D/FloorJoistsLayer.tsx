/**
 * FloorJoistsLayer — renders traced floor areas as a joist field + plywood
 * subfloor deck (or a concrete slab).
 *
 * The joists and the deck live in SEPARATE groups, and the explode view drives a
 * clean vertical PEEL: the sheets rise and the joists sink with the explode
 * slider, so you can see the subfloor lift off the joists (the money shot). The
 * deck is modelled as individual 4'×8' sheets with visible joints, and each area
 * carries a sheet COUNT nameplate for material takeoff.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { explodeRuntime } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import {
  buildFloorJoists, buildFloorDeck, FLOOR_SLAB_TYPES, SUBFLOOR_T, SLAB_T, FLOOR_ASSEMBLY_H,
} from '../../services/framingGeometry'
import { joistProfile, ocToM, CEILING_TYPES } from '../../data/traceLayers'
import type { FloorplanOverlayState } from '../../types'
import type { TracedLine } from '../../types'

const DECK_LIFT = 1.6     // metres the sheets rise at full explode
const JOIST_DROP = 0.7    // metres the joists sink at full explode
const FLOOR_SEP = 3.2     // extra rise PER STOREY at full explode (floor-by-floor)

// "Watch it build" install animation: joists pop in one-by-one, then the sheets.
const JOIST_PHASE = 0.8   // seconds to install all joists
const SHEET_PHASE = 0.8   // seconds to install all sheets
const DECK_DELAY  = 1.0   // sheets start after the joists are in
const INSTALL_RAMP = 0.25 // each member scales up over this long

/** Reveal a group's children one-by-one (scale 0→1) over `phase` seconds, after
 *  `delay`. Plays once per build; resets when the geometry is rebuilt. */
function useInstallReveal(group: THREE.Group, phase: number, delay = 0) {
  const start = useRef<number | null>(null)
  const done = useRef(false)
  useLayoutEffect(() => {
    start.current = null; done.current = false
    group.children.forEach((c) => c.scale.setScalar(0))
  }, [group])
  useFrame((state) => {
    if (done.current) return
    if (start.current === null) start.current = state.clock.elapsedTime
    const t = state.clock.elapsedTime - start.current - delay
    const kids = group.children
    const stagger = kids.length > 1 ? phase / kids.length : 0
    for (let i = 0; i < kids.length; i++) {
      kids[i].scale.setScalar(THREE.MathUtils.clamp((t - i * stagger) / INSTALL_RAMP, 0, 1))
    }
    if (t > phase + INSTALL_RAMP + 0.2) { kids.forEach((c) => c.scale.setScalar(1)); done.current = true }
  })
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
  })
}

interface AreaDims { lenX: number; lenZ: number; centre: THREE.Vector3 }

function areaDims(
  area: TracedLine,
  pixelToWorld: (px: number, py: number) => THREE.Vector3,
  imageWidth: number, imageHeight: number, overlayW: number, overlayD: number,
): AreaDims {
  const lenX = (Math.abs(area.x2 - area.x1) / imageWidth) * overlayW
  const lenZ = (Math.abs(area.y2 - area.y1) / imageHeight) * overlayD
  const centre = pixelToWorld((area.x1 + area.x2) / 2, (area.y1 + area.y2) / 2)
  return { lenX, lenZ, centre }
}

interface PartProps {
  area: TracedLine
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  imageWidth: number; imageHeight: number; overlayW: number; overlayD: number; rotRad: number
  storeyHeight: number
}

/** Vertical explode for one floor part: the within-floor PEEL (deck up / joists
 *  down) plus a per-storey lift so upper floors separate floor-by-floor. The
 *  group's Y is driven entirely here (never via a prop) to avoid a render race. */
function useFloorExplode(ref: React.RefObject<THREE.Group | null>, baseY: number, level: number, peel: number) {
  useFrame(() => {
    if (!ref.current) return
    const t = explodeRuntime.eased * explodeRuntime.spread
    ref.current.position.y = baseY + t * peel + level * t * FLOOR_SEP
  })
}

/** The structure: joist field, or a concrete slab. */
function JoistPart({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight }: PartProps) {
  const { lenX, lenZ, centre } = areaDims(area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD)
  const isSlab = FLOOR_SLAB_TYPES.has(area.elementType)
  const joists = useMemo(
    () => buildFloorJoists({ lenX, lenZ, element: area.elementType, ocM: ocToM(area.size) }),
    [lenX, lenZ, area.elementType, area.size],
  )
  const ref = useRef<THREE.Group>(null)
  // Deck top sits at this storey's elevation; the structure hangs below it.
  const level = area.level ?? 0
  const structureY = (isSlab ? -SLAB_T / 2 : -(SUBFLOOR_T + joistProfile(area.elementType).depth / 2))
  useFloorExplode(ref, level * storeyHeight + structureY, level, -JOIST_DROP)
  useEffect(() => () => disposeGroup(joists), [joists])
  useInstallReveal(joists, JOIST_PHASE)
  if (lenX < 0.1 || lenZ < 0.1) return null
  return (
    <group ref={ref}>
      <primitive object={joists} position={[centre.x, 0, centre.z]} rotation={[0, rotRad, 0]} />
    </group>
  )
}

/** The plywood subfloor deck (individual sheets) + a sheet-count nameplate. */
function DeckPart({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight }: PartProps) {
  const { lenX, lenZ, centre } = areaDims(area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD)
  const deck = useMemo(() => buildFloorDeck({ lenX, lenZ }), [lenX, lenZ])
  const labelColor = useUISettingsStore((s) => s.labelColor)
  const labelScale = useUISettingsStore((s) => s.labelScale)
  const ref = useRef<THREE.Group>(null)
  const level = area.level ?? 0
  useFloorExplode(ref, level * storeyHeight, level, DECK_LIFT)
  useEffect(() => () => disposeGroup(deck), [deck])
  useInstallReveal(deck, SHEET_PHASE, DECK_DELAY)
  if (lenX < 0.1 || lenZ < 0.1) return null
  const sheetCount = (deck.userData.sheetCount as number) ?? 0
  return (
    <group ref={ref}>
      <primitive object={deck} position={[centre.x, -SUBFLOOR_T / 2, centre.z]} rotation={[0, rotRad, 0]} />
      {sheetCount > 0 && (
        <Billboard position={[centre.x, 0.5, centre.z]}>
          <Text fontSize={0.26 * labelScale} color={labelColor} anchorX="center" anchorY="middle" outlineWidth={0.02 * labelScale} outlineColor="#0b1120">
            {`${sheetCount} sheets · 4×8`}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

export default function FloorJoistsLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay: FloorplanOverlayState = useAppStore((s) => s.floorplanOverlay)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)

  // Storey-to-storey rise = wall height + the floor assembly on top of it, so a
  // 2nd-floor deck's joists rest ON the lower wall's top plate.
  const storeyHeight = useMemo(
    () => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM + FLOOR_ASSEMBLY_H,
    [wizardInputs],
  )

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  const pixelToWorld = useMemo(() => (px: number, py: number): THREE.Vector3 => {
    const localX = ((px / imageWidth) - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  if (!visibleLayers.has('floors') || floorsAreas.length === 0) return null

  const partProps = { pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight }
  // Ceiling-typed areas are rendered by CeilingLayer (at wall-top); skip them here.
  const structural = floorsAreas.filter((a) => !CEILING_TYPES.has(a.elementType))
  const decked = structural.filter((a) => !FLOOR_SLAB_TYPES.has(a.elementType))

  return (
    <>
      <group name="floor-joists">
        {structural.map((area) => <JoistPart key={area.id} area={area} {...partProps} />)}
      </group>
      <group name="floor-sheeting">
        {decked.map((area) => <DeckPart key={area.id} area={area} {...partProps} />)}
      </group>
    </>
  )
}
