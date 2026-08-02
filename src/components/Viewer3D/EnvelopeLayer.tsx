/**
 * EnvelopeLayer — the exterior skin on the user-traced walls: sheathing, then
 * housewrap over it. Toggleable in Settings, like the drywall it mirrors.
 *
 * Uses the SAME overlay transform as LiveWallsLayer / DrywallLayer, so the skin
 * lands on the walls whether or not the model has been "built" — the envelope is
 * a finish over the studs, exactly like drywall on the inside.
 *
 * ONLY EXTERIOR WALLS get it (see wallTakesEnvelope). Sheathing an interior
 * partition would be wrong and would bury the model in panels.
 *
 * WHICH WAY IS OUT? A wall is two points; nothing in the data says which face
 * meets the weather. The footprint's centroid answers it: for each wall, the
 * outward normal is whichever of its two perpendiculars points AWAY from the
 * middle of the building. That is exact for a convex footprint and right almost
 * everywhere on a real one; an L-shaped house can put one short wall's skin on
 * the wrong face, which is visible and fixable rather than silent. It beats the
 * alternative of sheathing both faces of every wall.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildWallEnvelope, buildWallCladding, FLOOR_ASSEMBLY_H, type WallOpening } from '../../services/framingGeometry'
import {
  sheathingLayer, wrbLayer, wallTakesEnvelope, wallFramingSpec, renderWallThicknessM, wallHeightM,
  claddingSpec, finishesVisible,
  type WrbKind, type WoodSheathing, type CladdingKind,
} from '../../services/constructionCode'
import { footprintCentroids, outwardSign, perimeterTest } from '../../services/wallFacing'
import { useExplodeChildren } from './explodeRuntime'
import { getCatalogItem } from '../../data/objectCatalog'
import type { ParsedWall, PlacedObject } from '../../types'

interface SkinProps {
  wall: ParsedWall
  pixelToWorld: (px: number, py: number) => THREE.Vector3
  wallHeight: number
  storeyHeight: number
  outward: 1 | -1
  wrapVisible: boolean
  wrbKind: WrbKind
  woodSheathing: WoodSheathing
  sheathe: boolean
  cladding: CladdingKind
  /** Per-storey fade: 0 hides, 0.15 ghosts, 1 is solid. Matches the walls and
   *  floors, so a faded storey fades as ONE building rather than a frame with a
   *  solid skin still hanging on it. */
  ghostOpacity: number
  openings: WallOpening[]
}

function WallSkin({ wall, pixelToWorld, wallHeight, storeyHeight, outward, wrapVisible, wrbKind, woodSheathing, sheathe, cladding, ghostOpacity, openings }: SkinProps) {
  const p1 = pixelToWorld(wall.x1, wall.y1)
  const p2 = pixelToWorld(wall.x2, wall.y2)
  const dx = p2.x - p1.x
  const dz = p2.z - p1.z
  const length = Math.hypot(dx, dz)
  const cx = (p1.x + p2.x) / 2
  const cz = (p1.z + p2.z) / 2
  const angle = Math.atan2(dz, dx)

  const spec = wallFramingSpec(wall.framingType, wall.wallRole)
  const thickness = renderWallThicknessM(wall)

  const skin = useMemo(() => {
    if (!sheathe) return null
    const g = buildWallEnvelope({
      length,
      height: wallHeight,
      thickness,
      outward,
      sheathing: sheathingLayer(spec.material, woodSheathing),
      // wrbLayer returns null for 'integrated' — the sheathing already carries the
      // barrier (ZIP System), so adding one would be wrong, not just redundant.
      wrb: wrapVisible ? wrbLayer(wrbKind) : null,
      openings,
      opacity: ghostOpacity,
    })
    g.userData.level = wall.level ?? 0   // so explode peels the skin per storey
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheathe, length, wallHeight, thickness, outward, spec.material, woodSheathing, wrapVisible, wrbKind, openings, wall.level, ghostOpacity])

  // Cladding sits on TOP of whatever is already on the wall, so its standoff is
  // the running total: stud face + sheathing + barrier + its own cavity. Brick's
  // cavity is why a brick wall's outside face lands ~4" further out than a sided
  // one — modelled, not approximated.
  const skinM = useMemo(() => {
    const sh = sheathingLayer(spec.material, woodSheathing)
    const wr = wrapVisible ? wrbLayer(wrbKind) : null
    return (sheathe ? sh.thicknessM : 0) + (sheathe && wr ? wr.thicknessM : 0)
  }, [spec.material, woodSheathing, wrapVisible, wrbKind, sheathe])

  const clad = useMemo(() => {
    const cs = claddingSpec(cladding)
    if (!cs) return null
    const g = buildWallCladding({
      length, height: wallHeight,
      standoff: Math.max(0.038, thickness) / 2 + skinM + cs.gapM,
      outward, spec: cs, openings, opacity: ghostOpacity,
    })
    g.userData.level = wall.level ?? 0
    return g
  }, [cladding, length, wallHeight, thickness, skinM, outward, openings, wall.level, ghostOpacity])

  useEffect(() => () => {
    clad?.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [clad])

  if (length < 0.05) return null
  const baseY = (wall.level ?? 0) * storeyHeight
  return (
    <>
      {skin && <primitive object={skin} position={[cx, baseY, cz]} rotation={[0, -angle, 0]} />}
      {clad && <primitive object={clad} position={[cx, baseY, cz]} rotation={[0, -angle, 0]} />}
    </>
  )
}

export default function EnvelopeLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const sheathingVisible = useUISettingsStore((s) => s.sheathingVisible)
  const wrapVisible = useUISettingsStore((s) => s.wrapVisible)
  const wrbKind = useUISettingsStore((s) => s.wrbKind)
  const woodSheathing = useUISettingsStore((s) => s.woodSheathing)
  const cladding = useUISettingsStore((s) => s.cladding)
  // Same per-storey fade the walls and floors honour. The skin used to render at
  // full opacity regardless, so fading or isolating a storey left its sheathing
  // and cladding sitting there solid — the fade "wasn't applying to the plywood".
  const finishTiming = useUISettingsStore((s) => s.finishTiming)
  const finishesApplied = useUISettingsStore((s) => s.finishesApplied)
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const isolatedFloor = useFloorplanLocalStore((s) => s.isolatedFloor)
  const ghostedLevels = useFloorplanLocalStore((s) => s.ghostedLevels)

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'walls')

  const wallHeight = useMemo(() => deriveWorkspaceSceneConfig(wizardInputs).wallHeightM, [wizardInputs])
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)

  const pixelToWorld = useMemo(() => (px: number, py: number): THREE.Vector3 => {
    const localX = ((px / imageWidth) - 0.5) * overlayW
    const localZ = ((py / imageHeight) - 0.5) * overlayD
    const v = new THREE.Vector3(localX, 0, localZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotRad)
    return new THREE.Vector3(overlay.position[0] + v.x, 0, overlay.position[1] + v.z)
  }, [imageWidth, imageHeight, overlayW, overlayD, rotRad, overlay.position])

  // Exterior walls only, in pixel space (the frame the footprint centroid uses).
  //
  // Exterior means BOTH: the role allows an envelope, AND the wall sits on the
  // perimeter of its storey. The role alone is not enough — every traced wall is
  // stamped 'exterior-bearing' by default, so trusting the label sheathed every
  // interior partition in the building. Requiring both means a mislabelled
  // partition is saved by its position, and a perimeter wall the user has
  // deliberately marked interior is still left alone.
  const skinWalls = useMemo(() => {
    const user: ParsedWall[] = []
    for (const d of drawings) {
      for (const w of d.parsedWalls) if (w.source === 'user') user.push(w)
    }
    const byLevel = new Map<number, ParsedWall[]>()
    for (const w of user) {
      const lv = w.level ?? 0
      const list = byLevel.get(lv) ?? []
      list.push(w)
      byLevel.set(lv, list)
    }
    const tests = new Map<number, (w: ParsedWall) => boolean>()
    for (const [lv, list] of byLevel) tests.set(lv, perimeterTest(list))
    return user.filter((w) =>
      wallTakesEnvelope(w.wallRole, w.framingType)
      && (tests.get(w.level ?? 0)?.(w) ?? false))
  }, [drawings])

  // Which way is out — shared with DrywallLayer via wallFacing, so sheathing and
  // drywall can never end up on the same face of a wall.
  const centroidByLevel = useMemo(() => footprintCentroids(skinWalls), [skinWalls])

  // Doors/windows cut the skin too, so a window is a hole rather than a pane
  // buried behind sheathing. Nearest-wall assignment, matching DrywallLayer.
  const openingsByWall = useMemo(() => {
    const out: WallOpening[][] = skinWalls.map(() => [])
    const holes = placedObjects.filter(
      (o: PlacedObject) => (o.type === 'door' || o.type === 'window') && o.pxX != null && o.pxY != null,
    )
    for (const o of holes) {
      const px = o.pxX as number, py = o.pxY as number
      let best = -1, bestPerp = Infinity, bestT = 0
      skinWalls.forEach((w, i) => {
        const ddx = w.x2 - w.x1, ddy = w.y2 - w.y1
        const len2 = ddx * ddx + ddy * ddy
        if (len2 < 1e-6) return
        const t = ((px - w.x1) * ddx + (py - w.y1) * ddy) / len2
        if (t < -0.02 || t > 1.02) return
        const perp = Math.hypot(px - (w.x1 + t * ddx), py - (w.y1 + t * ddy))
        const threshPx = Math.max((w.thickness || 8) * 2.5, 28)
        if (perp < threshPx && perp < bestPerp) { best = i; bestPerp = perp; bestT = Math.max(0, Math.min(1, t)) }
      })
      if (best < 0) continue
      const item = getCatalogItem(o.type)
      const w = skinWalls[best]
      const p1 = pixelToWorld(w.x1, w.y1), p2 = pixelToWorld(w.x2, w.y2)
      const lengthM = Math.hypot(p2.x - p1.x, p2.z - p1.z)
      out[best].push({
        centerM: bestT * lengthM,
        widthM: (item?.defaultW ?? 0.9) * o.scaleX,
        type: o.type as 'door' | 'window',
        sillM: o.sillM,
        heightM: (item?.defaultH ?? (o.type === 'door' ? 2.06 : 1.13)) * o.scaleY,
      })
    }
    return out
  }, [skinWalls, placedObjects, pixelToWorld])

  // The guardrail is not part of the envelope — it can be shown on bare studs, so
  // this layer stays mounted when only the rail is on.
  if (!finishesVisible(finishTiming, finishesApplied, traceMode)) return null
  if ((!sheathingVisible && cladding === 'none') || skinWalls.length === 0) return null

  return (
    <group name="envelope" ref={groupRef}>
      {skinWalls.map((w, i) => {
        const outward = outwardSign(w, centroidByLevel[w.level ?? 0])
        const level = w.level ?? 0
        const ghostOpacity = isolatedFloor !== null && level !== isolatedFloor ? 0
          : ghostedLevels.includes(level) ? 0.15
          : 1
        if (ghostOpacity === 0) return null
        return (
          <WallSkin
            key={`skin-${w.level ?? 0}-${i}`}
            wall={w}
            pixelToWorld={pixelToWorld}
            wallHeight={wallHeightM(w, wallHeight, storeyHeight)}
            storeyHeight={storeyHeight}
            outward={outward}
            wrapVisible={wrapVisible}
            wrbKind={wrbKind}
            woodSheathing={woodSheathing}
            sheathe={sheathingVisible}
            cladding={cladding}
            ghostOpacity={ghostOpacity}
            openings={openingsByWall[i]}
          />
        )
      })}
    </group>
  )
}
