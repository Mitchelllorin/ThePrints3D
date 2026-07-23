import { useEffect, useRef } from 'react'
import { useAppStore } from './useAppStore'

/**
 * Self-terminating build.
 *
 * This app IS a 3D model builder, so asking the user to press "Build 3D" is
 * asking permission to do the one thing the app is for. Instead the model
 * rebuilds itself whenever the traced content settles: trace a wall, lay a
 * floor, drop a roof — the 3D updates on its own. Everything stays editable
 * and undoable afterwards, so there's nothing to confirm.
 *
 * Debounced, because a trace run commits a wall per tap and framing every
 * intermediate state would thrash. We rebuild once the user pauses.
 */
const SETTLE_MS = 600

/**
 * Cheap signature of everything the construction engine consumes. Counts alone
 * would miss a wall being dragged to a new spot, so endpoint coordinates are
 * folded in (rounded, to avoid rebuilding on sub-pixel jitter mid-drag).
 */
function contentSignature(state: ReturnType<typeof useAppStore.getState>): string {
  const parts: (string | number)[] = []
  for (const d of state.drawings) {
    for (const w of d.parsedWalls) {
      parts.push(
        Math.round(w.x1), Math.round(w.y1),
        Math.round(w.x2), Math.round(w.y2),
        Math.round(w.thickness),
      )
    }
  }
  for (const a of [...state.floorsAreas, ...state.roofAreas]) {
    parts.push(a.id, Math.round(a.x1), Math.round(a.y1), Math.round(a.x2), Math.round(a.y2))
  }
  // Doors and windows are framing inputs — the engine cuts king/jack studs and a
  // header around each — so moving or resizing one has to re-frame the wall.
  // Other placed objects (furniture, fixtures) don't change framing; leaving
  // them out keeps dragging a sofa from rebuilding the house.
  for (const o of state.placedObjects) {
    if (o.type !== 'door' && o.type !== 'window') continue
    parts.push(
      o.id,
      Math.round(o.pxX ?? 0), Math.round(o.pxY ?? 0),
      o.rotationY.toFixed(2), o.scaleX.toFixed(2),
    )
  }
  return parts.join(',')
}

export function useAutoBuild(): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSignature = useRef<string | null>(null)

  useEffect(() => {
    // Seed from the current state so mounting doesn't trigger a build of
    // whatever was already there (e.g. a restored project).
    lastSignature.current = contentSignature(useAppStore.getState())

    const unsubscribe = useAppStore.subscribe((state) => {
      const signature = contentSignature(state)
      if (signature === lastSignature.current) return
      lastSignature.current = signature

      // Nothing to stand up yet — don't build an empty model.
      if (signature === '') return

      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        useAppStore.getState().buildModel({ auto: true })
      }, SETTLE_MS)
    })

    return () => {
      if (timer.current) clearTimeout(timer.current)
      unsubscribe()
    }
  }, [])
}
