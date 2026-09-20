/**
 * Hide storeys, and ghost the ones you are looking through.
 *
 * Imperative three.js: it walks the built scene and writes `visible` and
 * material opacity on it. That is not something a component may do to values it
 * reached through a ref — the React compiler says so, and it is right, because a
 * component body it cannot re-run safely is a component it cannot optimise. So
 * the mutation lives out here, in a plain function with a name that says what it
 * does, and the effect in BuildingModel just calls it.
 *
 * THE GHOST USED TO STICK. `baseOpacity` — the opacity to put back when a level
 * stops being ghosted — was recorded on first touch, but only `if (!ghosted)`,
 * and it was recorded AFTER the ghost opacity had already been written. So a
 * level ghosted the first time it was ever touched never recorded anything, and
 * un-ghosting it read `undefined ?? sm.opacity`, which by then was 0.15. The
 * level stayed see-through for the rest of the session and the only way out was
 * a rebuild. Remember first, write second, and remember it whether or not this
 * pass happens to be ghosting.
 */
import * as THREE from 'three'

export function applyFloorVisibility(
  group: THREE.Object3D,
  isolatedFloor: number | null,
  ghostedLevels: readonly number[],
): void {
  for (const child of group.children) {
    const level = (child.userData.level as number) ?? 0
    const hidden = isolatedFloor !== null && level !== isolatedFloor
    const ghosted = !hidden && ghostedLevels.includes(level)
    child.visible = !hidden
    child.traverse((node) => {
      const mesh = node as Partial<THREE.Mesh>
      if (!mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial
        // Remember what it was BEFORE writing over it, ghosting or not.
        if (sm.userData.baseOpacity === undefined) sm.userData.baseOpacity = sm.opacity
        const base = sm.userData.baseOpacity as number
        sm.opacity = ghosted ? 0.15 : base
        sm.transparent = ghosted || sm.opacity < 1
      }
    })
  }
}
