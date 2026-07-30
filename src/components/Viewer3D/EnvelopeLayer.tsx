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
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { buildWallEnvelope, FLOOR_ASSEMBLY_H, type WallOpening } from '../../services/framingGeometry'
import {
  sheathingLayer, wrbLayer, wallTakesEnvelope, wallFramingSpec, wallThicknessM,
  type WrbKind,
} from '../../services/constructionCode'
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
  openings: WallOpening[]
}

function WallSkin({ wall, pixelToWorld, wallHeight, storeyHeight, outward, wrapVisible, wrbKind, openings }: SkinProps) {
  const p1 = pixelToWorld(wall.x1, wall.y1)
  const p2 = pixelToWorld(wall.x2, wall.y2)
  const dx = p2.x - p1.x
  const dz = p2.z - p1.z
  const length = Math.hypot(dx, dz)
  const cx = (p1.x + p2.x) / 2
  const cz = (p1.z + p2.z) / 2
  const angle = Math.atan2(dz, dx)

  const spec = wallFramingSpec(wall.framingType, wall.wallRole)
  const thickness = wallThicknessM(wall.framingType)

  const skin = useMemo(() => {
    const g = buildWallEnvelope({
      length,
      height: wallHeight,
      thickness,
      outward,
      sheathing: sheathingLayer(spec.material),
      // wrbLayer returns null for 'integrated' — the sheathing already carries the
      // barrier (ZIP System), so adding one would be wrong, not just redundant.
      wrb: wrapVisible ? wrbLayer(wrbKind) : null,
      openings,
      opacity: 1,
    })
    g.userData.level = wall.level ?? 0   // so explode peels the skin per storey
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, wallHeight, thickness, outward, spec.material, wrapVisible, wrbKind, openings, wall.level])

  useEffect(() => () => {
    skin.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
    })
  }, [skin])

  if (length < 0.05) return null
  const baseY = (wall.level ?? 0) * storeyHeight
  return <primitive object={skin} position={[cx, baseY, cz]} rotation={[0, -angle, 0]} />
}

export default function EnvelopeLayer() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const sheathingVisible = useUISettingsStore((s) => s.sheathingVisible)
  const wrapVisible = useUISettingsStore((s) => s.wrapVisible)
  const wrbKind = useUISettingsStore((s) => s.wrbKind)

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
  const skinWalls = useMemo(() => {
    const out: ParsedWall[] = []
    for (const d of drawings) {
      for (const w of d.parsedWalls) {
        if (w.source === 'user' && wallTakesEnvelope(w.wallRole, w.framingType)) out.push(w)
      }
    }
    return out
  }, [drawings])

  // Footprint centroid, per storey — the reference for "which way is out". Taken
  // per level so a smaller upper floor is judged against its own outline rather
  // than the ground floor's.
  const centroidByLevel = useMemo(() => {
    const acc: Record<number, { x: number; y: number; n: number }> = {}
    for (const w of skinWalls) {
      const lv = w.level ?? 0
      const a = (acc[lv] ??= { x: 0, y: 0, n: 0 })
      a.x += (w.x1 + w.x2) / 2
      a.y += (w.y1 + w.y2) / 2
      a.n += 1
    }
    return acc
  }, [skinWalls])

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

  if (!sheathingVisible || skinWalls.length === 0) return null

  return (
    <group name="envelope" ref={groupRef}>
      {skinWalls.map((w, i) => {
        const c = centroidByLevel[w.level ?? 0]
        // Wall midpoint → centroid, in pixel space. The wall's local +Z axis is
        // the left-hand perpendicular of its direction; if that points toward the
        // centroid, the OTHER side is the outside.
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
        const dirX = w.x2 - w.x1, dirY = w.y2 - w.y1
        const toIn = c && c.n > 0 ? { x: c.x / c.n - mx, y: c.y / c.n - my } : { x: 0, y: 0 }
        // 2D cross product picks the side the centroid sits on.
        const side = dirX * toIn.y - dirY * toIn.x
        const outward: 1 | -1 = side > 0 ? -1 : 1
        return (
          <WallSkin
            key={`skin-${w.level ?? 0}-${i}`}
            wall={w}
            pixelToWorld={pixelToWorld}
            wallHeight={wallHeight}
            storeyHeight={storeyHeight}
            outward={outward}
            wrapVisible={wrapVisible}
            wrbKind={wrbKind}
            openings={openingsByWall[i]}
          />
        )
      })}
    </group>
  )
}
