import { useRef, useState, type ReactNode } from 'react'
import { listPresetDefinitions, type PresetDifficulty } from '../../services/presetDrawings'
import type { BuildingType } from '../../onboarding/types'
import ModelViewer from '../Viewer3D/ModelViewer'
import LogoBadge3D from './LogoBadge3D'
import LayerPanel from '../Layers/LayerPanel'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import WallTypeLegend from '../WallTypeLegend'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useConfigStore } from '../../store/useConfigStore'
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
  const [openId, setOpenId] = useState<string | null>('wall-trace')

  const resetAll = () => { resetUI(); resetCfg() }

  return (
    <div className={styles.settingsBody}>
      <CollapsibleSection id="wall-trace" title="Wall trace" openId={openId} setOpenId={setOpenId}>
        <Slider label="Thickness" val={cfg.wallTraceThicknessPx} min={2} max={40} step={1} unit="px" onChange={(v) => setCfg({ wallTraceThicknessPx: v })} />
        <Slider label="Min length" val={cfg.wallTraceMinLengthPx} min={4} max={60} step={1} unit="px" onChange={(v) => setCfg({ wallTraceMinLengthPx: v })} />
        <Slider label="Snap end" val={cfg.wallTraceSnapEndpointPx} min={0} max={80} step={1} unit="px" onChange={(v) => setCfg({ wallTraceSnapEndpointPx: v })} />
        <Slider label="Snap line" val={cfg.wallTraceSnapLinePx} min={0} max={80} step={1} unit="px" onChange={(v) => setCfg({ wallTraceSnapLinePx: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="corners" title="Corners" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Infer corners" val={cfg.cornerInferEnabled} onChange={(v) => setCfg({ cornerInferEnabled: v })} />
        <Slider label="Tolerance" val={cfg.cornerTolerancePx} min={0} max={60} step={1} unit="px" onChange={(v) => setCfg({ cornerTolerancePx: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="snapping" title="Snapping" openId={openId} setOpenId={setOpenId}>
        <Slider label="Grid step" val={cfg.gridSnapM} min={0} max={2} step={0.05} unit="m" onChange={(v) => setCfg({ gridSnapM: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="units" title="Units" openId={openId} setOpenId={setOpenId}>
        <Select label="System" val={cfg.unitSystem} options={[{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }]} onChange={(v) => setCfg({ unitSystem: v as 'metric' | 'imperial' })} />
      </CollapsibleSection>

      <CollapsibleSection id="build" title="Build output" openId={openId} setOpenId={setOpenId}>
        <Slider label="Floor height" val={cfg.buildFloorHeightM} min={2} max={6} step={0.1} unit="m" onChange={(v) => setCfg({ buildFloorHeightM: v })} />
        <Select label="Type" val={cfg.buildType} options={BUILD_TYPE_OPTIONS} onChange={(v) => setCfg({ buildType: v as BuildingType })} />
        <Toggle label="Auto framing" val={cfg.buildAutoEnableFraming} onChange={(v) => setCfg({ buildAutoEnableFraming: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="preview" title="Preview" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Sample room" val={previewMode} onChange={setPreviewMode} />
      </CollapsibleSection>

      <CollapsibleSection id="panels" title="Panels" openId={openId} setOpenId={setOpenId}>
        <Slider label="Top bar" val={Math.round(ui.topbarOpacity * 100)} min={20} max={100} step={1} unit="%" onChange={(v) => setUI({ topbarOpacity: v / 100 })} />
        <Slider label="Side panel" val={Math.round(ui.sidebarOpacity * 100)} min={20} max={100} step={1} unit="%" onChange={(v) => setUI({ sidebarOpacity: v / 100 })} />
        <Slider label="Floaters" val={Math.round(ui.panelOpacity * 100)} min={20} max={100} step={1} unit="%" onChange={(v) => setUI({ panelOpacity: v / 100 })} />
      </CollapsibleSection>

      <CollapsibleSection id="wordmark" title="3D wordmark" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Visible" val={ui.logo3DVisible} onChange={(v) => setUI({ logo3DVisible: v })} />
        <Slider label="Opacity" val={Math.round(ui.logo3DOpacity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setUI({ logo3DOpacity: v / 100 })} />
        <Slider label="Speed" val={ui.logo3DFloatSpeed} min={0} max={5} step={0.1} onChange={(v) => setUI({ logo3DFloatSpeed: v })} />
        <Slider label="Bounce" val={ui.logo3DFloatHeight} min={0} max={2} step={0.05} unit="m" onChange={(v) => setUI({ logo3DFloatHeight: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="topbar-logo" title="Top bar logo" openId={openId} setOpenId={setOpenId}>
        <Slider label="Opacity" val={Math.round(ui.logoOpacity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setUI({ logoOpacity: v / 100 })} />
        <Slider label="Size" val={Math.round(ui.logoSize * 100)} min={50} max={200} step={5} unit="%" onChange={(v) => setUI({ logoSize: v / 100 })} />
      </CollapsibleSection>

      <CollapsibleSection id="grid" title="3D grid" openId={openId} setOpenId={setOpenId}>
        <Toggle label="Visible" val={ui.gridVisible} onChange={(v) => setUI({ gridVisible: v })} />
        <ColorRow label="Color" val={ui.gridColor} onChange={(v) => setUI({ gridColor: v })} />
        <Slider label="Cell size" val={ui.gridCellSize} min={0.5} max={10} step={0.5} unit="m" onChange={(v) => setUI({ gridCellSize: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="accent" title="Accent" openId={openId} setOpenId={setOpenId}>
        <ColorRow label="Color" val={ui.accentColor} onChange={(v) => setUI({ accentColor: v })} />
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

// ── Panel tabs ───────────────────────────────────────────────────────────────
type PanelId = 'layers' | 'settings' | 'presets'

const TABS: Array<{ id: PanelId; icon: string; label: string }> = [
  { id: 'layers',   icon: '≡', label: 'Layers'   },
  { id: 'presets',  icon: '★', label: 'Presets'  },
  { id: 'settings', icon: '⚙', label: 'Settings' },
]

// ── Layout ───────────────────────────────────────────────────────────────────
export default function WorkspaceLayout() {
  const [open, setOpen] = useState<PanelId | null>(null)
  const [uploadDismissed, setUploadDismissed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const drawings            = useAppStore((s) => s.drawings)
  const addDrawings         = useAppStore((s) => s.addDrawings)
  const loadPresetDrawing   = useAppStore((s) => s.loadPresetDrawing)
  const projectWallTypes   = useAppStore((s) => s.projectWallTypes)
  const detectedWallTypes  = useAppStore((s) => s.detectedWallTypes)
  const setProjectWallTypes = useAppStore((s) => s.setProjectWallTypes)
  const logoOpacity = useUISettingsStore((s) => s.logoOpacity)

  const handleLoadPreset = (presetId: PresetDifficulty) => {
    try {
      loadPresetDrawing(presetId, true)
      setUploadDismissed(true)
      // UX convention: a one-shot pick (preset, file, etc.) retracts the panel —
      // the user chose what they wanted, so the panel gets out of the way.
      setOpen(null)
    } catch (error) {
      console.error('Failed to load preset:', presetId, error)
    }
  }
  const logoSize    = useUISettingsStore((s) => s.logoSize)
  const topbarOpacity = useUISettingsStore((s) => s.topbarOpacity)

  const hasDrawings = drawings.length > 0
  const showUploadHint = !hasDrawings && !uploadDismissed

  const toggle = (id: PanelId) => setOpen((prev) => (prev === id ? null : id))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) { addDrawings(files); setUploadDismissed(true) }
    e.target.value = ''
  }

  return (
    <div className={styles.root}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        multiple style={{ display: 'none' }} onChange={handleFileChange} />

      {/* 3D Viewport — fills everything below the top bar */}
      <div className={styles.viewport}>
        <ModelViewer />
      </div>

      {/* Top bar — thin, semi-transparent, sits above viewport */}
      <div className={styles.topbar} style={{ background: `rgba(10,16,30,${topbarOpacity})` }}>
        <div style={{ opacity: logoOpacity, transform: `scale(${logoSize})`, transformOrigin: 'left center', display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoBadge3D />
          <span className={styles.logoSub}>by LearnIt3D</span>
        </div>

        <div className={styles.topbarActions} />
      </div>

      {/* Panel + tab — one unit that slides together.
          Only the 42px tab strip peeks out when retracted. */}
      <div className={`${styles.panelWrapper} ${open ? styles.panelWrapperOpen : ''}`}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>{TABS.find((t) => t.id === open)?.label ?? ''}</span>
            <button className={styles.panelClose} onClick={() => setOpen(null)}>✕</button>
          </div>
          <div className={styles.panelScroll}>
            {open === 'layers' && (
              <>
                <p className={styles.sectionTitle}>Layers</p>
                <LayerPanel />
                <p className={styles.sectionTitle}>Annotations</p>
                <AnnotationPanel />
                <p className={styles.sectionTitle}>Wall Types</p>
                <WallTypeLegend
                  types={projectWallTypes}
                  onUpdateTypes={setProjectWallTypes}
                  detectedIds={detectedWallTypes.map((d) => d.wallType.id)}
                />
              </>
            )}
            {open === 'presets' && (
              <>
                <p className={styles.sectionTitle}>Presets</p>
                <PresetPanel onLoad={handleLoadPreset} />
              </>
            )}
            {open === 'settings' && <SettingsContent />}
          </div>
        </div>

        {/* Tabs on the right edge of the panel */}
        <div className={styles.tabStrip}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`${styles.tab} ${open === t.id ? styles.tabActive : ''}`}
              onClick={() => toggle(t.id)}
              title={t.label}
            >
              <span className={styles.tabIcon}>{t.icon}</span>
              <span className={styles.tabLabel}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Onboarding card — dismissable, top-right, only when no drawings loaded */}
      {showUploadHint && (
        <div className={styles.uploadHint}>
          <div className={styles.uploadHintHeader}>
            <span className={styles.uploadHintTitle}>Get started</span>
            <button className={styles.uploadHintDismiss} onClick={() => setUploadDismissed(true)} title="Dismiss">✕</button>
          </div>
          <p className={styles.uploadHintSub}>Import a floor plan to begin — drag it anywhere onto the grid, or choose an option below.</p>
          <div className={styles.uploadHintActions}>
            <button className={styles.uploadHintBtn} onClick={() => fileInputRef.current?.click()}>
              📄 Browse files
            </button>
            <button className={styles.uploadHintBtnSecondary} onClick={() => fileInputRef.current?.click()}>
              📷 Scan with camera
            </button>
          </div>
          <p className={styles.uploadHintSub}>Use the left sidebar to browse presets or import a floor plan to begin.</p>
        </div>
      )}
    </div>
  )
}
