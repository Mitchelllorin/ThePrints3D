import { useEffect, useRef, useState, type ReactNode } from 'react'
import { listPresetDefinitions, type PresetDifficulty } from '../../services/presetDrawings'
import type { BuildingType } from '../../onboarding/types'
import { convertValue, type ConverterKind, type ConverterUnit, type LengthFormat } from '../../services/unitConverter'
import ModelViewer from '../Viewer3D/ModelViewer'
import TopIcons from './TopIcons'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useConfigStore, type ActiveUnit } from '../../store/useConfigStore'
import styles from './WorkspaceLayout.module.css'

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

      <CollapsibleSection id="steel" title="Steel" openId={openId} setOpenId={setOpenId}>
        <Select label="Width" val={cfg.steelWidth} options={STEEL_WIDTH_OPTIONS} onChange={(v) => setCfg({ steelWidth: v as typeof cfg.steelWidth })} />
        <Select label="Gauge" val={cfg.steelGauge} options={STEEL_GAUGE_OPTIONS} onChange={(v) => setCfg({ steelGauge: v as typeof cfg.steelGauge })} />
        <Select label="Top track" val={cfg.steelTrackTop} options={STEEL_TRACK_OPTIONS} onChange={(v) => setCfg({ steelTrackTop: v as typeof cfg.steelTrackTop })} />
        <Select label="Bottom track" val={cfg.steelTrackBottom} options={STEEL_TRACK_OPTIONS} onChange={(v) => setCfg({ steelTrackBottom: v as typeof cfg.steelTrackBottom })} />
        <Slider label="Deflection gap" val={cfg.steelDeflectionGapMm} min={0} max={40} step={1} unit="mm" onChange={(v) => setCfg({ steelDeflectionGapMm: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="build" title="Build output" openId={openId} setOpenId={setOpenId}>
        <Slider label="Floor height" val={cfg.buildFloorHeightM} min={2} max={6} step={0.1} unit="m" onChange={(v) => setCfg({ buildFloorHeightM: v })} />
        <Select label="Type" val={cfg.buildType} options={BUILD_TYPE_OPTIONS} onChange={(v) => setCfg({ buildType: v as BuildingType })} />
        <Toggle label="Auto framing" val={cfg.buildAutoEnableFraming} onChange={(v) => setCfg({ buildAutoEnableFraming: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="trades" title="Plumbing / Electrical" openId={openId} setOpenId={setOpenId}>
        <Select label="Pipe length" val={String(cfg.pipeStickLengthFt)} options={[{ value: '10', label: "10 ft" }, { value: '12', label: "12 ft" }]} onChange={(v) => setCfg({ pipeStickLengthFt: Number(v) as 10 | 12 })} />
      </CollapsibleSection>

      <CollapsibleSection id="explode" title="Explode" openId={openId} setOpenId={setOpenId}>
        <Slider label="Speed" val={cfg.explodeSpeed} min={0.5} max={12} step={0.5} onChange={(v) => setCfg({ explodeSpeed: v })} />
        <Slider label="Spread" val={cfg.explodeSpread} min={0} max={3} step={0.1} unit="×" onChange={(v) => setCfg({ explodeSpread: v })} />
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

      <CollapsibleSection id="wordmark" title="3D wordmark" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Visible" val={ui.logo3DVisible} onChange={(v) => setUI({ logo3DVisible: v })} />
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

      <CollapsibleSection id="drywall" title="Drywall" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Board walls" val={ui.drywallVisible} onChange={(v) => setUI({ drywallVisible: v })} />
        <Select label="Sheet orientation" val={ui.drywallOrientation}
          options={[{ value: 'vertical', label: 'Vertical (4×8 standing)' }, { value: 'horizontal', label: 'Horizontal (laid down)' }]}
          onChange={(v) => setUI({ drywallOrientation: v as 'vertical' | 'horizontal' })} />
      </CollapsibleSection>

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

// ── Trace panel — framing type + wall role pills, then Start Tracing ──────────
const TRACE_FRAMING: Array<{ key: string; label: string }> = [
  { key: 'wood-2x4', label: '2×4' },
  { key: 'wood-2x6', label: '2×6' },
  { key: 'wood-2x8', label: '2×8' },
  { key: 'steel-3-5-8', label: 'Steel 3-5/8"' },
  { key: 'steel-6', label: 'Steel 6"' },
  { key: 'cmu', label: 'CMU' },
]

const TRACE_ROLES: Array<{ key: string; label: string }> = [
  { key: 'exterior-bearing', label: 'Ext' },
  { key: 'interior-bearing', label: 'Int Bearing' },
  { key: 'interior-non-bearing', label: 'Int' },
  { key: 'partition', label: 'Partition' },
]

function TracePanel({ onStart }: { onStart: () => void }) {
  const activeWallType = useFloorplanLocalStore((s) => s.activeWallType)
  const activeWallRole = useFloorplanLocalStore((s) => s.activeWallRole)
  const setActiveWallRole = useFloorplanLocalStore((s) => s.setActiveWallRole)
  const setActiveWallType = useFloorplanLocalStore((s) => s.setActiveWallType)
  const setActiveTraceLayer = useFloorplanLocalStore((s) => s.setActiveTraceLayer)
  const setCfg = useConfigStore((s) => s.set)

  // Same material/stud mapping as FloorplanPanel.pickFraming so the build
  // produces the right framing (steel vs wood, 2x4 vs 2x6); CMU stays masonry.
  const pickFraming = (key: string) => {
    setActiveTraceLayer('framing')
    setActiveWallType(key)
    if (key.startsWith('steel')) setCfg({ framingMaterial: 'steel' })
    else if (key.startsWith('wood')) setCfg({ framingMaterial: 'wood' })
    if (key === 'wood-2x6' || key === 'steel-6') setCfg({ defaultStudSize: '2x6' })
    else if (key === 'wood-2x4' || key === 'steel-3-5-8') setCfg({ defaultStudSize: '2x4' })
  }

  return (
    <>
      <p className={styles.pillLabel}>Framing type:</p>
      <div className={styles.pillRow}>
        {TRACE_FRAMING.map((t) => (
          <button key={t.key} className={`${styles.pill} ${activeWallType === t.key ? styles.pillActive : ''}`}
            onClick={() => pickFraming(t.key)}>{t.label}</button>
        ))}
      </div>
      <p className={styles.pillLabel}>Wall role:</p>
      <div className={styles.pillRow}>
        {TRACE_ROLES.map((r) => (
          <button key={r.key} className={`${styles.pill} ${activeWallRole === r.key ? styles.pillActive : ''}`}
            onClick={() => setActiveWallRole(r.key)}>{r.label}</button>
        ))}
      </div>
      <button className={styles.startTraceBtn} onClick={onStart}>Start Tracing</button>
    </>
  )
}

// ── Layers panel — the 4 trade layers, colour dot + on/off, active highlighted ─
const LAYER_ROWS: Array<{ key: 'framing' | 'plumbing' | 'electrical' | 'hvac'; label: string; color: string }> = [
  { key: 'framing', label: 'Framing', color: '#ffffff' },
  { key: 'plumbing', label: 'Plumbing', color: '#60a5fa' },
  { key: 'electrical', label: 'Electrical', color: '#facc15' },
  { key: 'hvac', label: 'HVAC', color: '#4ade80' },
]

function LayersPanel() {
  const visibleLayers = useAppStore((s) => s.visibleLayers)
  const toggleTradeLayerVisible = useAppStore((s) => s.toggleTradeLayerVisible)
  const activeTraceLayer = useFloorplanLocalStore((s) => s.activeTraceLayer)
  const setActiveTraceLayer = useFloorplanLocalStore((s) => s.setActiveTraceLayer)

  return (
    <div className={styles.layerList}>
      {LAYER_ROWS.map((l) => {
        const on = visibleLayers.has(l.key)
        const active = activeTraceLayer === l.key
        return (
          <div key={l.key} className={`${styles.layerRow} ${active ? styles.layerRowActive : ''}`}>
            <span className={styles.layerDot} style={{ background: l.color }} />
            <button className={styles.layerName} onClick={() => setActiveTraceLayer(l.key)}>{l.label}</button>
            <button className={`${styles.layerToggle} ${on ? styles.layerToggleOn : ''}`}
              onClick={() => toggleTradeLayerVisible(l.key)} aria-pressed={on}>
              {on ? 'On' : 'Off'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// The slide-in panels reachable from the top-right icons.
type PanelId = 'trace' | 'layers' | 'settings'

// Panel titles for the slide-in chrome panels.
const PANEL_TITLES: Record<PanelId, string> = {
  trace: 'Trace',
  layers: 'Layers',
  settings: 'Settings',
}

// ── Layout ───────────────────────────────────────────────────────────────────
export default function WorkspaceLayout() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const drawings            = useAppStore((s) => s.drawings)
  const addDrawings         = useAppStore((s) => s.addDrawings)
  const loadPresetDrawing   = useAppStore((s) => s.loadPresetDrawing)
  const undo    = useAppStore((s) => s.undo)
  const canUndo = useAppStore((s) => s.historyPast.length > 0)
  const buildForMe = useAppStore((s) => s.buildForMe)
  const annotateMode = useAppStore((s) => s.annotateMode)
  const setAnnotateMode = useAppStore((s) => s.setAnnotateMode)
  const explodeAmount = useAppStore((s) => s.explodeAmount)
  const setExplodeAmount = useAppStore((s) => s.setExplodeAmount)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const calibrationMode = useAppStore((s) => s.floorplanOverlay.calibrationMode)

  // Single source of truth: the chrome panels are driven by the store's
  // activePanel gate, the same gate every other overlay UI checks.
  const activePanel = useFloorplanLocalStore((s) => s.activePanel)
  const setActivePanel = useFloorplanLocalStore((s) => s.setActivePanel)
  const closePanels = useFloorplanLocalStore((s) => s.closeAllPanels)
  const open: PanelId | null =
    activePanel === 'trace' || activePanel === 'layers' || activePanel === 'settings'
      ? activePanel
      : null

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
  const traceActive = useFloorplanLocalStore((s) => s.traceMode || s.activePanel === 'trace' || s.activePanel === 'picker')

  const sharePng = () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    try {
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `theprints3d-${Date.now()}.png`
      a.click()
    } catch (e) {
      console.error('Snapshot failed', e)
      alert('Snapshot failed — orbit the view once, then retry.')
    }
  }

  // "Start Tracing" — replicate FloorplanPanel.confirmWallType/startTracing so
  // framing still calibrates first when the scale isn't trusted, then traces.
  const startTracing = () => {
    const fp = useFloorplanLocalStore.getState()
    fp.closeAllPanels()
    fp.setActiveTraceLayer('framing')
    const app = useAppStore.getState()
    const overlay = app.floorplanOverlay
    const drawing = app.drawings.find((d) => d.id === overlay.drawingId) ?? app.drawings[0] ?? null
    // Trade flows skip calibration; framing needs a trusted scale first.
    if (drawing && drawing.scaleMmPerPx !== null && drawing.scaleConfidence === 'parsed') {
      fp.setCalibrationA(null); fp.setCalibrationB(null); fp.setHoverPixel(null)
      fp.setDistanceInput(''); fp.setPendingTraceAfterCalibration(false)
      app.updateFloorplanOverlay({ calibrationMode: false }, false)
      fp.setTraceMode(true)
    } else {
      // Enter calibration; finishing it drops straight into trace mode.
      fp.setTraceMode(false); fp.setTraceStroke([])
      fp.setCalibrationA(null); fp.setCalibrationB(null); fp.setHoverPixel(null)
      fp.setDistanceInput(''); fp.setPendingTraceAfterCalibration(true)
      app.updateFloorplanOverlay({ calibrationMode: true, guidedStep: 1, locked: false }, false)
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
      loadPresetDrawing(presetId, true)
      // UX convention: a one-shot pick (preset, file, etc.) retracts the panel.
      closePanels()
    } catch (error) {
      console.error('Failed to load preset:', presetId, error)
    }
  }
  const hasDrawings = drawings.length > 0
  // Onboarding card persists until a plan is actually loaded — no dismiss.
  const showUploadHint = !hasDrawings

  // Five-button toggle: tapping the active panel's button closes it; tapping a
  // different one swaps. Trace toggles tracing off if a run is in progress.
  const toggleTrace = () => {
    const fp = useFloorplanLocalStore.getState()
    if (fp.traceMode) { fp.setTraceMode(false); fp.closeAllPanels(); return }
    setActivePanel('trace')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) { addDrawings(files) }
    e.target.value = ''
  }

  // Escape closes any open chrome panel (FloorplanPanel handles Escape for its
  // own pickers/cards; this covers trace/layers/settings).
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const ap = useFloorplanLocalStore.getState().activePanel
      if (ap === 'trace' || ap === 'layers' || ap === 'settings') closePanels()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [closePanels])

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
        else useAppStore.getState().undo()
      } else if (key === 'y') {
        e.preventDefault()
        useAppStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={styles.root}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {/* 3D Viewport — fills the whole screen at all times. */}
      <div className={styles.viewport}>
        <ModelViewer />
      </div>

      {/* Brand mark — the floating wordmark, top-left. 3D-extruded look (via the
          text-shadow stack in .logo) + a gentle float; reliable + always visible. */}
      <div className={styles.logoFloat}>
        <span className={styles.logo}>
          <span className={styles.logoThe}>The</span>
          <span className={styles.logoPrints}>PRINTS</span>
          <span className={styles.logo3D}>3D</span>
        </span>
      </div>

      {/* The only persistent chrome: five icon buttons, fixed top-right. */}
      <TopIcons
        onRebuild={buildForMe}
        onTrace={toggleTrace}
        onLayers={() => setActivePanel('layers')}
        onSettings={() => setActivePanel('settings')}
        onUndo={undo}
        traceActive={traceActive}
        layersActive={open === 'layers'}
        settingsActive={open === 'settings'}
        canUndo={canUndo}
      />

      {/* Spec panels — one at a time, slide in from the edge. Trace & Layers from
          the left; Settings from the right. Each has an X; Escape / canvas tap
          closes them. Vertically centered. */}
      {open && (
        // All panels slide in from the LEFT so none of them sit under the
        // right-side icon column (Settings used to open right, over the icons).
        <div className={`${styles.specPanel} ${styles.specPanelLeft}`}>
          <button className={styles.specClose} onClick={closePanels} aria-label="Close">✕</button>
          <div className={styles.specScroll}>
            <p className={styles.specTitle}>{PANEL_TITLES[open]}</p>

            {open === 'trace' && <TracePanel onStart={startTracing} />}

            {open === 'layers' && <LayersPanel />}

            {open === 'settings' && (
              <>
                <SettingsContent />
                <div className={styles.specDivider} />
                <p className={styles.sectionTitle}>Tools</p>
                <button className={styles.specBtn} onClick={() => fileInputRef.current?.click()}>Load Preset</button>
                <PresetPanel onLoad={handleLoadPreset} />
                <button className={styles.specBtn} onClick={recalibrate}>
                  {calibrationMode ? 'Calibrating…' : 'Recalibrate'}
                </button>
                <button className={styles.specBtn} onClick={reRunWizard}>Re-run Wizard</button>
                <p className={styles.sectionTitle}>Explode View</p>
                <input
                  type="range" min={0} max={1} step={0.01} value={explodeAmount}
                  onChange={(e) => setExplodeAmount(Number(e.target.value))}
                  className={styles.specSlider}
                  aria-label="Explode separation"
                />
                <p className={styles.sectionTitle}>Annotate &amp; Export</p>
                <button className={styles.specBtn} onClick={() => setAnnotateMode(!annotateMode)}>
                  {annotateMode ? 'Stop annotating' : 'Annotate'}
                </button>
                <button className={styles.specBtn} onClick={sharePng}>Share PNG</button>
                <button className={styles.specBtn} onClick={() => fileInputRef.current?.click()}>Export</button>
                <AnnotationPanel />
                <p className={styles.sectionTitle}>Unit converter</p>
                <ConverterPanel />
              </>
            )}
          </div>
        </div>
      )}

      {/* Persistent Explode control — always reachable, with its OWN solid
          surface (not the themed panel) so it can never disappear when UI
          opacity is turned down. Shown whenever a plan is loaded. */}
      {drawings.length > 0 && !calibrationMode && (
        <div className={styles.explodeBar}>
          <span>Explode</span>
          <input
            className={styles.explodeSlider}
            type="range" min={0} max={1} step={0.01} value={explodeAmount}
            onChange={(e) => setExplodeAmount(Number(e.target.value))}
            aria-label="Explode separation"
          />
          {explodeAmount > 0 && (
            <button
              className={styles.explodeReset}
              onClick={() => setExplodeAmount(0)}
              aria-label="Reset explode"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Onboarding card — only when no drawings loaded and no panel open. */}
      {showUploadHint && !open && (
        <div className={styles.uploadHint}>
          <div className={styles.uploadHintHeader}>
            <span className={styles.uploadHintTitle}>Get started</span>
          </div>
          <p className={styles.uploadHintSub}>Drag a floor plan onto the grid, import one, or start from a preset.</p>
          <div className={styles.uploadHintActions}>
            <button className={styles.uploadHintBtn} onClick={() => fileInputRef.current?.click()}>
              Browse files
            </button>
            <button className={styles.uploadHintBtnSecondary} onClick={() => fileInputRef.current?.click()}>
              Scan with camera
            </button>
          </div>
          <p className={styles.uploadHintSub} style={{ marginTop: 4 }}>Or start from a preset:</p>
          <PresetPanel onLoad={handleLoadPreset} />
        </div>
      )}
    </div>
  )
}
