import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real stores pull in pdf.js, which cannot load under Node. requirePro only
// reads two fields and calls one action, so stand-ins carry exactly those.
const app = { isPro: false, billingLive: false }
const local = { openUpgrade: vi.fn() }
vi.mock('../../store/useAppStore', () => ({ useAppStore: { getState: () => app } }))
vi.mock('../../store/useFloorplanLocalStore', () => ({ useFloorplanLocalStore: { getState: () => local } }))

const { PRO_FREE_FOR_EVERYONE, requirePro } = await import('./usePro')

describe('requirePro', () => {
  beforeEach(() => {
    app.isPro = false
    app.billingLive = false
    local.openUpgrade.mockReset()
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
})
