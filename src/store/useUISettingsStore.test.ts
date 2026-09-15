import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORAGE_KEY = 'bp3d-ui-settings'

/**
 * These tests run under a `localStorage` that is a bare object — no getItem,
 * no setItem — so the store's own try/catch swallows it and every load falls
 * back to defaults. That silently passes the fresh-install case and makes the
 * migration case untestable, which is the half that matters. So: a real
 * in-memory Storage, installed before the module under test is imported
 * (it reads storage once, at import time).
 */
function installStorage(seed?: Record<string, unknown>) {
  const mem = new Map<string, string>()
  if (seed) mem.set(STORAGE_KEY, JSON.stringify(seed))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  })
  return mem
}

/**
 * The 3D wordmark swung on its axis by default, on the launch screen and over
 * the workspace both. It parks now — a fixed three-quarter angle that still
 * shows the extrusion — and the swing is the opt-in.
 *
 * The default alone would never reach anybody: Motion has been on since the
 * badge existed, so every install has `true` written into its stored settings
 * blob. That is what the rev is for, and it is the same trap the skin toggles
 * were in at rev 3.
 */
describe('3D wordmark motion', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('parks by default on a fresh install', async () => {
    installStorage()
    const { DEFAULT_UI_SETTINGS, useUISettingsStore } = await import('./useUISettingsStore')
    expect(DEFAULT_UI_SETTINGS.logo3DAnimated).toBe(false)
    expect(useUISettingsStore.getState().logo3DAnimated).toBe(false)
  })

  it('parks an existing install that saved the old swinging default', async () => {
    installStorage({ settingsRev: 4, logo3DAnimated: true })
    const { useUISettingsStore } = await import('./useUISettingsStore')
    expect(useUISettingsStore.getState().logo3DAnimated).toBe(false)
  })

  it('leaves the swing alone once the install has been moved over', async () => {
    // Somebody turned Motion back ON after the migration. It has to stick, or
    // the toggle is decoration.
    installStorage({ settingsRev: 5, logo3DAnimated: true })
    const { useUISettingsStore } = await import('./useUISettingsStore')
    expect(useUISettingsStore.getState().logo3DAnimated).toBe(true)
  })

  it('does not disturb the rest of a stored copy', async () => {
    // The rev bump touches one field. A migration that resets somebody's
    // colours or opacity on the way past is worse than the thing it fixes.
    installStorage({ settingsRev: 4, logo3DAnimated: true, logo3DOpacity: 0.9, accentColor: '#ff0000' })
    const { useUISettingsStore } = await import('./useUISettingsStore')
    const s = useUISettingsStore.getState()
    expect(s.logo3DAnimated).toBe(false)
    expect(s.logo3DOpacity).toBeCloseTo(0.9, 6)
    expect(s.accentColor).toBe('#ff0000')
  })

  it('keeps the swing switchable both ways', async () => {
    installStorage()
    const { useUISettingsStore } = await import('./useUISettingsStore')
    useUISettingsStore.getState().set({ logo3DAnimated: true })
    expect(useUISettingsStore.getState().logo3DAnimated).toBe(true)
    useUISettingsStore.getState().set({ logo3DAnimated: false })
    expect(useUISettingsStore.getState().logo3DAnimated).toBe(false)
  })
})
