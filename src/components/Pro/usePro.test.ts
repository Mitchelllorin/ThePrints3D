import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real stores pull in pdf.js, which cannot load under Node. requirePro only
// reads two fields and calls one action, so stand-ins carry exactly those.
const app = { isPro: false, billingLive: false }
const local = { openUpgrade: vi.fn() }
vi.mock('../../store/useAppStore', () => ({ useAppStore: { getState: () => app } }))
vi.mock('../../store/useFloorplanLocalStore', () => ({ useFloorplanLocalStore: { getState: () => local } }))

// A minimal localStorage — the test unlock writes one key and the gate reads it.
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v) },
  removeItem: (k: string) => { memory.delete(k) },
})
// Pin the code, so the assertions do not depend on what is in .env.
vi.stubEnv('VITE_TEST_UNLOCK_CODE', 'bench')

const { PRO_FREE_FOR_EVERYONE, requirePro } = await import('./usePro')
const { readTestUnlock, revokeTestUnlock, tryTestUnlock } = await import('../../services/testUnlock')

describe('requirePro', () => {
  beforeEach(() => {
    app.isPro = false
    app.billingLive = false
    local.openUpgrade.mockReset()
    memory.clear()
    revokeTestUnlock()
  })

  it('the paywall is on', () => {
    expect(PRO_FREE_FOR_EVERYONE).toBe(false)
  })

  it('stays open while there is nothing to buy', () => {
    const action = vi.fn()
    requirePro('The measuring tape', action)
    expect(action).toHaveBeenCalledOnce()
    expect(local.openUpgrade).not.toHaveBeenCalled()
  })

  it('opens the upgrade sheet once Play has a product and it is not owned', () => {
    app.billingLive = true
    const action = vi.fn()
    requirePro('The measuring tape', action)
    expect(action).not.toHaveBeenCalled()
    expect(local.openUpgrade).toHaveBeenCalledWith('The measuring tape')
  })

  it('runs the action for someone who owns Pro', () => {
    app.billingLive = true
    app.isPro = true
    const action = vi.fn()
    requirePro('The measuring tape', action)
    expect(action).toHaveBeenCalledOnce()
    expect(local.openUpgrade).not.toHaveBeenCalled()
  })

  /**
   * THE BENCH PATH. A build flagged for testing takes a code, and the gates open
   * even though Play says this device owns nothing — the only way to read the
   * gated half of the app on a closed-testing install.
   */
  it('a test-unlock code opens the gate with a live store and no purchase', () => {
    app.billingLive = true
    expect(tryTestUnlock('bench')).toBe(true)
    expect(readTestUnlock()).toBe(true)
    const action = vi.fn()
    requirePro('The measuring tape', action)
    expect(action).toHaveBeenCalledOnce()
    expect(local.openUpgrade).not.toHaveBeenCalled()
  })

  it('a wrong code unlocks nothing', () => {
    app.billingLive = true
    expect(tryTestUnlock('not-the-code')).toBe(false)
    expect(readTestUnlock()).toBe(false)
    const action = vi.fn()
    requirePro('The measuring tape', action)
    expect(action).not.toHaveBeenCalled()
    expect(local.openUpgrade).toHaveBeenCalledWith('The measuring tape')
  })
})
