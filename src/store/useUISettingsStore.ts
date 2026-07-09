import { create } from 'zustand'

export interface UISettings {
  // Panels / toolbars / menus
  topbarOpacity: number
  sidebarOpacity: number
  panelOpacity: number
  /** Surface colour shared by the top bar, side panel, toolbars and floaters. */
  panelColor: string
  /** Primary font / text colour (main labels, button text). */
  textColor: string
  /** Secondary font colour (hints, dim/secondary text). */
  textColorDim: string
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
  // 3D labels / metric nameplates (floating in the model — own colour & size,
  // separate from UI text because they sit on the workspace, not on a panel).
  labelColor: string
  labelScale: number
}

export const DEFAULT_UI_SETTINGS: UISettings = {
  // Menus/panels/toolbars default to ALMOST transparent so the workspace stays
  // the star (raise via Settings → Appearance → Opacity for a solid look).
  topbarOpacity: 0.3,
  sidebarOpacity: 0.3,
  panelOpacity: 0.3,
  panelColor: '#12161f',
  textColor: '#f5f7fa',
  textColorDim: '#97a4b6',
  logoOpacity: 1,
  logoSize: 1,
  logo3DVisible: true,
  logo3DOpacity: 0.06, // floating workspace logo defaults to ALMOST invisible
  logo3DFloatSpeed: 0.7,
  logo3DFloatHeight: 0.25,
  gridVisible: true,
  gridOpacity: 0.75,
  gridColor: '#2b3b5c',
  gridCellSize: 1,
  drywallVisible: false,
  drywallOrientation: 'vertical',
  bgColor: '#0b0e14',
  lightColor: '#ffffff',
  dirIntensity: 1.0,
  ambientIntensity: 0.6,
  accentColor: '#2f80ff',
  labelColor: '#ffffff',
  labelScale: 1,
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
