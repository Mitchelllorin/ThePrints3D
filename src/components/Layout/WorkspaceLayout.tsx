import { useEffect, useRef, useState, type ReactNode } from 'react'
import { listPresetDefinitions, type PresetDifficulty } from '../../services/presetDrawings'
import type { BuildingType } from '../../onboarding/types'
import { convertValue, type ConverterKind, type ConverterUnit, type LengthFormat } from '../../services/unitConverter'
import ModelViewer from '../Viewer3D/ModelViewer'
import TopbarLogo3D from './TopbarLogo3D'
import TopIcons from './TopIcons'
import LayerPanel from '../Layers/LayerPanel'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import WallTypeLegend from '../WallTypeLegend'
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
      <CollapsibleSection id="appearance" title="Appearance" openId={openId} setOpenId={setOpenId}>
        <Slider label="Opacity" val={Math.round(ui.panelOpacity * 100)} min={0} max={100} step={1} unit="%"
          onChange={(v) => setUI({ topbarOpacity: v / 100, sidebarOpacity: v / 100, panelOpacity: v / 100 })} />
        <ColorRow label="Colour" val={ui.panelColor} onChange={(v) => setUI({ panelColor: v })} />
        <ColorRow label="Accent" val={ui.accentColor} onChange={(v) => setUI({ accentColor: v })} />
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
        <Slider label="Cell size" val={ui.gridCellSize} min={0.5} max={10} step={0.5} unit="m" onChange={(v) => setUI({ gridCellSize: v })} />
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

// The slide-in panels reachable from the top-right icons.
type PanelId = 'layers' | 'settings'

// ── Layout ───────────────────────────────────────────────────────────────────
export default function WorkspaceLayout() {
  const [open, setOpen] = useState<PanelId | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const drawings            = useAppStore((s) => s.drawings)
  const addDrawings         = useAppStore((s) => s.addDrawings)
  const loadPresetDrawing   = useAppStore((s) => s.loadPresetDrawing)
  const projectWallTypes   = useAppStore((s) => s.projectWallTypes)
  const detectedWallTypes  = useAppStore((s) => s.detectedWallTypes)
  const setProjectWallTypes = useAppStore((s) => s.setProjectWallTypes)
  const undo    = useAppStore((s) => s.undo)
  const canUndo = useAppStore((s) => s.historyPast.length > 0)
  const buildForMe = useAppStore((s) => s.buildForMe)
  const annotateMode = useAppStore((s) => s.annotateMode)
  const setAnnotateMode = useAppStore((s) => s.setAnnotateMode)
  const explodeAmount = useAppStore((s) => s.explodeAmount)
  const setExplodeAmount = useAppStore((s) => s.setExplodeAmount)
  // Always available once a plan is loaded — never vanishes after a build state change.
  const showExplode = useAppStore((s) => s.drawings.length > 0)
  const measureMode = useAppStore((s) => s.measureMode)
  const setMeasureMode = useAppStore((s) => s.setMeasureMode)
  const updateOverlay = useAppStore((s) => s.updateFloorplanOverlay)
  const calibrationMode = useAppStore((s) => s.floorplanOverlay.calibrationMode)

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
    setOpen(null)
  }
  const traceActive = useFloorplanLocalStore((s) => s.traceMode || s.activePanel === 'picker')
  const logoOpacity = useUISettingsStore((s) => s.logoOpacity)
  const logoSize    = useUISettingsStore((s) => s.logoSize)

  const sharePng = () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    try {
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `blueprint3d-${Date.now()}.png`
      a.click()
    } catch (e) {
      console.error('Snapshot failed', e)
      alert('Snapshot failed — orbit the view once, then retry.')
    }
  }

  const handleLoadPreset = (presetId: PresetDifficulty) => {
    try {
      loadPresetDrawing(presetId, true)
      // UX convention: a one-shot pick (preset, file, etc.) retracts the panel —
      // the user chose what they wanted, so the panel gets out of the way.
      setOpen(null)
    } catch (error) {
      console.error('Failed to load preset:', presetId, error)
    }
  }
  const hasDrawings = drawings.length > 0
  // Onboarding card persists until a plan is actually loaded — no dismiss.
  const showUploadHint = !hasDrawings

  // One menu at a time across BOTH systems: opening the left drawer dismisses
  // any floorplan floater (property card / picker / panel board), and opening a
  // floorplan floater (activePanel) collapses the drawer. Nothing ever stacks.
  useEffect(() => useFloorplanLocalStore.subscribe((s, prev) => {
    if (s.activePanel && !prev.activePanel) setOpen(null)
  }), [])

  const toggle = (id: PanelId) => setOpen((prev) => {
    const next = prev === id ? null : id
    if (next) useFloorplanLocalStore.getState().closeAllPanels()
    return next
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) { addDrawings(files) }
    e.target.value = ''
  }

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

      {/* 3D Viewport — fills everything below the top bar */}
      <div className={styles.viewport}>
        <ModelViewer />
      </div>

      {/* Brand mark — small, floating, top-left; never blocks the canvas. */}
      <div className={styles.logoFloat} style={{ opacity: logoOpacity, transform: `scale(${logoSize})` }}>
        <TopbarLogo3D />
      </div>

      {/* The only persistent chrome: five icon buttons, top-right. */}
      <TopIcons
        onRebuild={buildForMe}
        onTrace={() => {
          const fp = useFloorplanLocalStore.getState()
          // Toggle: if already tracing/picking, exit cleanly; else open the picker.
          if (traceActive) { fp.setTraceMode(false); fp.closeAllPanels() }
          else { setOpen(null); fp.openPicker() }
        }}
        onLayers={() => toggle('layers')}
        onSettings={() => toggle('settings')}
        onUndo={undo}
        traceActive={traceActive}
        layersActive={open === 'layers'}
        settingsActive={open === 'settings'}
        canUndo={canUndo}
      />

      {/* Explode — always present once a plan is loaded. Lives bottom-left,
          clear of the side panels, so it never gets covered/hidden. */}
      {showExplode && (
        <div className={styles.explodeBar}>
          <span className={styles.explodeLabel}>Explode</span>
          <input
            type="range" min={0} max={1} step={0.01} value={explodeAmount}
            onChange={(e) => setExplodeAmount(Number(e.target.value))}
            className={styles.explodeSlider}
            aria-label="Explode separation"
          />
        </div>
      )}

      {/* Slide-in panel — Layers from the left, Settings from the right.
          Fully off-screen when closed (no peeking strip). */}
      <div className={`${styles.panelWrapper} ${open === 'settings' ? styles.panelRight : ''} ${open ? styles.panelWrapperOpen : ''}`}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>{open === 'settings' ? 'Settings' : 'Layers'}</span>
            <button className={styles.panelClose} onClick={() => setOpen(null)} aria-label="Close">✕</button>
          </div>
          <div className={styles.panelScroll}>
            {open === 'layers' && (
              <>
                <p className={styles.sectionTitle}>Systems</p>
                <LayerPanel />
                <p className={styles.sectionTitle}>Wall Types</p>
                <WallTypeLegend
                  types={projectWallTypes}
                  onUpdateTypes={setProjectWallTypes}
                  detectedIds={detectedWallTypes.map((d) => d.wallType.id)}
                />
              </>
            )}
            {open === 'settings' && (
              <>
                <p className={styles.sectionTitle}>Floor plan</p>
                <div className={styles.panelBtnRow}>
                  <button className={styles.panelBtn} onClick={() => fileInputRef.current?.click()}>Browse files</button>
                  <button className={styles.panelBtn} onClick={() => fileInputRef.current?.click()}>Scan</button>
                </div>
                <p className={styles.sectionTitle}>Presets</p>
                <PresetPanel onLoad={handleLoadPreset} />
                <SettingsContent />
                <p className={styles.sectionTitle}>Tools</p>
                <div className={styles.panelBtnRow}>
                  <button className={styles.panelBtn} onClick={() => setMeasureMode(!measureMode)}>
                    {measureMode ? 'Stop measuring' : 'Measure'}
                  </button>
                  <button className={styles.panelBtn} onClick={recalibrate}>
                    {calibrationMode ? 'Calibrating…' : 'Recalibrate'}
                  </button>
                </div>
                <p className={styles.sectionTitle}>Annotate &amp; Export</p>
                <div className={styles.panelBtnRow}>
                  <button className={styles.panelBtn} onClick={() => setAnnotateMode(!annotateMode)}>
                    {annotateMode ? 'Stop annotating' : 'Annotate'}
                  </button>
                  <button className={styles.panelBtn} onClick={sharePng}>Share PNG</button>
                </div>
                <AnnotationPanel />
                <p className={styles.sectionTitle}>Unit converter</p>
                <ConverterPanel />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Onboarding card — dismissable, top-right, only when no drawings loaded
          and no drawer open (never stack on top of another menu). */}
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
