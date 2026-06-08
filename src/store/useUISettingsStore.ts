import { create } from 'zustand'

export interface UISettings {
  topbarOpacity: number
  sidebarOpacity: number
  panelOpacity: number
  logoOpacity: number
  logoSize: number
  gridOpacity: number
  gridColor: string
  gridCellSize: number
  gridDivisions: number
  accentColor: string
}

export const DEFAULT_UI_SETTINGS: UISettings = {
  topbarOpacity: 0.95,
  sidebarOpacity: 0.95,
  panelOpacity: 0.92,
  logoOpacity: 1,
  logoSize: 1,
  gridOpacity: 0.8,
  gridColor: '#1a4a7a',
  gridCellSize: 1,
  gridDivisions: 10,
  accentColor: '#38bdf8',
}

const STORAGE_KEY = 'bp3d-ui-settings'

function load(): UISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_UI_SETTINGS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_UI_SETTINGS }
}

function save(s: UISettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

interface UISettingsStore extends UISettings {
  set: (patch: Partial<UISettings>) => void
  reset: () => void
}

export const useUISettingsStore = create<UISettingsStore>((setState) => ({
  ...load(),
  set: (patch) => setState((s) => {
    const next = { ...s, ...patch }
    save(next)
    return next
  }),
  reset: () => setState(() => {
    save(DEFAULT_UI_SETTINGS)
    return { ...DEFAULT_UI_SETTINGS }
  }),
}))
