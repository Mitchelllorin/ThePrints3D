import { create } from 'zustand'
import type { WrbKind, WoodSheathing, CladdingKind, BoardKind } from '../services/constructionCode'
import { DEFAULT_HEATING, type HeatingType } from '../services/tradeRules'

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
  /** Show the cladding, separately from WHICH cladding it is.
   *  Visibility and product choice were one control: the only way to see what
   *  was under the siding was to set the siding to 'none' and lose your choice.
   *  Every other layer has its own switch; this one now does too. */
  claddingVisible: boolean
  /** Show the floating dimension nameplates on walls, joists and ceilings.
   *  They are the right thing while you are laying something out and pure
   *  clutter once a storey is full of them. */
  dimensionsVisible: boolean
  /** WHEN finishes appear, as opposed to which ones.
   *  'live'  — clad as soon as a wall exists (fine once you have stopped framing)
   *  'later' — keep the frame bare while you build; finishes appear only when you
   *            ask for them. Framing is the thing you are working on, and burying
   *            it under sheeting the moment you pull a wall is the opposite of
   *            helpful. */
  // ── How much the build does for you ────────────────────────────────────────
  //
  // Not one right answer, so not one hard-coded behaviour. Some people want to
  // trace every wall themselves — that is the point of the app and it is how you
  // learn a plan. Others want the shell to appear so they can get to the parts
  // they care about. Both are legitimate, and which one you want changes with
  // your skill and with the job, so both are settings with a helpful default.

  /** Presets: 'practice' strips the plan's walls so you trace the whole thing
   *  yourself over the print; 'ready' ships them in the data.
   *
   *  Default 'practice', because that is what a preset is FOR. It briefly
   *  defaulted to 'ready' and a preset then arrived as a finished house — walls
   *  up before you had touched it — which leaves nothing to practise on.
   *  'ready' stays for the times you want the shell handed to you; be aware it
   *  is also the mode where everything that reasons about walls has data to
   *  reason about (door orientation, seating openings, "Find the rest"), since
   *  practice legitimately empties parsedWalls. */
  presetMode: 'ready' | 'practice'
  /** How the house is heated. Only forced air has ducts; electric baseboard is
   *  an electrical job and in-floor hydronic a plumbing one, so this decides
   *  which trade owns the work — and it must be set BEFORE devices are placed,
   *  because a baseboard under a window displaces the receptacle that would
   *  otherwise go there. See HEATING_SYSTEMS in tradeRules. */
  heatingType: HeatingType
  /** Bumped when a DEFAULT changes in a way an existing install should follow.
   *  Settings persist whole, so a stored copy of the old default would outlive
   *  the change forever otherwise. See `load()`. */
  settingsRev: number
  /** Carry the exterior shell up automatically when you move to an upper storey,
   *  so a 2nd floor starts as the 1st floor over again unless you say otherwise.
   *  Interior partitions never carry — they genuinely differ floor to floor.
   *  Off means every storey is traced or imported by hand. */
  autoCarryShellUp: boolean
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

/** rev 2 — presets go back to PRACTICE by default. */
const SETTINGS_REV = 2

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
  claddingVisible: true,
  dimensionsVisible: true,
  presetMode: 'practice',
  heatingType: DEFAULT_HEATING,
  settingsRev: SETTINGS_REV,
  autoCarryShellUp: true,
  finishTiming: 'later',
  finishesApplied: false,
  bgColor: '#0b0e14',
  lightColor: '#ffffff',
  dirIntensity: 1.0,
  ambientIntensity: 0.6,
  accentColor: '#2f80ff',
  // NOT WHITE. White is the same value as the pale timber, the sheet goods and
  // the print the labels sit on, so it has nothing to contrast with and washes
  // straight into them. A light cyan reads as annotation rather than material —
  // nothing in a building is this colour — and it holds against both the dark
  // grid and a bright deck. Changeable in Settings → Model labels.
  labelColor: '#7dd3fc',
  labelScale: 1,
}

const STORAGE_KEY = 'bp3d-ui-settings'

function load(): UISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<UISettings>
      const stored = { ...DEFAULT_UI_SETTINGS, ...saved }
      // Settings are saved as a whole object, so an install that saved the old
      // 'ready' default keeps it forever even after the default changes. Move
      // those installs over ONCE — after that the stored rev matches and the
      // user's own choice, whichever way, is what sticks.
      // Read the rev off the SAVED copy, not the merged one: merging fills the
      // missing field in from the current default, which is the very value the
      // check is trying to detect the absence of.
      if ((saved.settingsRev ?? 0) < 2) {
        stored.presetMode = 'practice'
        stored.settingsRev = SETTINGS_REV
      }
      return stored
    }
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
