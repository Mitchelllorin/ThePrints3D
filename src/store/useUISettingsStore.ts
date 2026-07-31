import { create } from 'zustand'
import type { WrbKind, WoodSheathing, CladdingKind, BoardKind } from '../services/constructionCode'

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
  /** When false, the logo is frozen (no rock/float) — for clean promo footage. */
  logo3DAnimated: boolean
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
  /** Which interior board product goes on the studs. */
  boardKind: BoardKind
  // Exterior envelope — sheathing, then housewrap over it. Two toggles rather
  // than one, because seeing the sheathing is exactly what you want while
  // checking the panel layout, and the wrap covers it up.
  sheathingVisible: boolean
  wrapVisible: boolean
  /** Which water-resistive barrier: housewrap (default), felt, fluid-applied, or
   *  integrated (sheathing already carries it — ZIP System and similar). */
  wrbKind: WrbKind
  /** OSB or CDX plywood on wood-framed exteriors (steel gets glass-mat either way). */
  woodSheathing: WoodSheathing
  /** Exterior finish over the barrier. 'none' leaves the wall dried-in. */
  cladding: CladdingKind
  /** WHEN finishes appear, as opposed to which ones.
   *  'live'  — clad as soon as a wall exists (fine once you have stopped framing)
   *  'later' — keep the frame bare while you build; finishes appear only when you
   *            ask for them. Framing is the thing you are working on, and burying
   *            it under sheeting the moment you pull a wall is the opposite of
   *            helpful. */
  finishTiming: 'live' | 'later'
  /** Set by "Apply finishes now" — the switch the 'later' mode waits on. Reset
   *  whenever you go back to framing. */
  finishesApplied: boolean
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
  logo3DAnimated: true,
  logo3DOpacity: 0.06, // floating workspace logo defaults to ALMOST invisible
  logo3DFloatSpeed: 0.7,
  logo3DFloatHeight: 0.25,
  gridVisible: true,
  gridOpacity: 0.75,
  gridColor: '#2b3b5c',
  gridCellSize: 1,
  drywallVisible: false,
  drywallOrientation: 'vertical',
  boardKind: 'gypsum-half',
  sheathingVisible: false,
  wrapVisible: true,
  wrbKind: 'housewrap',
  woodSheathing: 'osb',
  cladding: 'none',
  finishTiming: 'later',
  finishesApplied: false,
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
