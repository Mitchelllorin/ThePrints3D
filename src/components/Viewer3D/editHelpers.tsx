/**
 * The COMPONENT half of "Edit Everything" mode — the post-build state where
 * hovering highlights any element and pressing drags it. Kept tiny and
 * framework-plain so every layer (floors, roofs, objects, walls, MEP) drives
 * the SAME interaction.
 *
 * Drag model: project the pointer ray onto the ground plane (y=0) so the element
 * tracks the finger exactly (the "follows your finger, drop it" feel), and keep a
 * live WORLD offset during the drag — the store is written ONCE on release so the
 * undo history gets a single entry, not one per frame.
 *
 * The ray-cast and the world→pixel conversion live in `editMath.ts`, because a
 * module that exports components AND plain functions cannot hot-reload: Fast
 * Refresh remounts every importer instead, which mid-drag loses the drag.
 */
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'

/** Movement under this (screen px, summed) counts as a tap, not a drag. */
export const EDIT_TAP_PX = 5

/**
 * How see-through an X-rayed element is — ONE number, because an element is not
 * one mesh.
 *
 * A wall is studs, sheathing, housewrap, cladding and board. X-ray used to reach
 * only the studs, which are the part already hidden inside the other four: you
 * pressed the button, the rail said it was on, and the wall looked exactly the
 * same. Every layer that draws part of an element reads this, so "X-ray" means
 * the whole element goes see-through, not one hidden slice of it.
 */
export const XRAY_OPACITY = 0.16

/** Inside-out catcher sphere — keeps pointer move/up firing once the finger
 *  leaves the grabbed element. Render only while a drag is live. */
export function EditDragCatcher({
  onMove, onUp,
}: {
  onMove: (e: ThreeEvent<PointerEvent>) => void
  onUp: (e: ThreeEvent<PointerEvent>) => void
}) {
  return (
    <mesh onPointerMove={onMove} onPointerUp={onUp} renderOrder={999}>
      <sphereGeometry args={[800, 8, 6]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
    </mesh>
  )
}

/**
 * Highlight box for an area-style element (floor/roof) — hovered or selected.
 *
 * SELECTED HAS TO SHOUT LOUDER THAN HOVERED, and it was the other way round:
 * hover drew cyan at 0.32 while selection drew amber at 0.20, so the thing you
 * had committed to was FAINTER than the thing you were merely pointing at. On a
 * model this busy that reads as nothing being selected at all.
 *
 * Hovering is a maybe, so it stays a soft wash. Selection is a statement, so it
 * gets a stronger fill AND a hard edge — the outline is what actually makes it
 * legible, because a translucent wash over pale decking or bright framing is
 * almost invisible while a drawn boundary survives any background. Same reason
 * the labels needed a halo rather than a brighter colour.
 */
export function AreaHighlight({
  lenX, lenZ, position, rotRad, hovered,
}: {
  lenX: number; lenZ: number; position: [number, number, number]; rotRad: number; hovered: boolean
}) {
  const w = lenX + 0.08
  const d = lenZ + 0.08
  return (
    <group position={position} rotation={[0, rotRad, 0]} renderOrder={998}>
      <mesh renderOrder={998}>
        <boxGeometry args={[w, 0.08, d]} />
        <meshBasicMaterial
          color={hovered ? '#22d3ee' : '#fbbf24'}
          transparent
          opacity={hovered ? 0.22 : 0.42}
          depthWrite={false}
        />
      </mesh>
      {/* The edge. Drawn through everything (depthTest off) so a selection is
          never lost behind the thing it is selecting. */}
      {!hovered && (
        <lineSegments renderOrder={999}>
          <edgesGeometry args={[new THREE.BoxGeometry(w, 0.09, d)]} />
          <lineBasicMaterial color="#fde68a" transparent opacity={0.95} depthTest={false} />
        </lineSegments>
      )}
    </group>
  )
}
