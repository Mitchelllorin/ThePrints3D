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
import { getCatalogItem, VERTICAL_CIRCULATION } from '../../data/objectCatalog'
import type { ActiveUnit } from '../../store/useConfigStore'
import type { ParsedWall } from '../../types'

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
  const toggleGhostedLevel = useFloorplanLocalStore((s) => s.toggleGhostedLevel)

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
      <primitive
        object={framing}
        position={[cx, baseY, cz]}
        rotation={[0, -angle, 0]}
        onDoubleClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); toggleGhostedLevel(wall.level ?? 0) }}
      />
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
  const isolatedFloor = useFloorplanLocalStore((s) => s.isolatedFloor)
  const ghostedLevels = useFloorplanLocalStore((s) => s.ghostedLevels)

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

  // Assign each placed door/window to its nearest wall and record its position
  // (t, 0..1) and rough-opening width — so the live framing frames the opening
  // exactly where it sits, just like on site. Assignment is done in WORLD space
  // from the object's live x/z: that stays correct after a drag-move (which
  // updates x/z but not the cached pixel coords) and uses the same transform as
  // the wall geometry, so the opening can't drift off the wall.
  const openingsByWall = useMemo(() => {
    const out: Array<Array<{ t: number; widthM: number; type: 'door' | 'window'; sillM?: number; heightM?: number }>> = userWalls.map(() => [])
    // Wall segments in world space (same transform that places the framing).
    const wsegs = userWalls.map(({ wall: w }) => {
      const a = pixelToWorld(w.x1, w.y1), b = pixelToWorld(w.x2, w.y2)
      return { ax: a.x, az: a.z, dx: b.x - a.x, dz: b.z - a.z, thick: w.thickness }
    })
    // Average metres-per-pixel, to carry the pixel-derived snap tolerance into world.
    const mPerPx = (overlayW / imageWidth + overlayD / imageHeight) / 2
    // Nearest wall to a world point. `reach` (m) shifts the match from the wall
    // centreline to a footprint near-edge (stairs/shafts sit edge-on to a wall).
    const nearestWall = (wx: number, wz: number, reach: number, edgeBias: number) => {
      let best = -1, bestScore = Infinity, bestT = 0
      wsegs.forEach((s, i) => {
        const len2 = s.dx * s.dx + s.dz * s.dz
        if (len2 < 1e-6) return
        const t = ((wx - s.ax) * s.dx + (wz - s.az) * s.dz) / len2
        if (t < -0.02 || t > 1.02) return
        const fx = s.ax + t * s.dx, fz = s.az + t * s.dz
        const perp = Math.hypot(wx - fx, wz - fz)
        const score = reach > 0 ? Math.abs(perp - reach) : perp
        const thresh = Math.max((s.thick || 8) * 2.5, 28) * mPerPx + edgeBias
        if (score < thresh && score < bestScore) { best = i; bestScore = score; bestT = Math.max(0, Math.min(1, t)) }
      })
      return { best, t: bestT }
    }
    // Doors/windows: match by their centre.
    for (const o of placedObjects) {
      if (o.type !== 'door' && o.type !== 'window') continue
      const { best, t } = nearestWall(o.x, o.z, 0, 0)
      if (best < 0) continue
      const item = getCatalogItem(o.type)
      const widthM = (item?.defaultW ?? 0.9) * o.scaleX
      const heightM = (item?.defaultH ?? (o.type === 'door' ? 2.06 : 1.13)) * o.scaleY
      out[best].push({ t, widthM, type: o.type as 'door' | 'window', sillM: o.sillM, heightM })
    }
    // Stairs/elevators cut a full-height opening where they sit flush against a
    // wall. They're DEEP, so match by the footprint's near EDGE (centre minus
    // half-depth), not the centre — otherwise a stair's centre is always too far.
    for (const o of placedObjects) {
      if (!VERTICAL_CIRCULATION.has(o.type)) continue
      const item = getCatalogItem(o.type)
      const widthM = (item?.defaultW ?? 1) * o.scaleX           // along the wall (snap convention)
      const halfDepth = (item?.defaultD ?? 1) * o.scaleZ / 2    // half-depth toward the wall
      const { best, t } = nearestWall(o.x, o.z, halfDepth, 6 * mPerPx)
      if (best < 0) continue
      out[best].push({ t, widthM, type: 'door', sillM: 0, heightM: (item?.defaultH ?? 2.4) * o.scaleY })
    }
    return out
  }, [userWalls, placedObjects, pixelToWorld, overlayW, overlayD, imageWidth, imageHeight])

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
          opacity={(() => {
            const level = wall.level ?? 0
            if (isolatedFloor !== null && level !== isolatedFloor) return 0
            if (ghostedLevels.includes(level)) return 0.15
            return wall.transparent ? 0.16 : built ? 1 : 0.7
          })()}
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
