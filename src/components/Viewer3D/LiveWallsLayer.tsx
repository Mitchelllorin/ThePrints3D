/**
 * LiveWallsLayer — renders user-traced walls as semi-transparent 3D blocks
 * in real time as the user traces on the 2D print overlay.
 *
 * Coordinate system: walls are stored in image-pixel space. We apply the
 * same transform as FloorplanOverlay (overlay position/scale/rotation) to
 * place them correctly in the world.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Billboard, Text } from '@react-three/drei'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildWallFraming, buildMasonryWall, FLOOR_ASSEMBLY_H, type WallOpening } from '../../services/framingGeometry'
import { wallFramingSpec } from '../../services/constructionCode'
import { formatMeasureMm, type LengthFormat } from '../../services/unitConverter'
import { getCatalogItem } from '../../data/objectCatalog'
import type { ActiveUnit } from '../../store/useConfigStore'
import type { ParsedWall, PlacedObject } from '../../types'

const MIN_THICKNESS = 0.1     // metres — minimum visible thickness
const DEFAULT_THICKNESS_MM = 140  // 2×4 stud + drywall both sides

interface WallMeshProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  scaleMmPerPx: number | null
  wallHeight: number
  material: 'wood' | 'steel'
  steelGauge: string
  topTrackStyle: 'shallow' | 'deep' | 'slotted' | 'double'
  deflectionGapMm: number
  /** Door/window openings on this wall, as {t along wall 0..1, width m, type}. */
  openings: Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>
  /** 0.7 while tracing (ghost), 1 once built (solid/real). */
  opacity: number
  /** True once the model is built — hides the tracing nameplate. */
  built: boolean
  activeUnit: ActiveUnit
  lengthFormat: LengthFormat
  /** This end meets another wall — extend it so the corner joins (no gap). */
  startCorner: boolean
  endCorner: boolean
  /** Storey-to-storey rise, so upper-floor walls stack on the floor below. */
  storeyHeight: number
  /** Spread this wall's framing members apart to show the assembly. */
  detailExplode?: boolean
}

function WallMesh({ wall, pixelToWorld, scaleMmPerPx, wallHeight, material, steelGauge, topTrackStyle, deflectionGapMm, openings, opacity, built, activeUnit, lengthFormat, startCorner, endCorner, storeyHeight, detailExplode }: WallMeshProps) {
  const labelColor = useUISettingsStore((s) => s.labelColor)
  const labelScale = useUISettingsStore((s) => s.labelScale)

  // Thickness first — it sets how far to extend ends into a corner.
  const mmPerPx = scaleMmPerPx ?? DEFAULT_THICKNESS_MM / (wall.thickness || 8)
  const thicknessM = Math.max(MIN_THICKNESS, ((wall.thickness || 8) * mmPerPx) / 1000)

  const a = pixelToWorld(wall.x1, wall.y1)
  const b = pixelToWorld(wall.x2, wall.y2)
  // Extend any end that meets another wall by half the thickness, so adjacent
  // stud cages overlap and the corner reads as joined instead of leaving a gap.
  const rawLen = Math.hypot(b.x - a.x, b.z - a.z) || 1
  const ux = (b.x - a.x) / rawLen, uz = (b.z - a.z) / rawLen
  const ext = thicknessM / 2
  const ax = a.x - (startCorner ? ux * ext : 0), az = a.z - (startCorner ? uz * ext : 0)
  const bx = b.x + (endCorner ? ux * ext : 0),   bz = b.z + (endCorner ? uz * ext : 0)

  const length = Math.hypot(bx - ax, bz - az)
  const cx = (ax + bx) / 2
  const cz = (az + bz) / 2
  const angle = Math.atan2(bz - az, bx - ax)

  // Masonry (CMU/brick/concrete) is a solid block; framed walls get studs.
  const isMasonry = wall.wallType === 'masonry-thick' || wall.framingType === 'cmu'
  const framing = useMemo(() => {
    const wallOpenings: WallOpening[] = openings.map((o) => ({ centerM: o.t * length, widthM: o.widthM, type: o.type, sillM: o.sillM, heightM: o.heightM }))
    let f: THREE.Group
    if (isMasonry) {
      // Block/brick has no studs — doors/windows cut a real hole, with a lintel.
      const ext = wall.exteriorMaterial
      const kind = ext === 'brick' || ext === 'exposedBrick' ? 'brick' : ext === 'stone' ? 'stone' : 'cmu'
      f = buildMasonryWall({ length, height: wallHeight, thickness: thicknessM, openings: wallOpenings, opacity, kind })
    } else {
      const heavyDuty = wall.wallRole === 'exterior-bearing' || wall.wallRole === 'interior-bearing'
      f = buildWallFraming({ length, height: wallHeight, thickness: thicknessM, material, heavyDuty, steelGauge, topTrackStyle, deflectionGapMm, openings: wallOpenings, opacity })
    }
    f.userData.level = wall.level ?? 0  // so the shared explode lifts it floor-by-floor
    return f
  }, [length, wallHeight, thicknessM, material, isMasonry, wall.wallRole, wall.exteriorMaterial, steelGauge, topTrackStyle, deflectionGapMm, openings, opacity, wall.level])

  // Free the GPU geometry/material when this segment changes or unmounts.
  useEffect(() => () => {
    framing.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [framing])

  // Detail explode — spread this wall's framing members apart (plates lift, the
  // faces/layers pull out through the thickness) so you can see the assembly;
  // snaps back when off. Studs keep their place along the length.
  useLayoutEffect(() => {
    const amount = detailExplode ? 1 : 0
    framing.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const base = (o.userData.basePos ??= o.position.clone()) as THREE.Vector3
        o.position.set(base.x, base.y * (1 + amount * 1.5), base.z * (1 + amount * 6))
      }
    })
  }, [framing, detailExplode])

  if (length < 0.05) return null

  // Upper-floor walls stand on the floor below.
  const baseY = (wall.level ?? 0) * storeyHeight

  return (
    <>
      <primitive object={framing} position={[cx, baseY, cz]} rotation={[0, -angle, 0]} />
      {/* Nameplate — the wall's real length while tracing; hidden once built. */}
      {!built && (
        <Billboard position={[cx, baseY + wallHeight + 0.28, cz]}>
          <Text fontSize={0.32 * labelScale} color={labelColor} anchorX="center" anchorY="middle" outlineWidth={0.025 * labelScale} outlineColor="#0b1120">
            {formatMeasureMm(length * 1000, activeUnit, lengthFormat)}
          </Text>
        </Billboard>
      )}
    </>
  )
}

export default function LiveWallsLayer() {
  const drawings  = useAppStore((s) => s.drawings)
  const overlay   = useAppStore((s) => s.floorplanOverlay)
  const model     = useAppStore((s) => s.model)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const buildResult = useAppStore((s) => s.buildResult)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  const steelGauge = useConfigStore((s) => s.steelGauge)
  const steelTrackTop = useConfigStore((s) => s.steelTrackTop)
  const steelDeflectionGapMm = useConfigStore((s) => s.steelDeflectionGapMm)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)

  const selectedWallIndex = useFloorplanLocalStore((s) => s.selectedWallIndex)
  const wallDetailExplode = useFloorplanLocalStore((s) => s.wallDetailExplode)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'framing')

  const wallHeight = useMemo(
    () => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM,
    [wizardInputs],
  )
  // Storey-to-storey rise so level-1 walls stand on the 2nd-floor deck, etc.
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth  = drawing?.rasterWidth  ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  // Same transform used by FloorplanOverlay so walls sit exactly on the print
  const pixelToWorld = useMemo(() => (px: number, py: number): THREE.Vector3 => {
    const localX = ((px / imageWidth)  - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(
      overlay.position[0] + v.x,
      0,
      overlay.position[1] + v.z,
    )
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  const userWalls = useMemo(() => {
    const out: Array<{ wall: ParsedWall; scaleMmPerPx: number | null }> = []
    for (const d of drawings) {
      for (const w of d.parsedWalls) {
        if (w.source === 'user') out.push({ wall: w, scaleMmPerPx: d.scaleMmPerPx })
      }
    }
    return out
  }, [drawings])

  // Which wall ends meet another wall (shared endpoint, ~4px tolerance) — those
  // are corners, and get extended so the framing joins instead of gapping.
  const cornerEnds = useMemo(() => {
    const key = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`
    const counts = new Map<string, number>()
    for (const { wall } of userWalls) {
      const k1 = key(wall.x1, wall.y1), k2 = key(wall.x2, wall.y2)
      counts.set(k1, (counts.get(k1) ?? 0) + 1)
      counts.set(k2, (counts.get(k2) ?? 0) + 1)
    }
    return userWalls.map(({ wall }) => ({
      start: (counts.get(key(wall.x1, wall.y1)) ?? 0) > 1,
      end: (counts.get(key(wall.x2, wall.y2)) ?? 0) > 1,
    }))
  }, [userWalls])

  // Assign each placed door/window to its nearest wall (in pixel space) and
  // record its position (t, 0..1) and rough-opening width — so the live framing
  // frames the opening exactly where the door/window sits, just like on site.
  const openingsByWall = useMemo(() => {
    const out: Array<Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>> = userWalls.map(() => [])
    const doors = placedObjects.filter(
      (o: PlacedObject) => (o.type === 'door' || o.type === 'window') && o.pxX != null && o.pxY != null,
    )
    for (const o of doors) {
      const px = o.pxX as number, py = o.pxY as number
      let best = -1, bestPerp = Infinity, bestT = 0
      userWalls.forEach(({ wall: w }, i) => {
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1
        const len2 = dx * dx + dy * dy
        if (len2 < 1e-6) return
        const t = ((px - w.x1) * dx + (py - w.y1) * dy) / len2
        if (t < -0.02 || t > 1.02) return
        const perp = Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy))
        const threshPx = Math.max((w.thickness || 8) * 2.5, 28)
        if (perp < threshPx && perp < bestPerp) { best = i; bestPerp = perp; bestT = Math.max(0, Math.min(1, t)) }
      })
      if (best < 0) continue
      const item = getCatalogItem(o.type)
      const widthM = (item?.defaultW ?? 0.9) * o.scaleX
      const heightM = (item?.defaultH ?? (o.type === 'door' ? 2.06 : 1.13)) * o.scaleY
      out[best].push({ t: bestT, widthM, type: o.type as 'door' | 'window', sillM: o.sillM, heightM })
    }
    return out
  }, [userWalls, placedObjects])

  // The traced walls ARE the build: instead of BuildingModel re-rendering them
  // through a different (engine) path that drops detail, the ghost walls persist
  // and simply go from semi-transparent (tracing) to solid (built). They keep
  // all their detail — steel channel/knockouts, block courses, blocking, framed
  // openings. BuildingModel skips walls when user walls exist (see there).
  const built = buildResult !== null || model.status === 'ready' || model.status === 'building'

  if (userWalls.length === 0) return null

  return (
    <group name="live-walls" ref={groupRef}>
      {userWalls.map(({ wall, scaleMmPerPx }, i) => {
        // Each wall renders as ITS OWN framing — material + gauge from the type
        // picked when it was traced — so picking steel for one wall never
        // re-skins the walls you already traced. Auto walls (no framingType)
        // fall back to the global config preference.
        const spec = wall.framingType ? wallFramingSpec(wall.framingType, wall.wallRole) : null
        const wallMaterial = spec ? spec.material : framingMaterial
        const wallGauge = spec?.gauge ?? steelGauge
        return (
        <WallMesh
          key={i}
          wall={wall}
          pixelToWorld={pixelToWorld}
          scaleMmPerPx={scaleMmPerPx}
          wallHeight={wallHeight}
          material={wallMaterial}
          steelGauge={wallGauge}
          topTrackStyle={steelTrackTop === 'double' ? 'deep' : steelTrackTop}
          deflectionGapMm={steelTrackTop === 'slotted' ? steelDeflectionGapMm : 0}
          openings={openingsByWall[i] ?? []}
          opacity={wall.transparent ? 0.16 : built ? 1 : 0.7}
          built={built}
          activeUnit={activeUnit}
          lengthFormat={lengthFormat}
          startCorner={cornerEnds[i]?.start ?? false}
          endCorner={cornerEnds[i]?.end ?? false}
          storeyHeight={storeyHeight}
          detailExplode={wallDetailExplode && i === selectedWallIndex}
        />
        )
      })}
    </group>
  )
}
