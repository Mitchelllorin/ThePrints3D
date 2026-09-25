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
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useSceneConfig } from '../../store/useSceneConfig'
import { buildWallFraming, buildMasonryWall, FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { type PlannedWall } from '../../services/wallFramingPlan'
import { useWallPlans } from './useWallPlans'
import { XRAY_OPACITY } from './editHelpers'
import { applyMemberColours, applyTopPlatesHidden, ownedMaterial } from '../../services/memberColours'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useConfigStore } from '../../store/useConfigStore'
import { wallFigure, wallNameplate, wallTitle } from '../../services/nameplate'
import { useNameplateSource } from './nameplateRegistry'


interface WallMeshProps {
  /** Everything about this wall's framing — see wallFramingPlan. */
  plan: PlannedWall
  /** 0.7 while tracing (ghost), 1 once built (solid/real). */
  opacity: number
  /** Storey-to-storey rise, so upper-floor walls stack on the floor below. */
  storeyHeight: number
  /** Spread this wall's framing members apart to show the assembly. */
  detailExplode?: boolean
  /** This is the picked wall: its plate opens to full. */
  selected: boolean
}

/** Inches to mm — stud spacing is stored as the 16 or 24 people say out loud. */
const IN_MM = 25.4

function WallMesh({ plan, opacity, storeyHeight, detailExplode, selected }: WallMeshProps) {
  const toggleGhostedLevel = useFloorplanLocalStore((s) => s.toggleGhostedLevel)
  const { opts, length, angle, cx, cz, level, isMasonry, masonryKind } = plan

  // The plan is rebuilt whenever any wall changes; key the memo on this wall's
  // content so an untouched wall keeps its geometry.
  const optsKey = JSON.stringify(opts)
  const framing = useMemo(() => {
    let f: THREE.Group
    if (isMasonry) {
      // Block/brick has no studs — doors/windows cut a real hole, with a lintel.
      f = buildMasonryWall({ length: opts.length, height: opts.height, thickness: opts.thickness, openings: opts.openings, opacity, kind: masonryKind })
    } else {
      f = buildWallFraming({ ...opts, opacity })
    }
    f.userData.level = level  // so the shared explode lifts it floor-by-floor
    /**
     * THE DIRECTION THIS WALL COMES OFF IN.
     *
     * Perpendicular to its own face, in world coordinates — the way you would
     * actually pull it away from the building. Without it the shared explode
     * falls back to pushing every wall along the line from the model's centre
     * to its own, which throws it off square and diagonally: the radial scatter
     * the build rules rule out. See useExplodeChildren.
     *
     * Stored UNSIGNED. Which of the two perpendiculars points away from the
     * building depends on where the centre is, and the centre moves as the
     * model grows, so the runtime picks the sign each frame.
     */
    f.userData.explodeAxis = [-Math.sin(angle), 0, Math.cos(angle)]
    return f
    // `opts` is covered by optsKey — the object itself is new on every plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optsKey, isMasonry, masonryKind, opacity, level, angle])

  // Free the GPU geometry/material when this segment changes or unmounts.
  // The member colours are shared across every wall, so only the material a
  // mesh actually owns is freed.
  useEffect(() => () => {
    framing.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const m = ownedMaterial(o)
        if (m && !Array.isArray(m)) m.dispose()
      }
    })
  }, [framing])

  // Colour by member — a material swap on the built group, never a rebuild.
  const memberColours = useUISettingsStore((s) => s.memberColours)
  useLayoutEffect(() => { applyMemberColours(framing, memberColours) }, [framing, memberColours])
  const topPlatesHidden = useUISettingsStore((s) => s.topPlatesHidden)
  useLayoutEffect(() => { applyTopPlatesHidden(framing, topPlatesHidden) }, [framing, topPlatesHidden])

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

  // THE DATA PLATE, floating beside the wall — see FloatingNameplates. Real
  // rated values: the framed length is what gets cut, so that is the span.
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const lengthFormat = useConfigStore((s) => s.lengthFormat)
  const studSpacingIn = useConfigStore((s) => s.studSpacingIn)
  const fields = useMemo(() => wallNameplate({
    framingType: plan.wall.framingType,
    wallRole: plan.wall.wallRole,
    lengthM: length,
    spacingMm: studSpacingIn * IN_MM,
    activeUnit,
    lengthFormat,
  }), [plan.wall.framingType, plan.wall.wallRole, length, studSpacingIn, activeUnit, lengthFormat])
  useNameplateSource(`wall:${plan.index}`, length < 0.05 || opacity === 0 ? null : {
    object: framing,
    title: wallTitle(plan.wall.wallRole),
    figure: wallFigure(fields),
    fields,
    selected,
    warning: false,
  })

  if (length < 0.05) return null

  // Upper-floor walls stand on the floor below.
  const baseY = level * storeyHeight

  return (
    <>
      <primitive
        object={framing}
        position={[cx, baseY, cz]}
        rotation={[0, -angle, 0]}
        onDoubleClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); toggleGhostedLevel(level) }}
      />
      {/* The plate is not drawn here. This wall hands its figures to the one
          nameplate layout (useNameplateSource above), which floats it beside
          the wall and keeps it off every other plate. */}
    </>
  )
}

export default function LiveWallsLayer() {
  const model     = useAppStore((s) => s.model)
  const buildResult = useAppStore((s) => s.buildResult)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const visibleLayers = useAppStore((s) => s.visibleLayers)

  const selectedWallIndex = useFloorplanLocalStore((s) => s.selectedWallIndex)
  const wallDetailExplode = useFloorplanLocalStore((s) => s.wallDetailExplode)
  const isolatedFloor = useFloorplanLocalStore((s) => s.isolatedFloor)
  const ghostedLevels = useFloorplanLocalStore((s) => s.ghostedLevels)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'framing')

  const wallHeight = useSceneConfig(wizardInputs).wallHeightM
  // Storey-to-storey rise so level-1 walls stand on the 2nd-floor deck, etc.
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H

  // Traced walls AND detected ones, with their corners, tees, openings and
  // packs — all worked out in wallFramingPlan, where the cut list reaches it too.
  const plans = useWallPlans()

  // The traced walls ARE the build: instead of BuildingModel re-rendering them
  // through a different (engine) path that drops detail, the ghost walls persist
  // and simply go from semi-transparent (tracing) to solid (built). They keep
  // all their detail — steel channel/knockouts, block courses, blocking, framed
  // openings. BuildingModel skips walls when user walls exist (see there).
  const built = buildResult !== null || model.status === 'ready' || model.status === 'building'

  if (plans.length === 0) return null
  // The Framing switch in the Layers panel was wired to nothing — no renderer
  // has ever read `visibleLayers.has('framing')`, so turning it off left every
  // stud standing. Honouring it here also gives the obvious X-ray for free:
  // drop the framing and the drywall, sheathing and cladding stay up, because
  // each of those is its own layer with its own toggle.
  if (!visibleLayers.has('framing')) return null

  return (
    <group name="live-walls" ref={groupRef}>
      {plans.map((plan, i) => (
        <WallMesh
          key={i}
          plan={plan}
          opacity={(() => {
            const level = plan.level
            if (isolatedFloor !== null && level !== isolatedFloor) return 0
            // Per-wall X-ray before the storey ghost, matching every other
            // layer: your call on this wall beats a floor-wide setting.
            if (plan.wall.transparent) return XRAY_OPACITY
            if (ghostedLevels.includes(level)) return 0.15
            return built ? 1 : 0.7
          })()}
          storeyHeight={storeyHeight}
          detailExplode={wallDetailExplode && i === selectedWallIndex}
          selected={plan.index === selectedWallIndex}
        />
      ))}
    </group>
  )
}
