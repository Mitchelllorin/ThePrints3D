import { create } from 'zustand'

export interface UISettings {
  // Panels / toolbars / menus
  topbarOpacity: number
  sidebarOpacity: number
  panelOpacity: number
  /** Surface colour shared by the top bar, side panel, toolbars and floaters. */
  panelColor: string
  // Logo (2D topbar)
  logoOpacity: number
  logoSize: number
  // 3D floating logo
  logo3DVisible: boolean
  logo3DOpacity: number
  logo3DFloatSpeed: number
  logo3DFloatHeight: number
  // Grid
  gridVisible: boolean
  gridOpacity: number
  gridColor: string
  gridCellSize: number
  gridDivisions: number
  // Accent
  accentColor: string
}

export const DEFAULT_UI_SETTINGS: UISettings = {
  topbarOpacity: 0.95,
  sidebarOpacity: 0.95,
  panelOpacity: 0.92,
  panelColor: '#0f172a',
  logoOpacity: 1,
  logoSize: 1,
  logo3DVisible: true,
  logo3DOpacity: 0.85,
  logo3DFloatSpeed: 0.7,
  logo3DFloatHeight: 0.25,
  gridVisible: true,
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
