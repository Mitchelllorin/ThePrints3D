import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stores pull in pdf.js, which cannot load under Node. The nudge reads one
// callback and one boolean, so stand-ins carry exactly those.
const openUpgrade = vi.fn()
vi.mock('../../store/useFloorplanLocalStore', () => ({
  useFloorplanLocalStore: { getState: () => ({ openUpgrade }) },
}))
vi.mock('./usePro', () => ({ useCanBuyPro: () => true }))

// A minimal localStorage — the "once, ever" flag lives there.
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v) },
  removeItem: (k: string) => { memory.delete(k) },
})

const { nudgeProOnce, readNudged, PRO_NUDGE_REASON, NUDGE_KEY } = await import('./useProNudge')

describe('the one Pro nudge', () => {
  beforeEach(() => {
    memory.clear()
    openUpgrade.mockReset()
  })

  it('does not ask while there is nothing to buy', () => {
    expect(nudgeProOnce({ canBuy: false, openUpgrade })).toBe(false)
    expect(openUpgrade).not.toHaveBeenCalled()
    expect(readNudged()).toBe(false)
  })

  it('asks once at the honest moment, with its own reason', () => {
    expect(nudgeProOnce({ canBuy: true, openUpgrade })).toBe(true)
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(PRO_NUDGE_REASON)
    expect(readNudged()).toBe(true)
    expect(memory.get(NUDGE_KEY)).toBe('1')
  })

  it('never asks twice, even after a reload', () => {
    nudgeProOnce({ canBuy: true, openUpgrade })
    openUpgrade.mockReset()
    // Reload: the flag is read from storage, not from module state.
    expect(nudgeProOnce({ canBuy: true, openUpgrade })).toBe(false)
    expect(openUpgrade).not.toHaveBeenCalled()
  })

  it('a stored flag means no ask at all', () => {
    memory.set(NUDGE_KEY, '1')
    expect(nudgeProOnce({ canBuy: true, openUpgrade })).toBe(false)
    expect(openUpgrade).not.toHaveBeenCalled()
  })

  it('marks before opening, so closing the sheet does not rearm it', () => {
    const order: string[] = []
    nudgeProOnce({
      canBuy: true,
      openUpgrade: () => order.push('open'),
      mark: () => order.push('mark'),
    })
    expect(order).toEqual(['mark', 'open'])
  })
})
