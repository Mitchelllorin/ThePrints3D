/**
 * RoomCeilingLayer — each room's own ceiling: a dropped ceiling board where a
 * room was set lower than the building height, and its bulkheads, framed the
 * way they are built (2x2 ladders, boarded face and underside).
 *
 * The walls stay at the building height — the storey has to stack, and the
 * joists above sit on them. A lower room is a ceiling framed down inside it.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useSceneConfig } from '../../store/useSceneConfig'
import { buildBulkhead, FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { roomAt, bulkheadLayout, roomWalls, allRooms, regionHas, type RoomRegion } from '../../services/roomRegions'
import { suspendedCeilingLayout, CEILING_SPEC, isSteelJob } from '../../services/suspendedCeiling'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useConfigStore } from '../../store/useConfigStore'
import type { ParsedWall, RoomCeiling } from '../../types'


function dispose(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
  })
}

/** A bulkhead's wall thickness: the wall it was put on, if it is still there. */
function thicknessFor(b: { x1: number; y1: number; x2: number; y2: number }, walls: ParsedWall[]): number {
  for (const w of walls) {
    const fwd = Math.hypot(w.x1 - b.x1, w.y1 - b.y1) + Math.hypot(w.x2 - b.x2, w.y2 - b.y2)
    const back = Math.hypot(w.x1 - b.x2, w.y1 - b.y2) + Math.hypot(w.x2 - b.x1, w.y2 - b.y1)
    if (Math.min(fwd, back) < 2) return w.thickness || 10
  }
  const t = walls.map((w) => w.thickness).filter((v) => v > 0).sort((a, b) => a - b)
  return t[Math.floor(t.length / 2)] ?? 10
}

export default function RoomCeilingLayer() {
  const rooms = useAppStore((s) => s.roomCeilings)
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const scene = useSceneConfig(wizardInputs)
  const wallHeight = scene.wallHeightM
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H
  const dropM = scene.bulkheadDropM
  const depthM = scene.bulkheadDepthM

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'framing')

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const walls = drawing?.parsedWalls
  const mmPerPx = drawing?.scaleMmPerPx ?? null
  // A steel job: Settings says steel, or the walls drawn are steel studs.
  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  const steel = framingMaterial === 'steel' || isSteelJob(walls ?? [])

  const built = useMemo(() => {
    const root: THREE.Group[] = []
    if (!walls) return root
    const sx = overlayW / imageWidth, sz = overlayD / imageHeight
    const loc = (px: number, py: number): [number, number] => [(px / imageWidth - 0.5) * overlayW, (py / imageHeight - 0.5) * overlayD]
    const boardMat = new THREE.MeshStandardMaterial({ color: '#f5f0eb', roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
    const steelMat = new THREE.MeshStandardMaterial({ color: '#d2d6dc', roughness: 0.3, metalness: 0.9 })
    const wireMat = new THREE.MeshStandardMaterial({ color: '#9aa1aa', roughness: 0.4, metalness: 0.8 })

    // WHICH ROOMS GET A CEILING HERE. Every room given a height or a bulkhead;
    // and on a steel job every closed room on every floor, since a steel
    // building has no joists of its own to board — its ceilings hang.
    type Job = { room: RoomCeiling; region: RoomRegion; around: ParsedWall[] }
    const jobs: Job[] = []
    const levels = new Set<number>([...walls.map((w) => w.level ?? 0), ...rooms.map((r) => r.level ?? 0)])
    for (const level of levels) {
      const around = roomWalls(walls, level)
      const set = rooms.filter((r) => (r.level ?? 0) === level)
      const taken: RoomRegion[] = []
      for (const room of set) {
        const region = roomAt(around, room, mmPerPx)
        if (!region) continue
        jobs.push({ room, region, around })
        taken.push(region)
      }
      if (steel && mmPerPx) {
        for (const r of allRooms(around, mmPerPx)) {
          if (taken.some((t) => regionHas(t, r.seed))) continue
          jobs.push({ room: { id: `auto-${level}-${Math.round(r.seed.x)}-${Math.round(r.seed.y)}`, level, x: r.seed.x, y: r.seed.y }, region: r, around })
        }
      }
    }

    // One merged mesh per material per room: a floor of thirty rooms is
    // thousands of pieces of channel.
    const merged = (boxes: THREE.BufferGeometry[], mat: THREE.Material, info: string) => {
      if (boxes.length === 0) return null
      const g = mergeGeometries(boxes)
      boxes.forEach((b) => b.dispose())
      if (!g) return null
      const m = new THREE.Mesh(g, mat.clone())
      m.castShadow = true; m.receiveShadow = true
      m.userData.layer = 'ceiling'
      m.userData.info = info
      return m
    }
    /** A member along a plan segment: `w` wide, `t` tall, its BOTTOM at y. */
    const member = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, t: number, y: number) => {
      const [ax, az] = loc(a.x, a.y), [bx, bz] = loc(b.x, b.y)
      const L = Math.hypot(bx - ax, bz - az)
      if (L < 0.02) return null
      const g = new THREE.BoxGeometry(L, t, w)
      g.rotateY(Math.atan2(-(bz - az), bx - ax))
      g.translate((ax + bx) / 2, y + t / 2, (az + bz) / 2)
      return g
    }

    for (const { room, region, around } of jobs) {
      const level = room.level ?? 0
      const base = level * storeyHeight
      const h = Math.min(wallHeight, Math.max(1.8, room.heightM ?? wallHeight))
      const dropped = h < wallHeight - 0.01
      const piece = new THREE.Group()
      piece.userData.level = level
      const hung = (steel || dropped) && !!mmPerPx
      // A hung ceiling at full height still needs its channel under the
      // structure, so its board comes down by the depth of the channel.
      const S = CEILING_SPEC
      const boardY = hung && !dropped ? base + wallHeight - (S.boardM + S.hatM + S.carryingM) : base + h
      if (dropped || hung) {
        const boards: THREE.BufferGeometry[] = []
        for (const [x1, y1, x2, y2] of region.rects) {
          const [ax, az] = loc(x1, y1), [bx, bz] = loc(x2, y2)
          const g = new THREE.BoxGeometry(Math.abs(bx - ax), S.boardM, Math.abs(bz - az))
          g.translate((ax + bx) / 2, boardY + S.boardM / 2, (az + bz) / 2)
          boards.push(g)
        }
        const m = merged(boards, boardMat, `${dropped ? 'Dropped' : 'Hung'} ceiling, 1/2" board, at ${(boardY - base) / 0.3048 >= 0 ? ((boardY - base) / 0.3048).toFixed(2) : '?'} ft`)
        if (m) piece.add(m)
      }
      if (hung) {
        const lay = suspendedCeilingLayout(region, around, mmPerPx!)
        const hatY = boardY + S.boardM
        const carY = hatY + S.hatM
        const topY = base + wallHeight
        const hats = lay.hats.map((s) => member(s[0], s[1], 0.073, S.hatM, hatY)).filter(Boolean) as THREE.BufferGeometry[]
        const cars = lay.carrying.map((s) => member(s[0], s[1], 0.0127, S.carryingM, carY)).filter(Boolean) as THREE.BufferGeometry[]
        const angles = lay.angle.map((s) => member(s[0], s[1], 0.025, 0.025, boardY + S.boardM)).filter(Boolean) as THREE.BufferGeometry[]
        const wireLen = topY - (carY + S.carryingM)
        const wires: THREE.BufferGeometry[] = []
        if (wireLen > 0.02) {
          for (const p of lay.wires) {
            const [x, z] = loc(p.x, p.y)
            const g = new THREE.CylinderGeometry(0.003, 0.003, wireLen, 4)
            g.translate(x, carY + S.carryingM + wireLen / 2, z)
            wires.push(g)
          }
        }
        const c = lay.counts
        const ft = (mm: number) => Math.round(mm / 304.8)
        const sum = `${c.wires} hanger wires, ${ft(c.carryingMm)} ft carrying channel, ${ft(c.hatMm)} ft hat track, ${c.clips} clips, ${ft(c.angleMm)} ft wall angle, ${c.boardM2} m² board`
        for (const m of [
          merged(hats, steelMat, '7/8" hat track (furring channel), 16" o.c.'),
          merged(cars, steelMat, '1-1/2" carrying channel, 4\' o.c.'),
          merged(angles, steelMat, 'Wall angle'),
          merged(wires, wireMat, '12ga hanger wire, 4\' x 4\''),
        ]) if (m) piece.add(m)
        piece.userData.ceilingTakeoff = c
        piece.userData.info = sum
      }
      for (const b of room.bulkheads ?? []) {
        const lay = bulkheadLayout(b, region, thicknessFor(b, around))
        if (!lay) continue
        const [ax, az] = loc(...lay.a), [zx, zz] = loc(...lay.z)
        const len = Math.hypot(zx - ax, zz - az)
        const drop = Math.max(0.05, Math.min(h - 1.8, b.dropM ?? dropM))
        const deep = Math.max(0.1, b.depthM ?? depthM)
        const box = buildBulkhead({ lengthM: len, widthM: deep, dropM: drop, color: steel ? '#d2d6dc' : undefined })
        if (box.children.length === 0) continue
        const dx = (zx - ax) / len, dz = (zz - az) / len
        let ox = lay.out[0] * sx, oz = lay.out[1] * sz
        const ol = Math.hypot(ox, oz) || 1
        ox /= ol; oz /= ol
        // rotation.y = θ sends +x to (cos θ, −sin θ) and +z to (sin θ, cos θ):
        // +x along the wall, +z (the boarded face) out into the room.
        let theta = Math.atan2(-dz, dx)
        if (Math.sin(theta) * ox + Math.cos(theta) * oz < 0) theta += Math.PI
        box.rotation.y = theta
        box.position.set((ax + zx) / 2 + ox * deep / 2, boardY - drop, (az + zz) / 2 + oz * deep / 2)
        box.traverse((o) => { o.userData.layer = 'ceiling' })
        piece.add(box)
      }
      if (piece.children.length) root.push(piece)
    }
    return root
  }, [walls, rooms, mmPerPx, imageWidth, imageHeight, overlayW, overlayD, storeyHeight, wallHeight, dropM, depthM, steel])

  useEffect(() => () => built.forEach(dispose), [built])

  if (!visibleLayers.has('floors') || built.length === 0) return null
  return (
    <group name="room-ceilings" ref={groupRef} position={[overlay.position[0], 0, overlay.position[1]]} rotation={[0, rotRad, 0]}>
      {built.map((p) => <primitive key={p.uuid} object={p} />)}
    </group>
  )
}
