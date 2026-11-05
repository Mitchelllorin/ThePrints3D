/**
 * THE ONE ASK — the first time a job is finished, Pro gets one honest mention.
 *
 * Pro has been on sale since 23 Oct and nothing ever asked anyone to buy it
 * unless they tapped a locked tool. That is fine for people who explore, and
 * useless for the ones who trace a plan, frame it and leave: they never touch a
 * locked thing, so they never learn the rest exists.
 *
 * So there is exactly one unprompted ask, at the moment the job is done — when
 * the cut list is first reached. Editing stays free; Pro is the cut list for
 * every wall, the takeoff, the tape and clean exports. It opens once, ever:
 * the flag is in localStorage, so it survives a reload and never asks twice.
 *
 * Only when there is something to buy. `useCanBuyPro` is false while the store
 * has no live product and for anyone who owns Pro, so closed testers and buyers
 * never meet it.
 */
import { useCallback } from 'react'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useCanBuyPro } from './usePro'

/** The reason the sheet carries when it was not a locked tap. */
export const PRO_NUDGE_REASON = 'nudge'

/** "Once, ever" lives here, not in the sheet — closing the sheet must not rearm it. */
export const NUDGE_KEY = 't3d:proNudged'

export function readNudged(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(NUDGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markNudged(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(NUDGE_KEY, '1')
  } catch {
    /* private mode, quota, storage off — not worth a crash */
  }
}

/**
 * The whole rule, as a plain function so it can be tested without React:
 * ask once, only when Pro is for sale and not owned, and mark it before the
 * sheet opens (so a close, a crash or a reload cannot ask again).
 */
export function nudgeProOnce({
  canBuy,
  openUpgrade,
  alreadyNudged = readNudged(),
  mark = markNudged,
}: {
  canBuy: boolean
  openUpgrade: (reason: string) => void
  alreadyNudged?: boolean
  mark?: () => void
}): boolean {
  if (!canBuy || alreadyNudged) return false
  mark()
  openUpgrade(PRO_NUDGE_REASON)
  return true
}

/** The hook form, for the component that reaches the honest moment. */
export function useProNudge(): () => boolean {
  const canBuy = useCanBuyPro()
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)
  return useCallback(() => nudgeProOnce({ canBuy, openUpgrade }), [canBuy, openUpgrade])
}
