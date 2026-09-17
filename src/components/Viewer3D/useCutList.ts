/**
 * useCutList — the cut list, the buy list and the waste allowance in force.
 *
 * Its own file so the panel that renders the lists and the CSV export that
 * ships them share one source. The counting itself is in services/cutList.
 */
import { useMemo } from 'react'
import { useConfigStore } from '../../store/useConfigStore'
import { useWallPlans } from './useWallPlans'
import {
  cutListForWalls, buyList, DEFAULT_WASTE_PCT,
  type WasteCategory, type WallCuts, type BuyLine,
} from '../../services/cutList'
import { formatFeetInches } from '../../services/unitConverter'

export function useCutList(): { walls: WallCuts[]; buy: BuyLine[]; waste: Record<WasteCategory, number> } {
  const plans = useWallPlans()
  const stored = useConfigStore((s) => s.cutWastePct)
  const waste = stored ?? DEFAULT_WASTE_PCT
  const walls = useMemo(() => cutListForWalls(plans), [plans])
  const buy = useMemo(() => buyList(walls, waste), [walls, waste])
  return { walls, buy, waste }
}

/** Cut lengths are read off a tape: feet and inches, to 1/16". */
export function formatCutLength(inches: number): string {
  return formatFeetInches(inches, 16)
}
