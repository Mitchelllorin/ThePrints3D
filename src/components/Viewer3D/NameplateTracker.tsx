/**
 * NameplateTracker — the part of the nameplates that lives inside the canvas.
 *
 * Every frame the camera or anything named has moved, it projects each named
 * object's box onto the screen, asks `layoutNameplates` where the plates go,
 * and hands the answer to the overlay. It draws nothing itself.
 *
 * Reading the object's box every frame is what makes a plate follow its part
 * through orbit, zoom and explode without any of those knowing about plates.
 * The box is worked out once per object, in the object's own frame, so a
 * frame costs eight projections per plate, not a walk over every stud.
 */
import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { convexHull, layoutNameplates, type Box, type PlateRequest, type Pt, type Tier } from '../../services/nameplateLayout'
import { measureEpoch, measurePlate } from './plateMeasure'
import {
  expandedNameplate, nameplateSources, nameplateVersion, publishNameplateLayout,
} from './nameplateRegistry'

/**
 * WHAT A PLATE MAY NOT COVER. The HUD's controls, read off the page: every
 * button and slider that is on screen and not a plate's own dot. Measured
 * rather than guessed — a fixed margin for "the right edge" kept a whole strip
 * of open ground empty for a slider that only occupies part of it. Re-read a
 * few times a second, not every frame; controls do not move that often.
 */
const EDGE_GAP = 8
const OBSTACLE_MS = 400
const CONTROLS = 'button, input, select, [role="slider"], [role="dialog"], [data-hud]'
function readObstacles(canvas: HTMLElement, layer: Element | null): Box[] {
  const c = canvas.getBoundingClientRect()
  const out: Box[] = []
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (layer && layer.contains(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    out.push({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height })
  }
  return out
}

/** A part smaller than this on screen is a dot, not a plate of micro-text. */
const MIN_PART_PX = 28

const localBoxes = new WeakMap<THREE.Object3D, THREE.Box3>()
const _inv = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _tmp = new THREE.Box3()

/** The object's box in its own frame — tight on a wall however it is turned. */
function localBox(obj: THREE.Object3D): THREE.Box3 {
  let b = localBoxes.get(obj)
  if (b) return b
  b = new THREE.Box3()
  obj.updateWorldMatrix(true, true)
  _inv.copy(obj.matrixWorld).invert()
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!g || !(o as THREE.Mesh).isMesh) return
    if (!g.boundingBox) g.computeBoundingBox()
    if (!g.boundingBox) return
    _m.multiplyMatrices(_inv, o.matrixWorld)
    _tmp.copy(g.boundingBox).applyMatrix4(_m)
    b!.union(_tmp)
  })
  if (b.isEmpty()) return b
  localBoxes.set(obj, b)
  return b
}

function shown(obj: THREE.Object3D): boolean {
  if (!obj.parent) return false
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false
  return true
}

export default function NameplateTracker() {
  const last = useRef({ sig: NaN, prevDirs: new Map<string, number>() })
  const obstacles = useRef<{ at: number; boxes: Box[] }>({ at: -Infinity, boxes: [] })

  useFrame(({ camera, size, gl }) => {
    const tier = useUISettingsStore.getState().nameplateTier
    const expanded = expandedNameplate()
    const src = nameplateSources()

    // Nothing moved, nothing changed: keep the last layout.
    let sig = nameplateVersion() * 7 + measureEpoch() * 31 + tier * 13 + size.width * 17 + size.height * 19
    const e = camera.matrixWorld.elements
    for (let i = 0; i < 16; i++) sig += e[i] * (i + 1)
    // Zoom on an orthographic camera lives in the projection, not the pose.
    sig += camera.projectionMatrix.elements[0] * 23 + camera.projectionMatrix.elements[5] * 29
    for (const s of src.values()) {
      const m = s.object.matrixWorld.elements
      sig += m[12] * 3 + m[13] * 5 + m[14] * 11 + (s.object.visible ? 1 : 0)
    }
    const now = performance.now()
    const stale = now - obstacles.current.at > OBSTACLE_MS
    if (sig === last.current.sig && !stale) return
    last.current.sig = sig
    if (stale) {
      const layer = document.querySelector('[data-nameplate-layer]')
      obstacles.current = { at: now, boxes: readObstacles(gl.domElement, layer) }
    }

    const bounds: Box = { x: EDGE_GAP, y: EDGE_GAP, w: Math.max(0, size.width - 2 * EDGE_GAP), h: Math.max(0, size.height - 2 * EDGE_GAP) }

    const project = (x: number, y: number, z: number): Pt | null => {
      _v.set(x, y, z).project(camera)
      if (_v.z < -1 || _v.z > 1) return null
      return { x: (_v.x + 1) / 2 * size.width, y: (1 - _v.y) / 2 * size.height }
    }

    const reqs: PlateRequest[] = []
    let cx = 0, cy = 0, n = 0
    for (const [id, s] of src) {
      if (!shown(s.object)) continue
      const b = localBox(s.object)
      if (b.isEmpty()) continue
      const mw = s.object.matrixWorld
      const pts: Pt[] = []
      let behind = false
      for (let i = 0; i < 8; i++) {
        _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(mw)
        const p = project(_v.x, _v.y, _v.z)
        if (!p) { behind = true; break }
        pts.push(p)
      }
      if (behind) continue
      _v.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).applyMatrix4(mw)
      const world = _v.clone()
      const anchor = project(world.x, world.y, world.z)
      if (!anchor) continue
      const hull = convexHull(pts)
      let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity
      for (const p of hull) { x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y) }
      if (x2 < 0 || x1 > size.width || y2 < 0 || y1 > size.height) continue
      cx += (x1 + x2) / 2; cy += (y1 + y2) / 2; n++

      const open = expanded === id
      const want: Tier = s.tier ?? (s.selected || open ? 3 : tier)
      reqs.push({
        id,
        anchor,
        hull,
        depth: camera.position.distanceTo(world),
        order: s.order,
        selected: s.selected || open,
        warning: s.warning,
        tier: want,
        sizes: measurePlate(s),
        // A part you picked or opened always gets its plate, however small.
        tooSmall: !s.selected && !open && Math.max(x2 - x1, y2 - y1) < MIN_PART_PX,
      })
    }

    const centre = n ? { x: cx / n, y: cy / n } : { x: size.width / 2, y: size.height / 2 }
    const layout = layoutNameplates(reqs, bounds, centre, last.current.prevDirs, obstacles.current.boxes)
    last.current.prevDirs = new Map(layout.plates.map((p) => [p.id, p.dir]))
    publishNameplateLayout(layout)
  })

  return null
}
