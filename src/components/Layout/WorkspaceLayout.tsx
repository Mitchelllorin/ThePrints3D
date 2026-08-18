import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import CameraCapture from '../Upload/CameraCapture'
import WallCalibrationPanel from '../Drawings/WallCalibrationPanel'
import ProjectLibrary from '../Projects/ProjectLibrary'
import AssistantBubble from './AssistantBubble'
import { listPresetDefinitions, type PresetDifficulty } from '../../services/presetDrawings'
import type { BuildingType } from '../../onboarding/types'
import { convertValue, convertLength, type ConverterKind, type ConverterUnit, type LengthFormat } from '../../services/unitConverter'
import ModelViewer from '../Viewer3D/ModelViewer'
import TakeoffContent from '../Viewer3D/TakeoffPanel'
import InferencePrompt from '../Viewer3D/InferencePrompt'
import TopIcons from './TopIcons'
import EdgeDrawer from './EdgeDrawer'
import RailCascade from './RailCascade'
import TutorialCoach from './TutorialCoach'
import Logo3DBadge from './Logo3DBadge'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import AskAI from './AskAI'
import { useSelectionEdit } from '../Viewer3D/selectionEdit'
import UpgradeSheet from '../Pro/UpgradeSheet'
import ProSection from '../Pro/ProSection'
import { hasToured, markToured } from '../../onboarding/firstRun'
import { watermarkedPng } from '../../services/watermark'
import { solveStair, stairIssues, stairShapeFromSubtype } from '../../services/stairs'
import { getCatalogItem } from '../../data/objectCatalog'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { HEATING_SYSTEMS, type HeatingType } from '../../services/tradeRules'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useConfigStore, type ActiveUnit } from '../../store/useConfigStore'
import styles from './WorkspaceLayout.module.css'

/** Edit rail steps. One tap = one of these, and one undo entry. */
const ROT_STEP = Math.PI / 12   // 15°
const STRETCH_STEP = 1.05       // ±5% per tap

// ── Reusable setting controls (module scope: stable component identities) ─────
function Slider({ label, val, min, max, step, unit = '', onChange }: {
  label: string; val: number; min: number; max: number; step: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className={styles.settingRow}>
      <span className={styles.settingLabel}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={(e) => onChange(Number(e.target.value))} className={styles.settingSlider} />
      <span className={styles.settingVal}>{val}{unit}</span>
    </label>
  )
}

function Toggle({ label, val, onChange }: { label: string; val: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.settingRow} style={{ cursor: 'pointer' }}>
      <span className={styles.settingLabel}>{label}</span>
      <input type="checkbox" checked={val} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--bp-accent, #38bdf8)', width: 16, height: 16 }} />
      <span className={styles.settingVal}>{val ? 'On' : 'Off'}</span>
    </label>
  )
}

function ColorRow({ label, val, onChange }: { label: string; val: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.settingRow}>
      <span className={styles.settingLabel}>{label}</span>
      <input type="color" value={val} onChange={(e) => onChange(e.target.value)} className={styles.settingColor} />
      <span className={styles.settingVal}>{val}</span>
    </label>
  )
}

function Select({ label, val, options, onChange }: {
  label: string; val: string; options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <label className={styles.settingRow}>
      <span className={styles.settingLabel}>{label}</span>
      <select className={styles.settingSelect} value={val} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/**
 * CollapsibleSection — the standard retractable toggle-tab pattern (the same
 * single-open toggle the Settings/Presets tab strip uses): click the header to
 * expand the section, click again (or open another) to retract it. Every
 * settings category is rendered through this so the panel stays uniform.
 */
function CollapsibleSection({ id, title, openId, setOpenId, children }: {
  id: string; title: string; openId: string | null
  setOpenId: (id: string | null) => void; children: ReactNode
}) {
  const open = openId === id
  return (
    <div className={styles.collapsible}>
      <button
        type="button"
        className={`${styles.collapsibleHeader} ${open ? styles.collapsibleHeaderOpen : ''}`}
        onClick={() => setOpenId(open ? null : id)}
      >
        <span className={styles.collapsibleCaret}>{open ? '▾' : '▸'}</span>
        <span className={styles.collapsibleTitle}>{title}</span>
      </button>
      {open && <div className={styles.collapsibleBody}>{children}</div>}
    </div>
  )
}

const LENGTH_FORMAT_OPTIONS: Array<{ value: LengthFormat; label: string }> = [
  { value: 'ft-in',      label: 'Feet-inches (4\' 5")' },
  { value: 'ft-in-frac', label: 'Feet-inches 1/16"' },
  { value: 'decimal',    label: 'Decimal (active unit)' },
]

const UNIT_OPTIONS: Array<{ value: ActiveUnit; label: string }> = [
  { value: 'mm', label: 'Millimetres (mm)' },
  { value: 'cm', label: 'Centimetres (cm)' },
  { value: 'm', label: 'Metres (m)' },
  { value: 'in', label: 'Inches (in)' },
  { value: 'ft', label: 'Feet (ft)' },
]

// Systems exposed in the Explode section's per-system offset multipliers.
const EXPLODE_SYSTEMS: Array<{ key: string; label: string }> = [
  { key: 'framing', label: 'Framing' },
  { key: 'walls', label: 'Walls' },
  { key: 'floors', label: 'Floors' },
  { key: 'roof', label: 'Roof' },
  { key: 'doors-windows', label: 'Openings' },
  { key: 'structure', label: 'Structure' },
  { key: 'mep', label: 'MEP' },
  { key: 'ceiling', label: 'Ceiling' },
  { key: 'foundation', label: 'Foundation' },
]

const STEEL_WIDTH_OPTIONS = [
  { value: '1-5/8', label: '1-5/8"' },
  { value: '2-1/2', label: '2-1/2"' },
  { value: '3-1/2', label: '3-1/2"' },
  { value: '3-5/8', label: '3-5/8" (interior)' },
  { value: '6', label: '6"' },
  { value: '8', label: '8"' },
]

const STEEL_GAUGE_OPTIONS = [
  { value: '25', label: '25 ga (interior)' },
  { value: '20', label: '20 ga' },
  { value: '18', label: '18 ga (load-bearing)' },
  { value: '16', label: '16 ga' },
  { value: '12', label: '12 ga (heavy)' },
]

const STEEL_TRACK_OPTIONS = [
  { value: 'shallow', label: 'Shallow' },
  { value: 'deep', label: 'Deep' },
  { value: 'slotted', label: 'Slotted / deflection' },
  { value: 'double', label: 'Legacy double-track' },
]

const BUILD_TYPE_OPTIONS: Array<{ value: BuildingType; label: string }> = [
  { value: 'residential-single', label: 'Residential (single)' },
  { value: 'residential-multi', label: 'Residential (multi)' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'institutional', label: 'Institutional' },
  { value: 'unknown', label: 'Unknown' },
]

// ── Settings panel content ───────────────────────────────────────────────────
function SettingsContent() {
  const ui = useUISettingsStore()
  const setUI = useUISettingsStore((x) => x.set)
  const resetUI = useUISettingsStore((x) => x.reset)
  const cfg = useConfigStore()
  const setCfg = useConfigStore((x) => x.set)
  const resetCfg = useConfigStore((x) => x.reset)
  const previewMode = useAppStore((x) => x.previewMode)
  const setPreviewMode = useAppStore((x) => x.setPreviewMode)
  const isPro = useAppStore((x) => x.isPro)   // titles the Pro section

  // Single-open accordion, matching the panel tab strip's toggle behaviour.
  const [openId, setOpenId] = useState<string | null>('appearance')

  const resetAll = () => { resetUI(); resetCfg() }

  return (
    <div className={styles.settingsBody}>
      <CollapsibleSection id="appearance" title="Panels & text" openId={openId} setOpenId={setOpenId}>
        <Slider label="Panel opacity" val={Math.round(ui.panelOpacity * 100)} min={0} max={100} step={1} unit="%"
          onChange={(v) => setUI({ topbarOpacity: v / 100, sidebarOpacity: v / 100, panelOpacity: v / 100 })} />
        <ColorRow label="Panel background" val={ui.panelColor} onChange={(v) => setUI({ panelColor: v })} />
        <ColorRow label="Text — normal" val={ui.textColor} onChange={(v) => setUI({ textColor: v })} />
        <ColorRow label="Text — dim / hints" val={ui.textColorDim} onChange={(v) => setUI({ textColorDim: v })} />
        <ColorRow label="Selected / highlight" val={ui.accentColor} onChange={(v) => setUI({ accentColor: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="labels" title="Model labels" openId={openId} setOpenId={setOpenId}>
        <ColorRow label="Label colour" val={ui.labelColor} onChange={(v) => setUI({ labelColor: v })} />
        <Slider label="Label size" val={Math.round(ui.labelScale * 100)} min={50} max={200} step={5} unit="%"
          onChange={(v) => setUI({ labelScale: v / 100 })} />
      </CollapsibleSection>

      <CollapsibleSection id="lighting" title="Lighting & background" openId={openId} setOpenId={setOpenId}>
        <ColorRow label="Background" val={ui.bgColor} onChange={(v) => setUI({ bgColor: v })} />
        <Slider label="Brightness" val={Math.round(ui.dirIntensity * 100)} min={0} max={300} step={5} unit="%"
          onChange={(v) => setUI({ dirIntensity: v / 100 })} />
        <Slider label="Ambient fill" val={Math.round(ui.ambientIntensity * 100)} min={0} max={300} step={5} unit="%"
          onChange={(v) => setUI({ ambientIntensity: v / 100 })} />
        <ColorRow label="Light colour" val={ui.lightColor} onChange={(v) => setUI({ lightColor: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="units" title="Units & calibration" openId={openId} setOpenId={setOpenId}>
        <Select label="Active unit" val={cfg.activeUnit} options={UNIT_OPTIONS} onChange={(v) => setCfg({ activeUnit: v as ActiveUnit })} />
        <Select label="Format" val={cfg.lengthFormat} options={LENGTH_FORMAT_OPTIONS} onChange={(v) => setCfg({ lengthFormat: v as LengthFormat })} />
      </CollapsibleSection>

      <CollapsibleSection id="framing" title="Framing" openId={openId} setOpenId={setOpenId}>
        <Select label="Material" val={cfg.framingMaterial} options={[{ value: 'wood', label: 'Wood' }, { value: 'steel', label: 'Steel (CFS)' }]} onChange={(v) => setCfg({ framingMaterial: v as 'wood' | 'steel' })} />
        <Select label="Stud spacing" val={String(cfg.studSpacingIn)} options={[{ value: '16', label: '16" OC' }, { value: '24', label: '24" OC' }]} onChange={(v) => setCfg({ studSpacingIn: Number(v) as 16 | 24 })} />
        <Select label="Wall depth" val={cfg.defaultStudSize} options={[{ value: '2x4', label: '2×4 (3-1/2")' }, { value: '2x6', label: '2×6 (5-1/2")' }]} onChange={(v) => setCfg({ defaultStudSize: v as '2x4' | '2x6' })} />
        <Select label="Corner" val={cfg.cornerType} options={[{ value: 'three-stud', label: 'Three-stud' }, { value: 'california', label: 'California (2-stud)' }]} onChange={(v) => setCfg({ cornerType: v as 'three-stud' | 'california' })} />
      </CollapsibleSection>

      <CollapsibleSection id="roof" title="Roof" openId={openId} setOpenId={setOpenId}>
        <Slider label="Eave / soffit overhang" val={cfg.roofOverhangIn} min={0} max={36} step={1} unit={'"'} onChange={(v) => setCfg({ roofOverhangIn: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="steel" title="Steel" openId={openId} setOpenId={setOpenId}>
        <Select label="Width" val={cfg.steelWidth} options={STEEL_WIDTH_OPTIONS} onChange={(v) => setCfg({ steelWidth: v as typeof cfg.steelWidth })} />
        <Select label="Gauge" val={cfg.steelGauge} options={STEEL_GAUGE_OPTIONS} onChange={(v) => setCfg({ steelGauge: v as typeof cfg.steelGauge })} />
        <Select label="Top track" val={cfg.steelTrackTop} options={STEEL_TRACK_OPTIONS} onChange={(v) => setCfg({ steelTrackTop: v as typeof cfg.steelTrackTop })} />
        <Select label="Bottom track" val={cfg.steelTrackBottom} options={STEEL_TRACK_OPTIONS} onChange={(v) => setCfg({ steelTrackBottom: v as typeof cfg.steelTrackBottom })} />
        <Slider label="Deflection gap" val={cfg.steelDeflectionGapMm} min={0} max={40} step={1} unit="mm" onChange={(v) => setCfg({ steelDeflectionGapMm: v })} />
      </CollapsibleSection>

      {/* WALL DETECTION — the dial for "it is picking up everything, not just
          walls". The panel was written, wired to the store, given six sliders
          with real hints and reset buttons — and imported by nothing, so the
          one control that answers the commonest complaint about the detector
          had no door. Inline here rather than as its own modal: it is a tool
          you use WHILE looking at the plan it tunes, and a centred dialog
          covers the very thing you are judging. */}
      {/* PROJECTS — saving a job, which was not possible at all. projectStorage
          persists the drawings INCLUDING the raw file blobs to IndexedDB, and
          ProjectLibrary is a complete save/list/load UI for it — imported by
          nothing, so an uploaded print died on reload. On a job site that is not
          a missing feature, it is losing your work. */}
      <CollapsibleSection id="projects" title="Projects" openId={openId} setOpenId={setOpenId}>
        <ProjectLibrary inline />
      </CollapsibleSection>

      {/* PRO — the state of the unlock, and the way back to it after a reinstall
          or a new phone. Restore has to be findable without buying anything to
          find it, which is why it sits here rather than only inside the upgrade
          sheet: someone who has already paid should never be shown a price. */}
      <CollapsibleSection id="pro" title={isPro ? 'Pro — unlocked' : 'Pro'} openId={openId} setOpenId={setOpenId}>
        <ProSection />
      </CollapsibleSection>

      <CollapsibleSection id="detect" title="Wall detection" openId={openId} setOpenId={setOpenId}>
        <WallCalibrationPanel inline />
      </CollapsibleSection>

      <CollapsibleSection id="build" title="Build output" openId={openId} setOpenId={setOpenId}>
        <Slider label="Floor height" val={cfg.buildFloorHeightM} min={2} max={6} step={0.1} unit="m" onChange={(v) => setCfg({ buildFloorHeightM: v })} />
        <Select label="Type" val={cfg.buildType} options={BUILD_TYPE_OPTIONS} onChange={(v) => setCfg({ buildType: v as BuildingType })} />
        <Toggle label="Auto framing" val={cfg.buildAutoEnableFraming} onChange={(v) => setCfg({ buildAutoEnableFraming: v })} />
        <Toggle label="Auto shell (slab → fascia)" val={cfg.buildAutoShell} onChange={(v) => setCfg({ buildAutoShell: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="trades" title="Plumbing / Electrical" openId={openId} setOpenId={setOpenId}>
        <Select label="Pipe length" val={String(cfg.pipeStickLengthFt)} options={[{ value: '10', label: "10 ft" }, { value: '12', label: "12 ft" }]} onChange={(v) => setCfg({ pipeStickLengthFt: Number(v) as 10 | 12 })} />
      </CollapsibleSection>

      <CollapsibleSection id="explode" title="Explode" openId={openId} setOpenId={setOpenId}>
        <Slider label="Speed" val={cfg.explodeSpeed} min={0.5} max={12} step={0.5} onChange={(v) => setCfg({ explodeSpeed: v })} />
        {/* Ceiling raised 3× → 8×. The old top end was not enough separation to
            read a wall assembly apart at full explode — layers still overlapped
            at the point they were meant to be most legible. The default is
            unchanged, so this only adds room at the far end for anyone who
            wants it. */}
        <Slider label="Spread" val={cfg.explodeSpread} min={0} max={8} step={0.1} unit="×" onChange={(v) => setCfg({ explodeSpread: v })} />
        {EXPLODE_SYSTEMS.map((sys) => (
          <Slider
            key={sys.key}
            label={sys.label}
            val={cfg.explodeSystemMultipliers[sys.key] ?? 1}
            min={0}
            max={3}
            step={0.1}
            unit="×"
            onChange={(v) => setCfg({ explodeSystemMultipliers: { ...cfg.explodeSystemMultipliers, [sys.key]: v } })}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection id="preview" title="Preview" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Sample room" val={previewMode} onChange={setPreviewMode} />
      </CollapsibleSection>

      {/* HOW MUCH THE BUILD DOES FOR YOU.
          These are settings rather than one baked-in behaviour because there is
          no single right answer: tracing every wall is the point of the app for
          one person and busywork for the next, and which one you are changes
          with the job. Defaults are the helpful end; both switches turn off. */}
      <CollapsibleSection id="buildhelp" title="Build help" openId={openId} setOpenId={setOpenId}>
        <Toggle
          label="Presets: trace it yourself"
          val={ui.presetMode === 'practice'}
          onChange={(v) => setUI({ presetMode: v ? 'practice' : 'ready' })}
        />
        <Toggle
          label="Carry exterior up a storey"
          val={ui.autoCarryShellUp}
          onChange={(v) => setUI({ autoCarryShellUp: v })}
        />
      </CollapsibleSection>

      {/* HEATING DECIDES WHICH TRADE OWNS THE WORK, so it belongs with the
          build decisions and not buried in an HVAC panel. Only forced air has
          ducts; baseboard is electrical, in-floor is plumbing. It also has to
          be answered BEFORE devices are placed — a baseboard under a window
          displaces the receptacle that would otherwise go there. */}
      <CollapsibleSection id="heating" title="Heating" openId={openId} setOpenId={setOpenId}>
        {(Object.keys(HEATING_SYSTEMS) as HeatingType[]).map((key) => (
          <button
            key={key}
            className={`${styles.specBtn} ${ui.heatingType === key ? styles.specBtnOn : ''}`}
            onClick={() => setUI({ heatingType: key })}
            aria-pressed={ui.heatingType === key}
          >
            {HEATING_SYSTEMS[key].label}
          </button>
        ))}
        <p className={styles.sectionNote}>{HEATING_SYSTEMS[ui.heatingType].note}</p>
      </CollapsibleSection>

      <CollapsibleSection id="wordmark" title="3D wordmark" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Visible" val={ui.logo3DVisible} onChange={(v) => setUI({ logo3DVisible: v })} />
        <Toggle label="Motion" val={ui.logo3DAnimated} onChange={(v) => setUI({ logo3DAnimated: v })} />
        <Slider label="Opacity" val={Math.round(ui.logo3DOpacity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setUI({ logo3DOpacity: v / 100 })} />
        <Slider label="Speed" val={ui.logo3DFloatSpeed} min={0} max={5} step={0.1} onChange={(v) => setUI({ logo3DFloatSpeed: v })} />
        <Slider label="Bounce" val={ui.logo3DFloatHeight} min={0} max={2} step={0.05} unit="m" onChange={(v) => setUI({ logo3DFloatHeight: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="grid" title="3D grid" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Visible" val={ui.gridVisible} onChange={(v) => setUI({ gridVisible: v })} />
        <ColorRow label="Color" val={ui.gridColor} onChange={(v) => setUI({ gridColor: v })} />
        <Slider label="Opacity" val={Math.round(ui.gridOpacity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setUI({ gridOpacity: v / 100 })} />
        <Slider label="Cell size" val={ui.gridCellSize} min={0.5} max={10} step={0.5} unit="m" onChange={(v) => setUI({ gridCellSize: v })} />
      </CollapsibleSection>

      {/* Sheathing, barrier, cladding and board USED to live here. They are not
          settings — they are decisions about the building, and they belong in the
          Build drawer with Floors, Framing and Roof. See FinishesPanel. */}

      <button className={styles.resetBtn} onClick={resetAll}>Reset to defaults</button>
    </div>
  )
}

// ── Preset panel content ───────────────────────────────────────────────────
function PresetPanel({ onLoad }: { onLoad: (presetId: PresetDifficulty) => void }) {
  return (
    <div className={styles.presetList}>
      {listPresetDefinitions().map((preset) => (
        <button
          key={preset.id}
          className={styles.presetBtn}
          onClick={() => onLoad(preset.id)}
        >
          {preset.name}
        </button>
      ))}
    </div>
  )
}

// ── Unit converter panel ─────────────────────────────────────────────────────
// Every unit in every combination, in one place. The main flows never make the
// user pick a unit (they read the active unit); this is the on-demand tool for
// the times a tradesperson just needs a quick conversion.
const CONVERTER_CATEGORIES: Array<{
  kind: ConverterKind; label: string; units: Array<{ value: ConverterUnit; label: string }>
}> = [
  { kind: 'length', label: 'Length', units: [
    { value: 'mm', label: 'mm' }, { value: 'cm', label: 'cm' }, { value: 'm', label: 'm' },
    { value: 'in', label: 'in' }, { value: 'ft', label: 'ft' }, { value: 'yd', label: 'yd' },
  ] },
  { kind: 'area', label: 'Area', units: [
    { value: 'mm2', label: 'mm²' }, { value: 'm2', label: 'm²' }, { value: 'ft2', label: 'ft²' }, { value: 'yd2', label: 'yd²' },
  ] },
  { kind: 'volume', label: 'Volume', units: [
    { value: 'm3', label: 'm³' }, { value: 'ft3', label: 'ft³' }, { value: 'yd3', label: 'yd³' },
  ] },
  { kind: 'weight', label: 'Weight', units: [
    { value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' },
  ] },
  { kind: 'temperature', label: 'Temperature', units: [
    { value: 'c', label: '°C' }, { value: 'f', label: '°F' },
  ] },
  { kind: 'pressure', label: 'Pressure', units: [
    { value: 'kpa', label: 'kPa' }, { value: 'psi', label: 'psi' },
  ] },
]

function formatConverted(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return parseFloat(n.toFixed(4)).toString()
}

function ConverterPanel() {
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const [kind, setKind] = useState<ConverterKind>('length')
  const [value, setValue] = useState('1')
  const [from, setFrom] = useState<ConverterUnit>(activeUnit)
  const [to, setTo] = useState<ConverterUnit>('ft')

  const cat = CONVERTER_CATEGORIES.find((c) => c.kind === kind) ?? CONVERTER_CATEGORIES[0]
  const unitValues = cat.units.map((u) => u.value)

  // Derive the effective units during render (no setState-in-effect): if the
  // stored unit isn't valid for the chosen category, fall back. Length defaults
  // its "from" to the app's active unit, so the common case needs no picking.
  const fromEff: ConverterUnit = unitValues.includes(from)
    ? from
    : (kind === 'length' && unitValues.includes(activeUnit) ? activeUnit : cat.units[0].value)
  const toEff: ConverterUnit = unitValues.includes(to) && to !== fromEff
    ? to
    : (cat.units.find((u) => u.value !== fromEff) ?? cat.units[0]).value

  const numeric = Number.parseFloat(value)
  const hasValue = Number.isFinite(numeric)
  const result = hasValue ? convertValue(kind, numeric, fromEff, toEff) : NaN

  return (
    <div className={styles.settingsBody}>
      <label className={styles.settingRow}>
        <span className={styles.settingLabel}>Measure</span>
        <select className={styles.settingSelect} value={kind} onChange={(e) => setKind(e.target.value as ConverterKind)}>
          {CONVERTER_CATEGORIES.map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}
        </select>
      </label>

      <label className={styles.settingRow}>
        <span className={styles.settingLabel}>Value</span>
        <input className={styles.convInput} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
        <select className={styles.settingSelect} value={fromEff} onChange={(e) => setFrom(e.target.value as ConverterUnit)}>
          {cat.units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
      </label>

      <div className={styles.convSwapRow}>
        <button className={styles.convSwap} onClick={() => { setFrom(toEff); setTo(fromEff) }} title="Swap units">⇅</button>
      </div>

      <label className={styles.settingRow}>
        <span className={styles.settingLabel}>Result</span>
        <span className={styles.convResult}>{formatConverted(result)}</span>
        <select className={styles.settingSelect} value={toEff} onChange={(e) => setTo(e.target.value as ConverterUnit)}>
          {cat.units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
      </label>

      <p className={styles.settingGroup}>All units</p>
      <div className={styles.convList}>
        {cat.units.map((u) => (
          <div key={u.value} className={styles.convListRow}>
            <span className={styles.convListUnit}>{u.label}</span>
            <span className={styles.convListVal}>{hasValue ? formatConverted(convertValue(kind, numeric, fromEff, u.value)) : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Layout ───────────────────────────────────────────────────────────────────
export default function WorkspaceLayout() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // SCAN means the camera. It called the same file picker as Browse, so the two
  // chips were the same button wearing different words — and the one thing a
  // tradesperson actually does on site, photograph the print on the tailgate,
  // took as many taps as digging through the gallery. CameraCapture already
  // existed and was already wired into DrawingUploader; the workspace chip just
  // never reached it.
  const [scanOpen, setScanOpen] = useState(false)

  // Auto-build DISABLED — the user builds by tracing (this "model builds itself"
  // behaviour was deliberately reverted; re-enabling it auto-laid slabs coplanar
  // with existing floors, causing z-fighting/flashing as the camera moved).
  // useAutoBuild()

  const drawings            = useAppStore((s) => s.drawings)
  const selectedDrawingId   = useAppStore((s) => s.selectedDrawingId)
  const reprocessDrawing    = useAppStore((s) => s.processDrawing)
  const addDrawings         = useAppStore((s) => s.addDrawings)
  const loadPresetDrawing   = useAppStore((s) => s.loadPresetDrawing)
  const presetMode          = useUISettingsStore((s) => s.presetMode)
  const setUI               = useUISettingsStore((s) => s.set)
  const showcaseCladding    = useUISettingsStore((s) => s.cladding)
  const hasHistory = useAppStore((s) => s.historyPast.length > 0)
  const selectionGranularity = useFloorplanLocalStore((s) => s.selectionGranularity)
  const selectedMemberLabel = useFloorplanLocalStore((s) => s.selectedMemberLabel)
  const isolatedMemberId = useFloorplanLocalStore((s) => s.isolatedMemberId)
  const setIsolatedMember = useFloorplanLocalStore((s) => s.setIsolatedMember)
  const setSelectionGranularity = useFloorplanLocalStore((s) => s.setSelectionGranularity)
  const traceModeActive = useFloorplanLocalStore((s) => s.traceMode)
  const traceStartPt = useFloorplanLocalStore((s) => s.traceStart)
  const pendingTrace = useFloorplanLocalStore((s) => s.pendingWalls)
  // Enabled when there's real history OR a trace step in progress to back out of.
  const canUndo = hasHistory || (traceModeActive && (!!traceStartPt || !!pendingTrace))

  // Undo, trace-aware: during an active trace, undo the last TRACE STEP (discard
  // pending walls, else clear a dangling start point) instead of a coarse history
  // undo that pops you out of tracing back to the type-picker menu. Matches Esc.
  // Only falls through to the real history undo once there's no in-progress point.
  const smartUndo = useCallback(() => {
    const fp = useFloorplanLocalStore.getState()
    if (fp.traceMode) {
      if (fp.pendingWalls) { fp.setPendingWalls(null); return }
      if (fp.traceStart) { fp.setTraceStart(null); return }
    }
    useAppStore.getState().undo()
  }, [])
  const annotateMode = useAppStore((s) => s.annotateMode)
  const setAnnotateMode = useAppStore((s) => s.setAnnotateMode)
  const explodeAmount = useAppStore((s) => s.explodeAmount)
  const setExplodeAmount = useAppStore((s) => s.setExplodeAmount)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const calibrationMode = useAppStore((s) => s.floorplanOverlay.calibrationMode)

  // Edit-everything mode (post-build direct manipulation). The toggle only shows
  // once there's a standing model to grab.
  const editMode = useFloorplanLocalStore((s) => s.editMode)
  const setEditMode = useFloorplanLocalStore((s) => s.setEditMode)
  /** The one-time unlock — decides the export watermark and the gated verbs. */
  const isPro = useAppStore((s) => s.isPro)
  // Happy-place invariant: no drawer over the workspace while tracing.
  const traceMode = useFloorplanLocalStore((s) => s.traceMode)
  const placeObjectType = useFloorplanLocalStore((s) => s.placeObjectType)
  // Lock-driven edit: an ACTION owns the workspace. Any active action (tracing,
  // calibrating, arming a placement) locks it — edit/select is NOT available and
  // auto-disarms. Only when IDLE is edit offered. (User: edit "can't be on all
  // the time — it needs to be smart".)
  const actionActive = traceMode || calibrationMode || placeObjectType != null
  useEffect(() => {
    if (editMode && actionActive) setEditMode(false)
  }, [editMode, actionActive, setEditMode])
  // Floors the user actually HAS, from what they've traced/placed — not from
  // model.floorLevels, which only exists after a build. The floor bar (fade +
  // isolate) was gated on the built model, so on an unbuilt plan it never
  // appeared even though the floors were plainly there and double-tap could
  // already fade them. Gating on real content keeps fade reachable everywhere
  // the gesture reaches, which is what lets the gesture be rebound later.
  // Returns a joined STRING so the selector stays referentially stable and does
  // not re-render this layout on every unrelated store write.
  const floorKey = useAppStore((s) => {
    const set = new Set<number>()
    for (const d of s.drawings) for (const w of d.parsedWalls) if (w.source === 'user') set.add(w.level ?? 0)
    for (const a of s.floorsAreas) set.add(a.level ?? 0)
    for (const a of s.roofAreas) set.add(a.level ?? 0)
    for (const o of s.placedObjects) set.add(o.level ?? 0)
    s.model.floorLevels.forEach((_, i) => set.add(i))
    return [...set].sort((a, b) => a - b).join(',')
  })
  const availableFloors = useMemo(
    () => (floorKey ? floorKey.split(',').map(Number) : []),
    [floorKey],
  )
  const isolatedFloor = useFloorplanLocalStore((s) => s.isolatedFloor)
  const setIsolatedFloor = useFloorplanLocalStore((s) => s.setIsolatedFloor)
  // What the selection can be told to do. Buttons, not handles — see selectionEdit.
  const selectionEdit = useSelectionEdit()

  // Stair settings for the rail, when the selection IS a stair. Solved live so
  // the riser count follows the tread the moment you change it.
  const placedObjects = useAppStore((s) => s.placedObjects)
  const updatePlacedObject = useAppStore((s) => s.updatePlacedObject)
  const editSelected = useFloorplanLocalStore((s) => s.editSelected)

  /**
   * AUTO-LANDING IN PLAN IS PULLED for now — the manual toggle stays.
   *
   * Opening a new drawing straight into plan is right, and the flow is what the
   * user asked for. But on load it raced the build: the print ended up hidden
   * along with the model (4 meshes visible, 1471 hidden) and plan came up
   * blank. The PLAN button in the rail works reliably because by then
   * everything has settled, so that is what ships tonight rather than a broken
   * first impression. Re-land this once entering plan waits for the overlay and
   * the build to be ready, instead of firing on the status flag.
   */
  const wallDetailExplode = useFloorplanLocalStore((s) => s.wallDetailExplode)
  const setWallDetailExplode = useFloorplanLocalStore((s) => s.setWallDetailExplode)
  const detailExplodeId = useFloorplanLocalStore((s) => s.detailExplodeId)
  const setDetailExplodeId = useFloorplanLocalStore((s) => s.setDetailExplodeId)
  const activePanel = useFloorplanLocalStore((s) => s.activePanel)
  const openSelectionPanel = useFloorplanLocalStore((s) => s.openSelectionPanel)
  const stairEdit = useMemo(() => {
    if (editSelected?.kind !== 'object') return null
    const o = placedObjects.find((x) => x.id === editSelected.id)
    if (!o || o.type !== 'stairs') return null
    const item = getCatalogItem(o.type)
    const rise = (item?.defaultH ?? 2.9) * o.scaleY
    const sol = solveStair({
      totalRiseM: rise,
      shape: stairShapeFromSubtype(o.subtype),
      treadM: o.treadM,
      widthM: o.stairWidthM,
      targetRiserM: o.targetRiserM,
      landingM: o.landingM,
    })
    const inches = (m: number) => Math.round(m / 0.0254)
    return {
      riserCount: sol.riserCount,
      riserIn: (sol.riserM / 0.0254).toFixed(2),
      treadIn: inches(sol.treadM),
      widthIn: inches(sol.widthM),
      landingIn: o.landingM === null ? 0 : (o.landingM != null ? inches(o.landingM) : inches(sol.landingsM[0] ?? 0)),
      straight: sol.shape === 'straight',
      problems: stairIssues(sol, Math.max(0, rise - 0.32)).map((p) => `${p.message} (${p.code})`),
      set: (patch: Parameters<typeof updatePlacedObject>[1]) => updatePlacedObject(o.id, patch),
    }
  }, [editSelected, placedObjects, updatePlacedObject])
  // Move step, in the active unit. Mirrors the wall D-pad's 1/6/12 so a step
  // means the same thing wherever you nudge from.
  const [editStep, setEditStep] = useState(1)
  const activeUnit = useConfigStore((s) => s.activeUnit)
  const stepM = convertLength(editStep, activeUnit, 'mm') / 1000
  const ghostedLevels = useFloorplanLocalStore((s) => s.ghostedLevels)
  const toggleGhostedLevel = useFloorplanLocalStore((s) => s.toggleGhostedLevel)

  // Single source of truth: the chrome panels are driven by the store's
  // activePanel gate, the same gate every other overlay UI checks.
  const closePanels = useFloorplanLocalStore((s) => s.closeAllPanels)
  const settingsDrawerOpen = useFloorplanLocalStore((s) => s.settingsDrawerOpen)
  const askDrawerOpen = useFloorplanLocalStore((s) => s.askDrawerOpen)
  const placeDrawerOpen = useFloorplanLocalStore((s) => s.placeDrawerOpen)
  const setDrawerOpen = useFloorplanLocalStore((s) => s.setDrawerOpen)
  const startTutorial = useFloorplanLocalStore((s) => s.startTutorial)

  // Re-enter calibration: reset picked points and let the ambient guide drive.
  const recalibrate = () => {
    const fp = useFloorplanLocalStore.getState()
    fp.setTraceMode(false)
    fp.setTraceStroke([])
    fp.setCalibrationA(null)
    fp.setCalibrationB(null)
    fp.setHoverPixel(null)
    fp.setDistanceInput('')
    updateOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
    closePanels()
  }

  // Free exports carry a corner mark; Pro exports the canvas untouched. The
  // export itself is never blocked — a share is how other trades find the app,
  // so the free tier keeps it and simply signs it.
  const sharePng = () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    try {
      const a = document.createElement('a')
      a.href = isPro ? canvas.toDataURL('image/png') : watermarkedPng(canvas)
      a.download = `theprints3d-${Date.now()}.png`
      a.click()
    } catch (e) {
      console.error('Snapshot failed', e)
      alert('Snapshot failed — orbit the view once, then retry.')
    }
  }

  // Re-run Wizard — ensure a build (so decisions exist), then open the wizard
  // panel (mounted by ModelViewer) and close the chrome panel.
  const reRunWizard = () => {
    const app = useAppStore.getState()
    if (!app.buildResult) app.buildForMe()
    useFloorplanLocalStore.getState().setWizardOpen(true)
    closePanels()
  }

  const handleLoadPreset = (presetId: PresetDifficulty) => {
    try {
      // PRACTICE IS A CHOICE, NOT THE ONLY OPTION.
      //
      // This passed a hard-coded `true` — practice mode — which strips
      // parsedWalls to []. The walls then exist only as ink on the image, and
      // everything that reasons about walls has nothing to reason about: doors
      // have nothing to orient to or seat into, "Find the rest" has no seed, the
      // envelope has no perimeter. And there was no UI anywhere to turn it off,
      // so it was not a choice anyone could make.
      //
      // Practice is right for someone learning to read a plan, which is who a
      // preset is for, so it is the DEFAULT again — a preset that arrives as a
      // finished house leaves nothing to practise on. 'ready' is one switch
      // away for when you want the shell handed to you. See Settings → Build
      // help.
      loadPresetDrawing(presetId, presetMode === 'practice')
      // UX convention: a one-shot pick (preset, file, etc.) retracts the panel.
      closePanels()
    } catch (error) {
      console.error('Failed to load preset:', presetId, error)
    }
  }
  /**
   * A FINISHED HOUSE, STANDING, IN ONE TAP.
   *
   * Every other way in gives you a job to do: a preset is a print to trace, an
   * upload is a print to build. Nothing in the app ever just SHOWED you the
   * thing the app makes. That left no way to see what you were working towards
   * before doing the work — and no way to hand someone the phone and let them
   * turn a building over in their hands.
   *
   * Not a special mode and not a canned scene: it is the ordinary preset path
   * with the switches set the way they would be at the END of a build — walls
   * in the data rather than stripped out, and finishes applied instead of
   * waiting to be asked for. So everything works on it exactly as it works on
   * a model you built: explode, x-ray, layers, edit, inspect, measure.
   */
  const loadShowcaseModel = () => {
    try {
      // 'hard' is Two-Storey with Garage. 'medium' is the Three-Bed Ranch —
      // a single storey that merely SHIPS a second-floor sheet, so it loads as
      // one level with an empty floor above and shows none of the stacking.
      loadPresetDrawing('hard', false)
      /**
       * THE SHOWCASE MUST NOT REWRITE YOUR SETTINGS.
       *
       * Turning the finish layers on is right HERE — the whole point of this
       * model is to be looked at, and a dried-in shell is not that. But these
       * writes persist, so pressing Practice model once switched sheathing and
       * board on for every project afterwards, including a real print uploaded
       * later. The user found exactly that: walls popping out with sheathing
       * and board on despite both being off by default.
       *
       * Sheathing and board stay OFF. They are interior/structural layers you
       * turn on to inspect, and a showcase does not need them to look finished
       * — what makes it read as a house is the cladding and the wrap, which is
       * all this now enables. Anyone who wants to see the sheathing has a
       * toggle for it, and it is no longer decided for them behind their back.
       */
      setUI({
        finishesApplied: true,
        wrapVisible: true,
        claddingVisible: true,
        // Default cladding is 'none' — a dried-in shell. A showcase should be
        // clad, or the exterior reads as unfinished.
        cladding: showcaseCladding === 'none' ? 'fiber-cement-lap' : showcaseCladding,
      })
      // Stand the upper storey up too. Carrying the shell up normally happens
      // the moment you MOVE to floor 2 — nobody has moved anywhere here, so a
      // showcase would otherwise be a two-storey house with an empty second
      // floor, which is the one thing it must not be.
      // NO CARRY-UP HERE, deliberately, having tried it.
      //
      // Carrying the shell up adds level-1 walls to the SAME drawing, but the
      // storey list is computed from drawings — so the building never learns it
      // has two floors. The shell then gets derived for one storey and the ROOF
      // lands at level 0, underneath the second storey's walls. A house with
      // its roof in the middle of it.
      //
      // Openings do not carry either, so the upper floor came out a windowless
      // box. A correct one-storey house beats a broken two-storey one; proper
      // multi-storey wants the storey list fixed first, which is its own job.
      // ORDER MATTERS, and getting it wrong is what put studs through the
      // doorways. The framing engine reads its openings from PLACED OBJECTS —
      // that is how it knows to skip studs and add king/jack/header. Build
      // first and it frames a wall with no openings in it, and the doors that
      // arrive afterwards are just holes with sticks across them.
      //
      // So: hang the doors and windows FIRST, then frame around them. Then run
      // it once more for the roof, because buildForMe derives one and throws it
      // away (tracing a roof is meant to be an act). The second pass cannot
      // duplicate anything — openings dedupe on position.
      useAppStore.getState().finishShell()
      useAppStore.getState().buildForMe()
      useAppStore.getState().finishShell()
      closePanels()
    } catch (error) {
      console.error('Failed to load showcase model:', error)
    }
  }

  // Start the guided "build a whole house" walkthrough. Drops a starter plan
  // first if the workspace is empty so step 1 (the plan) is already satisfied.
  const startGuidedTour = () => {
    if (drawings.length === 0) handleLoadPreset('easy')
    // Marked on START, not on finish — see onboarding/firstRun.ts. Someone who
    // bails three steps in has answered the question.
    markToured()
    setFirstRun(false)
    startTutorial()
  }
  const hasDrawings = drawings.length > 0
  // Onboarding card persists until a plan is actually loaded — no dismiss.
  const showUploadHint = !hasDrawings
  /** Never been shown around. Read once into state so the invitation cannot
   *  flicker away mid-render when the flag is written. */
  const [firstRun, setFirstRun] = useState(() => !hasToured())

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) { addDrawings(files) }
    e.target.value = ''
  }

  // ─── THE Escape owner ──────────────────────────────────────────────────────
  //
  // Exactly ONE window-level Escape handler for the whole app, dismissing ONE
  // thing per press, most specific first.
  //
  // There used to be three, none aware of the others: this one closed the
  // Settings AND Ask drawers, FloorplanPanel closed panels/placement and stepped
  // back through a trace, and FloorplanOverlay separately disarmed placement. A
  // single Escape while placing with Settings open fired all three — disarming
  // the tool, closing Settings and closing Ask in one keystroke. Nobody decided
  // that; it accreted, exactly like the gesture map (docs/INTERACTIONS.md).
  //
  // Escape means "back out of the innermost thing", so the order is by depth:
  // the tool you're holding, then the action you're in, then a card, then a
  // drawer, then any selection. Each branch RETURNS — one press, one dismissal.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Text fields own their own Escape (cancel the edit); those handlers are
      // scoped to the field and must win over anything global.
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      const st = useFloorplanLocalStore.getState()

      // 0. A STUCK GESTURE LOCK IS NOT A STATE, SO IT NEVER COSTS A PRESS.
      //
      // gestureLock freezes the camera while a layer owns the pointer. It is
      // released on pointer-up now wherever that happens (see ModelViewer), so
      // it should never still be up by the time anyone reaches for Escape — but
      // if it somehow is, the workspace is frozen with nothing on screen to
      // explain why, and Escape is the one thing everybody tries. Cleared
      // WITHOUT returning, so this cannot swallow the press that was meant to
      // close a panel.
      if (st.gestureLock) st.setGestureLock(false)

      // 1. A tool is in your hand — put it down.
      if (st.placeObjectType) { st.setPlaceObjectType(null); return }
      if (st.wallTrimArmed) { st.setWallTrimArmed(false); return }

      // 2. Mid-action — step back one stage at a time, don't dump the whole run.
      if (st.traceMode) {
        if (st.pendingWalls) { st.setPendingWalls(null); return }
        if (st.traceStart) { st.setTraceStart(null); return }
        st.setTraceMode(false); st.setTraceStroke([]); st.setHoverPixel(null); st.setPlumbNudge(null)
        return
      }

      // 3. A card or picker is open.
      if (st.activePanel) { st.closeAllPanels(); return }

      // 4. A drawer is open (they're mutually exclusive, so at most one hits).
      if (st.buildDrawerOpen) { st.setDrawerOpen('build', false); return }
      if (st.placeDrawerOpen) { st.setDrawerOpen('place', false); return }
      if (st.askDrawerOpen) { st.setDrawerOpen('ask', false); return }
      if (st.settingsDrawerOpen) { st.setDrawerOpen('settings', false); return }

      // 5. Nothing open — clear any lingering selection.
      st.closeAllPanels()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [])

  // Global undo/redo shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y.
  // Skipped while typing so text fields keep their native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement | null
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) useAppStore.getState().redo()
        else smartUndo()
      } else if (key === 'y') {
        e.preventDefault()
        useAppStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [smartUndo])

  return (
    <div className={styles.root}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {scanOpen && (
        <CameraCapture
          onCapture={(file) => { setScanOpen(false); addDrawings([file]) }}
          onClose={() => setScanOpen(false)}
          /* getUserMedia needs a secure context; over plain LAN http on a phone
             it is blocked, so fall back to the input, which still opens the
             rear camera on mobile. */
          onFallback={() => { setScanOpen(false); fileInputRef.current?.click() }}
        />
      )}

      {/* 3D Viewport — fills the whole screen at all times.
          It briefly shrank while the tour was running, to hand the coach its
          own band. That was the wrong trade: the print ended up small and shoved
          to the top of the screen, which is a bigger insult to the drawing than
          a line of text near its bottom edge ever was. The answer was to make
          the coach small, not to make the workspace smaller. */}
      <div className={styles.viewport}>
        <ModelViewer />
      </div>

      {/* Brand mark — the SAME 3D extruded wordmark twice: a large floating
          watermark over the workspace, and a small crisp replica top-left. Both
          obey Settings → 3D wordmark (Visible off / Motion off) so promo footage
          can be fully logo-free or frozen. */}
      <Logo3DBadge />
      <Logo3DBadge variant="mark" />

      {/* Persistent global actions, top-right. Build / Settings / Place each
          have their own always-visible edge tab, so they're not icons here. */}
      <TopIcons
        onUndo={smartUndo}
        canUndo={canUndo}
      />

      {/* RIGHT drawer — Settings & view. Always mounted so its tab stays on the
          edge; the body retracts off-screen until opened. The Explode control
          folds in here (single home — no separate floating bar). */}
      {/* SPIKE: the whole UI as a slim persistent rail with cascading sub-columns
          (RailCascade). Representative content for now — feeling out the pattern
          before real menus migrate in. Temporarily stands in for the tabbed
          drawers below. */}
      <RailCascade />

      <EdgeDrawer
        side="left"
        inRail
        title="Settings"
        tabLabel="Settings"
        tabIcon="⚙"
        tourTab="settings-tab"
        open={settingsDrawerOpen && !traceMode}
        onToggle={() => setDrawerOpen('settings', !settingsDrawerOpen)}
      >
        <SettingsContent />
        <div className={styles.specDivider} />
        <p className={styles.sectionTitle}>Tools</p>
        <button className={styles.specBtn} onClick={() => { setDrawerOpen('settings', false); startGuidedTour() }}>🎓 Guided tutorial</button>
        <button className={styles.specBtn} onClick={() => fileInputRef.current?.click()}>Load Preset</button>
        <PresetPanel onLoad={handleLoadPreset} />
        <button className={styles.specBtn} onClick={recalibrate}>
          {calibrationMode ? 'Calibrating…' : 'Recalibrate'}
        </button>
        <button className={styles.specBtn} onClick={reRunWizard}>Re-run Wizard</button>
        <p className={styles.sectionTitle}>Annotate &amp; Export</p>
        <button className={styles.specBtn} onClick={() => setAnnotateMode(!annotateMode)}>
          {annotateMode ? 'Stop annotating' : 'Annotate'}
        </button>
        <button className={styles.specBtn} onClick={sharePng}>Share PNG</button>
        <button className={styles.specBtn} onClick={() => fileInputRef.current?.click()}>Export</button>
        <AnnotationPanel />
        <p className={styles.sectionTitle}>Material takeoff</p>
        <TakeoffContent />
        <p className={styles.sectionTitle}>Unit converter</p>
        <ConverterPanel />
      </EdgeDrawer>

      {/* Ask is panel-less: a floating bottom overlay (AskAI positions itself),
          mounted only while open so it never leaks over the workspace. */}
      {askDrawerOpen && !traceMode && <AskAI />}

      {/* Onboarding hint — near-invisible, only when no drawings are loaded. The
          grid itself is the drop target, so this is just a whisper + a few chips. */}
      {showUploadHint && (
        <div className={styles.uploadHint}>
          {/* FIRST LAUNCH LEADS WITH THE TOUR.
              Everything below this was already here, and that was the problem:
              a person who has never seen the app was handed seven equal chips —
              Browse, Scan, Tour, Practice, and three presets — with no way to
              rank them. Someone who knows the trade but not this app has no
              reason to read "Tour" as "start here". So on a first run it stops
              being a sibling and becomes the offer, in a sentence that says what
              they get; the other doors stay open, one line down, for anyone who
              would rather dig in. Second launch onward, this collapses back to
              the row it always was. */}
          {firstRun ? (
            <>
              <p className={styles.uploadHintLead}>New here? I’ll build a whole house with you — floor, walls, roof, pipes and wire — one tap at a time.</p>
              <button className={styles.uploadHintPrimary} onClick={startGuidedTour}>🎓 Show me how</button>
              <p className={styles.uploadHintSub}>or start on your own</p>
            </>
          ) : (
            <p className={styles.uploadHintSub}>Drop a plan on the grid, or start from a preset</p>
          )}
          <div className={styles.uploadHintActions}>
            <button className={styles.uploadHintChip} onClick={() => fileInputRef.current?.click()}>Browse</button>
            <button className={styles.uploadHintChip} onClick={() => setScanOpen(true)}>Scan</button>
            {!firstRun && <button className={styles.uploadHintChip} onClick={startGuidedTour}>🎓 Tour</button>}
          </div>
          {/* The only door into a FINISHED house. Everything else here hands
              you a job; this hands you the result, to turn over and pull
              apart before deciding whether the work is worth it. */}
          <button className={styles.showcaseChip} onClick={loadShowcaseModel}>
            Practice model
          </button>
          <PresetPanel onLoad={handleLoadPreset} />
        </div>
      )}

      {/* WHICH SHEET THIS CAME FROM. Say it out loud.
          A multi-page PDF gets ONE of its sheets picked automatically, and
          until now the app never mentioned which — you were shown a building
          with no way of knowing it came from sheet 3 of 6, or that the pick
          could be wrong. On an instructional brochure it once chose a section
          drawing and looked simply broken.
          Only appears when there was a choice to make. Ambient text on the
          perimeter, not a card: a line you can read and ignore. */}
      {(() => {
        const d = drawings.find((x) => x.id === selectedDrawingId) ?? drawings[0]
        if (!d || d.pageCount <= 1 || d.status === 'processing') return null
        const go = (page: number) => {
          if (page >= 1 && page <= d.pageCount) reprocessDrawing(d.id, page)
        }
        return (
          <div className={styles.sheetNote}>
            <button
              className={styles.sheetStep}
              onClick={() => go(d.currentPage - 1)}
              disabled={d.currentPage <= 1}
              aria-label="Previous sheet"
            >‹</button>
            <span>Sheet {d.currentPage} of {d.pageCount}</span>
            <button
              className={styles.sheetStep}
              onClick={() => go(d.currentPage + 1)}
              disabled={d.currentPage >= d.pageCount}
              aria-label="Next sheet"
            >›</button>
          </div>
        )
      })()}

      {/* Edit lives in the RAIL now (RailCascade), with the other verbs.
          It floated here at bottom-left, which sat it right beside CLEAR —
          the adjacency Clear was pushed to the rail foot to avoid. */}

      {/* Persistent Explode slider — a narrow VERTICAL column on the right edge,
          pulled up rather than dragged sideways, so it takes a strip of chrome
          instead of a bar across the middle of the bottom. RETAINED on mobile
          even with the Place sheet open (Android parity) — it just lifts above the
          sheet so it never overlaps. Hidden only during calibration. */}
      {hasDrawings && !calibrationMode && !traceMode && (
        <div className={`${styles.explodeBar} ${placeDrawerOpen ? styles.explodeBarLifted : ''}`}>
          {/* A little bomb — but DRAWN, not an emoji. Every other icon in this
              chrome is a thin monochrome glyph taking its colour from the theme;
              a colour emoji is a filled multi-colour blob and stays one however
              much you desaturate it. This inherits currentColor, so it dims,
              highlights and re-themes exactly like the rail does. */}
          <svg
            className={styles.explodeIcon}
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <title>Explode</title>
            {/* Comic-book burst: eight spikes, alternating long and short radii
                about the centre. Drawn rather than typed so it takes
                currentColor like every other glyph in the chrome. */}
            <path d="M23 12 18.3 14.6 19.8 19.8 14.6 18.3 12 23 9.4 18.3 4.2 19.8 5.7 14.6 1 12 5.7 9.4 4.2 4.2 9.4 5.7 12 1 14.6 5.7 19.8 4.2 18.3 9.4 Z" />
            {/* The bomb inside it, with a stub of fuse. */}
            <circle cx="11.4" cy="12.6" r="3.1" />
            <path d="M13.6 10.4 15.2 8.8" />
          </svg>
          <span className={styles.explodeLabel}>Explode</span>
          <input
            className={styles.explodeSlider}
            type="range" min={0} max={1} step={0.01} value={explodeAmount}
            onChange={(e) => setExplodeAmount(Number(e.target.value))}
            aria-label="Explode separation"
            title="Explode"
          />
          {/* Reserved even at 0 so the slider never shifts down the moment you
              touch it — a control that moves under your finger. */}
          <button
            className={styles.explodeReset}
            style={{ visibility: explodeAmount > 0 ? 'visible' : 'hidden' }}
            onClick={() => setExplodeAmount(0)}
            aria-label="Reset explode"
            aria-hidden={explodeAmount === 0}
          >
            ×
          </button>
        </div>
      )}

      {/* EDIT RAIL — what you can do to the selection, as buttons that do the
          thing they are named after. This replaced a 3D gizmo (drei
          TransformControls arrows/rings on the model): the handles were hard to
          hit on a phone, they covered the component being edited, and they were
          forever buried in geometry. A tap here is unambiguous and lands one
          undo step.

          Only the verbs the selection can honestly express are shown — a floor
          is an axis-aligned rect with no rotation field, so it gets Move ·
          Stretch and no Rotate button that would spin nothing.

          Lives in the chrome on the right edge, mirroring the left rail, so it
          never sits on top of the thing you are editing. */}
      {/* WHAT THE NEXT TAP WILL PICK.
          Shown whenever edit mode is on, with or without a selection — the
          whole value of a stated mode is knowing BEFORE you tap. Tapping a stud
          and getting the whole wall is right most of the time and useless the
          rest of it, and guessing from tap-length or zoom would make an already
          sensitive editor unpredictable.
          One switch for the entire model, because the distinction is the same
          everywhere: wall/stud, deck/joist, roof/rafter. */}
      {editMode && !traceMode && !calibrationMode && (
        <div className={styles.grainSwitch}>
          <span className={styles.grainCaption}>Select</span>
          <button
            className={`${styles.grainBtn} ${selectionGranularity === 'assembly' ? styles.grainBtnOn : ''}`}
            onClick={() => setSelectionGranularity('assembly')}
            title="Tap picks the whole wall, deck or roof"
            aria-pressed={selectionGranularity === 'assembly'}
          >Whole</button>
          <button
            className={`${styles.grainBtn} ${selectionGranularity === 'member' ? styles.grainBtnOn : ''}`}
            onClick={() => setSelectionGranularity('member')}
            title="Tap picks the single stud, plate, joist or rafter under it"
            aria-pressed={selectionGranularity === 'member'}
          >Member</button>
        </div>
      )}

      {/* A PICKED MEMBER, named, with the one verb that matters for it.
          The generic edit rail below is built around assemblies — move, stretch,
          rotate a wall — and none of that is what you want from a single stud.
          What you want is to SEE it, so this offers exactly that and says which
          stick you are holding. */}
      {editMode && editSelected?.kind === 'member' && !traceMode && !calibrationMode && (
        <div className={styles.memberRail}>
          <span className={styles.editRailLabel}>{selectedMemberLabel ?? 'Member'}</span>
          <button
            className={`${styles.grainBtn} ${isolatedMemberId ? styles.grainBtnOn : ''}`}
            onClick={() => setIsolatedMember(isolatedMemberId ? null : editSelected.id)}
            aria-pressed={!!isolatedMemberId}
          >
            {isolatedMemberId ? 'Show all' : 'Isolate'}
          </button>
        </div>
      )}

      {editMode && selectionEdit && !traceMode && !calibrationMode && (
        <div className={styles.editRail}>
          <span className={styles.editRailLabel}>{selectionEdit.label}</span>

          {selectionEdit.verbs.includes('move') && (
            <>
              {/* Step size — same 1/6/12 ladder as the wall D-pad, so a "step"
                  means one thing everywhere. Tap to cycle. */}
              <button
                className={styles.editRailStep}
                onClick={() => setEditStep((s) => (s === 1 ? 6 : s === 6 ? 12 : 1))}
                title="Change step size"
              >
                {editStep} {activeUnit}
              </button>
              <div className={styles.editRailPad}>
                <button style={{ gridArea: 'up' }} className={styles.editRailBtn}
                  onClick={() => selectionEdit.apply({ dz: -stepM })} aria-label="Move up">↑</button>
                <button style={{ gridArea: 'left' }} className={styles.editRailBtn}
                  onClick={() => selectionEdit.apply({ dx: -stepM })} aria-label="Move left">←</button>
                <button style={{ gridArea: 'right' }} className={styles.editRailBtn}
                  onClick={() => selectionEdit.apply({ dx: stepM })} aria-label="Move right">→</button>
                <button style={{ gridArea: 'down' }} className={styles.editRailBtn}
                  onClick={() => selectionEdit.apply({ dz: stepM })} aria-label="Move down">↓</button>
              </div>
            </>
          )}

          {selectionEdit.verbs.includes('rotate') && (
            <div className={styles.editRailGroup}>
              <span className={styles.editRailCaption}>Rotate</span>
              <div className={styles.editRailPair}>
                <button className={styles.editRailBtn} aria-label="Rotate left 15 degrees"
                  onClick={() => selectionEdit.apply({ rot: -ROT_STEP })}>↺</button>
                <button className={styles.editRailBtn} aria-label="Rotate right 15 degrees"
                  onClick={() => selectionEdit.apply({ rot: ROT_STEP })}>↻</button>
              </div>
            </div>
          )}

          {selectionEdit.verbs.includes('stretch') && (
            <div className={styles.editRailGroup}>
              <span className={styles.editRailCaption}>Stretch</span>
              <div className={styles.editRailPair}>
                <button className={styles.editRailBtn} aria-label="Shrink"
                  onClick={() => selectionEdit.apply({ factor: 1 / STRETCH_STEP })}>−</button>
                <button className={styles.editRailBtn} aria-label="Grow"
                  onClick={() => selectionEdit.apply({ factor: STRETCH_STEP })}>+</button>
              </div>
            </div>
          )}

          {/* SPECS — the property card, on request only.
              Selecting something used to raise the card by itself, so you could
              not tap a thing to nudge it without a panel landing in front of the
              model. The rail already does move/rotate/stretch/X-ray/delete; this
              is only for what the rail cannot say — a door's swing, a board type.
              Tap again to put it away. */}
          <div className={styles.editRailGroup}>
            <button
              className={`${styles.editRailBtn} ${activePanel ? styles.editRailBtnOn : ''}`}
              aria-pressed={!!activePanel}
              aria-label={`Specs for this ${selectionEdit.label.toLowerCase()}`}
              title={activePanel ? 'Hide specs' : `Specs for this ${selectionEdit.label.toLowerCase()}`}
              onClick={() => openSelectionPanel()}
            >⋯</button>
          </div>

          {/* X-RAY — the answer to "how do I make this see-through?".
              Captioned, not just an icon, because the whole problem was that
              nobody could find it: it lived inside the wall panel AND the object
              panel, worded differently in each, and floors and roofs had no way
              to do it at all. One mark, one word, same place for everything you
              can select. Accent when it is on, so the rail tells you the state
              of the thing you are looking at. */}
          {selectionEdit.xray && (
            <div className={styles.editRailGroup}>
              <span className={styles.editRailCaption}>X-ray</span>
              <button
                className={`${styles.editRailBtn} ${selectionEdit.xray.on ? styles.editRailBtnOn : ''}`}
                aria-pressed={selectionEdit.xray.on}
                aria-label={`X-ray this ${selectionEdit.label.toLowerCase()}`}
                title={selectionEdit.xray.on
                  ? 'X-ray on — tap to make solid again'
                  : `See through this ${selectionEdit.label.toLowerCase()}`}
                onClick={() => selectionEdit.xray!.toggle()}
              >◐</button>
            </div>
          )}

          {/* EXPLODE PARTS — the second explode, which edit mode had locked out.
              There have always been two: the slider, which lifts the whole model
              apart by layer, and this one, which blows a SINGLE thing into its
              pieces — the studs out of a wall, the parts out of a fixture. But
              its only buttons lived inside the wall panel and the object panel,
              and selecting something in edit mode deliberately suppresses those
              panels (`activePanel: s.editMode ? null : 'wall'`). So the mode was
              still there and had no door: you could not reach it the new way of
              working at all.
              Same remedy as X-ray directly above — one mark, one word, same
              place, for everything that can express it. */}
          {(editSelected?.kind === 'wall' || editSelected?.kind === 'object') && (() => {
            const isWall = editSelected.kind === 'wall'
            const on = isWall ? wallDetailExplode : detailExplodeId === editSelected.id
            return (
              <div className={styles.editRailGroup}>
                <span className={styles.editRailCaption}>Explode</span>
                <button
                  className={`${styles.editRailBtn} ${on ? styles.editRailBtnOn : ''}`}
                  aria-pressed={on}
                  aria-label={`Explode this ${selectionEdit.label.toLowerCase()} into its parts`}
                  title={on
                    ? 'Collapse back together'
                    : `Explode this ${selectionEdit.label.toLowerCase()} into its parts`}
                  onClick={() => {
                    if (isWall) setWallDetailExplode(!wallDetailExplode)
                    else setDetailExplodeId(on ? null : editSelected.id)
                  }}
                >✳</button>
              </div>
            )
          })()}

          {/* DELETE. The one verb every selection has, and it was the one the
              rail could not do — each type's delete lived in its own panel, so
              selecting something in edit mode meant leaving edit mode to remove
              it. Last in the rail, away from the movement controls, because it
              is the destructive one. */}
          <div className={styles.editRailGroup}>
            <button
              className={`${styles.editRailBtn} ${styles.editRailDanger}`}
              aria-label={`Delete ${selectionEdit.label.toLowerCase()}`}
              title={`Delete this ${selectionEdit.label.toLowerCase()}`}
              onClick={() => selectionEdit.remove()}
            >🗑</button>
          </div>

          {/* STAIR CONFIGURATOR — in the rail, not in a panel.
              It started life inside the object property card, which covers the
              model the moment it opens: you cannot watch a stair relay while the
              thing telling you about it is sitting on top of it. The rail is the
              established idiom for "what you can do to the selection" — marks on
              the chrome edge, no container, nothing over the workspace — so the
              configurator belongs here with the rest of them. */}
          {stairEdit && (
            <>
              <div className={styles.editRailGroup}>
                <span className={styles.editRailCaption}>Tread</span>
                <div className={styles.editRailPair}>
                  {[10, 11, 12].map((inches) => (
                    <button key={inches}
                      className={`${styles.editRailBtn} ${stairEdit.treadIn === inches ? styles.editRailBtnOn : ''}`}
                      onClick={() => stairEdit.set({ treadM: inches * 0.0254 })}
                    >{inches}</button>
                  ))}
                </div>
              </div>
              <div className={styles.editRailGroup}>
                <span className={styles.editRailCaption}>Width</span>
                <div className={styles.editRailPair}>
                  {[36, 42, 48].map((inches) => (
                    <button key={inches}
                      className={`${styles.editRailBtn} ${stairEdit.widthIn === inches ? styles.editRailBtnOn : ''}`}
                      onClick={() => stairEdit.set({ stairWidthM: inches * 0.0254 })}
                    >{inches}</button>
                  ))}
                </div>
              </div>
              <div className={styles.editRailGroup}>
                <span className={styles.editRailCaption}>Landing</span>
                <div className={styles.editRailPair}>
                  {/* A turn IS a landing, so "none" only appears on a straight run. */}
                  {stairEdit.straight && (
                    <button
                      className={`${styles.editRailBtn} ${stairEdit.landingIn === 0 ? styles.editRailBtnOn : ''}`}
                      onClick={() => stairEdit.set({ landingM: null })}
                    >∅</button>
                  )}
                  {[36, 48].map((inches) => (
                    <button key={inches}
                      className={`${styles.editRailBtn} ${stairEdit.landingIn === inches ? styles.editRailBtnOn : ''}`}
                      onClick={() => stairEdit.set({ landingM: inches * 0.0254 })}
                    >{inches}</button>
                  ))}
                </div>
              </div>
              {/* The solve, as a mark rather than a read-out panel. */}
              <span className={styles.editRailNote}>
                {stairEdit.riserCount}R @ {stairEdit.riserIn}"
              </span>
              {stairEdit.problems.length > 0 && (
                <span className={styles.editRailWarn} title={stairEdit.problems.join('\n')}>
                  ⚠ {stairEdit.problems.length}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Floor bar — the SEE-PAST LADDER for whole floors (docs/INTERACTIONS.md).
          Fade and isolate are the same choice at different strengths and the same
          scope (a floor), so they are one control, not two. Tapping a floor cycles
          it:  normal → faded (15%, see past it) → isolated (others hidden) → normal.
          Fading used to be a double-tap on a wall or floor deck, which put a
          floor-scoped action on a component and left it undiscoverable; it lives
          here now, beside isolate, adding no new buttons. */}
      {/* Stays hidden mid-trace on purpose — you're placing points, not
          inspecting floors, and the workspace stays clear while you tap. */}
      {/* Hidden while the EDIT RAIL is using this slot — the two share the right
          edge and take turns rather than competing for it. */}
      {hasDrawings && !calibrationMode && !traceMode && availableFloors.length > 1
        && !(editMode && selectionEdit) && (
        <div className={styles.floorBar}>
          <span className={styles.editRailCaption}>Floor</span>
          <button
            className={`${styles.floorBtn} ${isolatedFloor === null && ghostedLevels.length === 0 ? styles.floorBtnActive : ''}`}
            onClick={() => { setIsolatedFloor(null); ghostedLevels.forEach((l) => toggleGhostedLevel(l)) }}
            aria-label="Show all floors normally"
          >All</button>
          {availableFloors.map((i) => {
            const faded = ghostedLevels.includes(i)
            const isolated = isolatedFloor === i
            const cycle = () => {
              if (isolated) {                       // isolated → normal
                setIsolatedFloor(null)
              } else if (faded) {                   // faded → isolated
                toggleGhostedLevel(i)
                setIsolatedFloor(i)
              } else {                              // normal → faded
                if (isolatedFloor !== null) setIsolatedFloor(null)
                toggleGhostedLevel(i)
              }
            }
            return (
              <button
                key={i}
                className={`${styles.floorBtn} ${isolated ? styles.floorBtnActive : faded ? styles.floorBtnFaded : ''}`}
                onClick={cycle}
                aria-label={`Floor ${i + 1} — ${isolated ? 'isolated, tap to show all' : faded ? 'faded, tap to isolate' : 'normal, tap to fade'}`}
                title={isolated ? 'Isolated · tap to show all' : faded ? 'Faded · tap to isolate' : 'Tap to fade this floor'}
              >{i + 1}</button>
            )
          })}
        </div>
      )}

      {/* Ambient inference nudge — gentle "snap flush?" prompt, bottom-centre. */}
      <InferencePrompt />

      {/* THE NEXT-STEP COACH, back — because with it gone there was no guidance
          at all. It was pulled for two fair reasons: it floated over other
          menus, and its suggestion order was wrong. Both are fixed rather than
          waved away — assistant.ts now requires real walls before it declares
          the model finished (floor → walls → build → done, in step), and the
          bubble goes silent whenever a drawer is open, on the same principle as
          its existing busy gate: if the user is doing something, say nothing.
          One line at a time, dismissible, with a button that does the step. */}
      <AssistantBubble />

      {/* The guided "build a whole house" walkthrough (its own persistent card). */}
      <TutorialCoach />

      {/* Shown only when a locked feature was reached for — it names what, and
          renders nothing at all until then. */}
      <UpgradeSheet />
    </div>
  )
}
