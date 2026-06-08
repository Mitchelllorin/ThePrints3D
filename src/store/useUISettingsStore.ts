import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface UISettings {
  // Panels
  topbarOpacity: number      // 0.2 – 1
  sidebarOpacity: number     // 0.2 – 1
  panelOpacity: number       // 0.2 – 1 (floating panels / overlays)
  // Logo
  logoOpacity: number        // 0 – 1
  logoSize: number           // 0.5 – 2 (scale multiplier)
  // Grid
  gridOpacity: number        // 0 – 1
  gridColor: string          // hex
  gridCellSize: number       // 0.5 – 10 (Three.js units / meters)
  gridDivisions: number      // 2 – 40
  // Accent
  accentColor: string        // hex — used for highlights, badges, active states
}

export const DEFAULT_UI_SETTINGS: UISettings = {
  topbarOpacity: 0.95,
  sidebarOpacity: 0.95,
  panelOpacity: 0.92,
  logoOpacity: 1,
  logoSize: 1,
  gridOpacity: 0.35,
  gridColor: '#334155',
  gridCellSize: 1,
  gridDivisions: 10,
  accentColor: '#38bdf8',
}

interface UISettingsStore extends UISettings {
  set: (patch: Partial<UISettings>) => void
  reset: () => void
}

export const useUISettingsStore = create<UISettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_UI_SETTINGS,
      set: (patch) => set((s) => ({ ...s, ...patch })),
      reset: () => set(() => ({ ...DEFAULT_UI_SETTINGS })),
    }),
    { name: 'bp3d-ui-settings' }
  )
)
