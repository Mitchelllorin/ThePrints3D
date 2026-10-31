/**
 * ROUGH-IN VIEW — what a trade sees on site.
 *
 * Wire, pipe and duct go in while the building is bare framing: no roof
 * sheathing, no drywall, no cladding. Working a trade in this app with all of
 * that on meant every outlet, run and register was hidden inside a closed box.
 * So while a trade is being worked — its drawer open, or a part being placed,
 * or a run being drawn — the roof and the finishes step aside, and they come
 * back the moment you stop.
 */
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

export const MEP_LAYERS: ReadonlySet<string> = new Set(['plumbing', 'electrical', 'hvac'])

export function useRoughIn(): boolean {
  return useFloorplanLocalStore((s) =>
    MEP_LAYERS.has(s.activeTraceLayer) && (s.buildDrawerOpen || s.traceMode || s.placeObjectType != null))
}
