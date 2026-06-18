import { create } from 'zustand'

export interface UISettings {
  // Panels / toolbars / menus
  topbarOpacity: number
  sidebarOpacity: number
  panelOpacity: number
  /** Surface colour shared by the top bar, side panel, toolbars and floaters. */
  panelColor: string
  /** App-wide font / text colour. */
  textColor: string
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
  // Drywall boarding
  drywallVisible: boolean
  drywallOrientation: 'vertical' | 'horizontal'
  // Workspace lighting / background
  bgColor: string
  lightColor: string
  /** Directional (sun) light intensity — the main "brightness" control. */
  dirIntensity: number
  /** Ambient fill light intensity — lifts the shadows. */
  ambientIntensity: number
  // Accent
  accentColor: string
}

export const DEFAULT_UI_SETTINGS: UISettings = {
  // Menus/panels/toolbars default to mostly see-through so the workspace shows
  // through them (raise via Settings → Appearance → Opacity for a solid look).
  topbarOpacity: 0.35,
  sidebarOpacity: 0.35,
  panelOpacity: 0.35,
  panelColor: '#0f172a',
  textColor: '#f1f5f9',
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
  drywallVisible: false,
  drywallOrientation: 'vertical',
  bgColor: '#060d1a',
  lightColor: '#ffffff',
  dirIntensity: 1.0,
  ambientIntensity: 0.6,
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
