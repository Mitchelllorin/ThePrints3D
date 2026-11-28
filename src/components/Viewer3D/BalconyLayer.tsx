/**
 * BalconyLayer — each balcony built: a concrete slab carried out through the
 * wall on a thermal break, or 2x10 joists cantilevered past the wall with a rim
 * and decking; and a 42" guard round its three open sides, glass panels or
 * pickets under 4" apart. A stacked balcony repeats on every floor up to the
 * top storey.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useExplodeChildren } from './explodeRuntime'
import { useAppStore } from '../../store/useAppStore'
import { useSceneConfig } from '../../store/useSceneConfig'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { balconyShape, postsAlong, BALCONY_SPEC } from '../../services/balconies'

type XZ = [number, number]

export default function BalconyLayer() {
  const balconies = useAppStore((s) => s.balconies)
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const wallHeight = useSceneConfig(wizardInputs).wallHeightM
  const storeyHeight = wallHeight + FLOOR_ASSEMBLY_H

  const groupRef = useRef<THREE.Group>(null)
  useExplodeChildren(groupRef, 'framing')

  const drawing = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
  const imageWidth = drawing?.rasterWidth ?? 1400
  const imageHeight = drawing?.rasterHeight ?? 900
  const [overlayW, overlayD] = overlay.scale
  const rotRad = THREE.MathUtils.degToRad(overlay.rotationDeg)
  const walls = drawing?.parsedWalls
  const mmPerPx = drawing?.scaleMmPerPx ?? null

  const built = useMemo(() => {
    const out: THREE.Group[] = []
    if (!walls || balconies.length === 0) return out
    const loc = (p: [number, number]): XZ => [(p[0] / imageWidth - 0.5) * overlayW, (p[1] / imageHeight - 0.5) * overlayD]
    const topLevel = Math.max(0, ...walls.map((w) => w.level ?? 0))
    const S = BALCONY_SPEC
    const mats = {
      concrete: new THREE.MeshStandardMaterial({ color: '#b9b4ab', roughness: 0.95 }),
      breakM: new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.8 }),
      wood: new THREE.MeshStandardMaterial({ color: '#c9a56c', roughness: 0.75 }),
      deck: new THREE.MeshStandardMaterial({ color: '#a77d4f', roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.4, metalness: 0.7 }),
      glass: new THREE.MeshStandardMaterial({ color: '#9fd3e6', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
    }
    /** A box along a run a→b (plan metres), `w` across it, `t` tall, bottom at y. */
    const run = (a: XZ, b: XZ, w: number, t: number, y: number) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.01) return null
      const g = new THREE.BoxGeometry(L, t, w)
      g.rotateY(Math.atan2(-(b[1] - a[1]), b[0] - a[0]))
      g.translate((a[0] + b[0]) / 2, y + t / 2, (a[1] + b[1]) / 2)
      return g
    }
    const lerp = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

    for (const bal of balconies) {
      const levelWalls = walls.filter((w) => (w.level ?? 0) === bal.level)
      const shape = balconyShape(bal, levelWalls, mmPerPx)
      if (!shape) continue
      const A = loc(shape.a), B = loc(shape.b), C = loc(shape.c), D = loc(shape.d)
      const outM: XZ = [(D[0] - A[0]), (D[1] - A[1])]
      const deep = Math.hypot(outM[0], outM[1]) || 1
      const o: XZ = [outM[0] / deep, outM[1] / deep]
      const levels = bal.stack ? Array.from({ length: Math.max(1, topLevel - bal.level + 1) }, (_, i) => bal.level + i) : [bal.level]
      for (const level of levels) {
        const parts: Record<keyof typeof mats, THREE.BufferGeometry[]> = { concrete: [], breakM: [], wood: [], deck: [], metal: [], glass: [] }
        const add = (k: keyof typeof mats, g: THREE.BufferGeometry | null) => { if (g) parts[k].push(g) }
        const top = level * storeyHeight - S.stepDownM
        if (bal.kind === 'concrete') {
          // The slab, and the thermal break where it passes the wall face.
          const breakW = 0.05
          const a2: XZ = [A[0] + o[0] * breakW, A[1] + o[1] * breakW]
          const b2: XZ = [B[0] + o[0] * breakW, B[1] + o[1] * breakW]
          add('breakM', run(lerp(A, a2, 0.5), lerp(B, b2, 0.5), breakW, S.concreteM, top - S.concreteM))
          add('concrete', run(lerp(a2, D, 0.5), lerp(b2, C, 0.5), deep - breakW, S.concreteM, top - S.concreteM))
        } else {
          // 2x10 joists at 16" out past the wall, a rim across their ends, a
          // ledger on the wall, 5/4 decking across the top.
          const joistD = 0.235, joistW = 0.038, deckT = 0.025
          const y = top - deckT - joistD
          const along = Math.hypot(B[0] - A[0], B[1] - A[1])
          const n = Math.max(1, Math.ceil(along / 0.406))
          for (let i = 0; i <= n; i++) {
            const t = Math.min(1, Math.max(0, (i / n) * (along - joistW) / along + (joistW / 2) / along))
            const s0 = lerp(A, B, t)
            add('wood', run(s0, [s0[0] + o[0] * (deep - joistW), s0[1] + o[1] * (deep - joistW)], joistW, joistD, y))
          }
          add('wood', run([D[0] - o[0] * joistW / 2, D[1] - o[1] * joistW / 2], [C[0] - o[0] * joistW / 2, C[1] - o[1] * joistW / 2], joistW, joistD, y))
          add('wood', run([A[0] + o[0] * joistW / 2, A[1] + o[1] * joistW / 2], [B[0] + o[0] * joistW / 2, B[1] + o[1] * joistW / 2], joistW, joistD, y))
          add('deck', run(lerp(A, D, 0.5), lerp(B, C, 0.5), deep, deckT, top - deckT))
        }
        // THE GUARD: two ends and the front, posts no more than 1.5 m apart.
        const sides: Array<[XZ, XZ]> = [[A, D], [D, C], [C, B]]
        const inset = 0.04
        const inn = (p: XZ, q: XZ): [XZ, XZ] => {
          // pull the guard in off the slab edge
          const mid: XZ = lerp(A, C, 0.5)
          const pull = (r: XZ): XZ => { const v: XZ = [mid[0] - r[0], mid[1] - r[1]]; const l = Math.hypot(v[0], v[1]) || 1; return [r[0] + (v[0] / l) * inset, r[1] + (v[1] / l) * inset] }
          return [pull(p), pull(q)]
        }
        for (const [p0, q0] of sides) {
          const [p, q] = inn(p0, q0)
          const L = Math.hypot(q[0] - p[0], q[1] - p[1])
          for (const t of postsAlong(L)) {
            const at = lerp(p, q, L ? t / L : 0)
            const g = new THREE.BoxGeometry(0.05, S.guardM, 0.05)
            g.translate(at[0], top + S.guardM / 2, at[1])
            add('metal', g)
          }
          add('metal', run(p, q, 0.05, 0.04, top + S.guardM - 0.04))
          if (bal.guard === 'glass') {
            add('glass', run(p, q, 0.012, S.guardM - 0.15, top + 0.08))
          } else {
            add('metal', run(p, q, 0.03, 0.03, top + 0.08))
            const n = Math.max(1, Math.floor(L / (S.balusterGapM + 0.016)))
            for (let i = 1; i < n; i++) {
              const at = lerp(p, q, i / n)
              const g = new THREE.BoxGeometry(0.016, S.guardM - 0.16, 0.016)
              g.translate(at[0], top + 0.11 + (S.guardM - 0.16) / 2, at[1])
              add('metal', g)
            }
          }
        }
        const grp = new THREE.Group()
        grp.userData.level = level
        for (const k of Object.keys(parts) as Array<keyof typeof mats>) {
          if (!parts[k].length) continue
          const g = mergeGeometries(parts[k])
          parts[k].forEach((x) => x.dispose())
          if (!g) continue
          const m = new THREE.Mesh(g, mats[k].clone())
          m.castShadow = k !== 'glass'; m.receiveShadow = true
          m.userData.layer = 'floors'
          m.userData.info = k === 'concrete' ? 'Balcony slab, concrete'
            : k === 'breakM' ? 'Thermal break'
            : k === 'wood' ? '2x10 balcony joists, 16" o.c., rim and ledger'
            : k === 'deck' ? '5/4 decking'
            : k === 'glass' ? 'Glass guard panel, 42"'
            : bal.guard === 'glass' ? 'Guard posts and top rail, 42"' : 'Picket guard, 42", balusters under 4" apart'
          grp.add(m)
        }
        out.push(grp)
      }
    }
    return out
  }, [walls, balconies, mmPerPx, imageWidth, imageHeight, overlayW, overlayD, storeyHeight])

  useEffect(() => () => built.forEach((g) => g.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose() }
  })), [built])

  if (!visibleLayers.has('floors') || built.length === 0) return null
  return (
    <group name="balconies" ref={groupRef} position={[overlay.position[0], 0, overlay.position[1]]} rotation={[0, rotRad, 0]}>
      {built.map((g) => <primitive key={g.uuid} object={g} />)}
    </group>
  )
}
