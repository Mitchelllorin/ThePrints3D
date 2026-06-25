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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { explodeRuntime } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import {
  buildFloorJoists, buildFloorDeck, FLOOR_SLAB_TYPES, SUBFLOOR_T, SLAB_T, FLOOR_ASSEMBLY_H,
  type FloorHole,
} from '../../services/framingGeometry'
import { joistProfile, ocToM, CEILING_TYPES } from '../../data/traceLayers'
import { VERTICAL_CIRCULATION, getCatalogItem } from '../../data/objectCatalog'
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
  /** Stairwell/shaft openings (area-local centred metres) to frame through this floor. */
  holes?: FloorHole[]
  /** Live drag offset (world X/Z) while this area is being moved. */
  offset?: [number, number]
  /** Pointer-down on the area — selects, then drags on the next press. */
  onDown?: (e: ThreeEvent<PointerEvent>) => void
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
function JoistPart({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight, holes, offset = [0, 0], onDown }: PartProps) {
  const { lenX, lenZ, centre } = areaDims(area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD)
  const isSlab = FLOOR_SLAB_TYPES.has(area.elementType)
  const holeKey = JSON.stringify(holes ?? [])
  const joists = useMemo(
    () => buildFloorJoists({ lenX, lenZ, element: area.elementType, ocM: ocToM(area.size), holes }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lenX, lenZ, area.elementType, area.size, holeKey],
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
      <primitive object={joists} position={[centre.x + offset[0], 0, centre.z + offset[1]]} rotation={[0, rotRad, 0]} onPointerDown={onDown} />
    </group>
  )
}

/** The plywood subfloor deck (individual sheets) + a sheet-count nameplate. */
function DeckPart({ area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight, holes, offset = [0, 0], onDown }: PartProps) {
  const { lenX, lenZ, centre } = areaDims(area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD)
  const holeKey = JSON.stringify(holes ?? [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deck = useMemo(() => buildFloorDeck({ lenX, lenZ, holes }), [lenX, lenZ, holeKey])
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
      <primitive
        object={deck}
        position={[centre.x + offset[0], -SUBFLOOR_T / 2, centre.z + offset[1]]}
        rotation={[0, rotRad, 0]}
        onPointerDown={onDown}
      />
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
  const placedObjects = useAppStore((s) => s.placedObjects)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const translateFloorsArea = useAppStore((s) => s.translateFloorsArea)
  const selectedArea = useFloorplanLocalStore((s) => s.selectedArea)
  const selectArea = useFloorplanLocalStore((s) => s.selectAreaExclusive)
  const [drag, setDrag] = useState<{ id: string; sx: number; sz: number; dx: number; dz: number } | null>(null)

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

  // Stairwell/shaft openings: a placed stair/elevator cuts the deck(s) ABOVE it
  // (upper-floor decks, level ≥ 1) whose footprint sits over it. Footprints are
  // converted from world into each area's local centred frame.
  const holesByArea: Record<string, FloorHole[]> = useMemo(() => {
    const map: Record<string, FloorHole[]> = {}
    const circ = placedObjects.filter((o) => VERTICAL_CIRCULATION.has(o.type))
    if (circ.length === 0) return map
    const cos = Math.cos(rotRad), sin = Math.sin(rotRad)
    for (const area of floorsAreas) {
      if ((area.level ?? 0) < 1) continue   // ground deck sits on grade — no shaft below
      const { lenX, lenZ, centre } = areaDims(area, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD)
      const hs: FloorHole[] = []
      for (const o of circ) {
        const item = getCatalogItem(o.type)
        const w = (item?.defaultW ?? 1) * o.scaleX
        const d = (item?.defaultD ?? 1) * o.scaleZ
        const dx = o.x - centre.x, dz = o.z - centre.z
        const localX = dx * cos + dz * sin
        const localZ = -dx * sin + dz * cos
        if (Math.abs(localX) < lenX / 2 + w / 2 && Math.abs(localZ) < lenZ / 2 + d / 2) {
          hs.push({ x: localX, z: localZ, w, d })
        }
      }
      if (hs.length) map[area.id] = hs
    }
    return map
  }, [placedObjects, floorsAreas, pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad])

  // World drag delta → pixel delta (un-rotate by overlay rotation, then scale).
  const worldDeltaToPixel = (dx: number, dz: number): [number, number] => {
    const c = Math.cos(-rotRad), s = Math.sin(-rotRad)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    return [(lx / overlayW) * imageWidth, (lz / overlayD) * imageHeight]
  }
  const onDownArea = (area: TracedLine) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (selectedArea?.kind === 'floor' && selectedArea.id === area.id) {
      setDrag({ id: area.id, sx: e.point.x, sz: e.point.z, dx: 0, dz: 0 })   // selected → start drag
    } else {
      selectArea('floor', area.id)
    }
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    setDrag({ ...drag, dx: e.point.x - drag.sx, dz: e.point.z - drag.sz })
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return
    e.stopPropagation()
    const [dpx, dpy] = worldDeltaToPixel(drag.dx, drag.dz)
    if (Math.hypot(dpx, dpy) > 0.5) translateFloorsArea(drag.id, dpx, dpy)
    setDrag(null)
  }
  const offsetFor = (id: string): [number, number] => (drag && drag.id === id ? [drag.dx, drag.dz] : [0, 0])

  if (!visibleLayers.has('floors') || floorsAreas.length === 0) return null

  const partProps = { pixelToWorld, imageWidth, imageHeight, overlayW, overlayD, rotRad, storeyHeight }
  // Ceiling-typed areas are rendered by CeilingLayer (at wall-top); skip them here.
  const structural = floorsAreas.filter((a) => !CEILING_TYPES.has(a.elementType))
  const decked = structural.filter((a) => !FLOOR_SLAB_TYPES.has(a.elementType))

  return (
    <>
      {drag && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <group name="floor-joists">
        {structural.map((area) => <JoistPart key={area.id} area={area} {...partProps} holes={holesByArea[area.id]} offset={offsetFor(area.id)} onDown={onDownArea(area)} />)}
      </group>
      <group name="floor-sheeting">
        {decked.map((area) => <DeckPart key={area.id} area={area} {...partProps} holes={holesByArea[area.id]} offset={offsetFor(area.id)} onDown={onDownArea(area)} />)}
      </group>
    </>
  )
}
