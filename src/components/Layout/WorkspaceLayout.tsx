import { useRef, useState } from 'react'
import ModelViewer from '../Viewer3D/ModelViewer'
import LayerPanel from '../Layers/LayerPanel'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import WallTypeLegend from '../WallTypeLegend'
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import styles from './WorkspaceLayout.module.css'

// ── Settings panel content ───────────────────────────────────────────────────
function SettingsContent() {
  const s = useUISettingsStore()
  const set = useUISettingsStore((x) => x.set)
  const reset = useUISettingsStore((x) => x.reset)

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

  function ColorRow({ label, val, onChange }: { label: string; val: string; onChange: (v: string) => void }) {
    return (
      <label className={styles.settingRow}>
        <span className={styles.settingLabel}>{label}</span>
        <input type="color" value={val} onChange={(e) => onChange(e.target.value)} className={styles.settingColor} />
        <span className={styles.settingVal}>{val}</span>
      </label>
    )
  }

  return (
    <div className={styles.settingsBody}>
      <p className={styles.settingGroup}>Panels</p>
      <Slider label="Top bar" val={Math.round(s.topbarOpacity * 100)} min={20} max={100} step={1} unit="%" onChange={(v) => set({ topbarOpacity: v / 100 })} />
      <Slider label="Side panel" val={Math.round(s.sidebarOpacity * 100)} min={20} max={100} step={1} unit="%" onChange={(v) => set({ sidebarOpacity: v / 100 })} />
      <Slider label="Floaters" val={Math.round(s.panelOpacity * 100)} min={20} max={100} step={1} unit="%" onChange={(v) => set({ panelOpacity: v / 100 })} />

      <p className={styles.settingGroup}>Logo</p>
      <Slider label="Opacity" val={Math.round(s.logoOpacity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ logoOpacity: v / 100 })} />
      <Slider label="Size" val={Math.round(s.logoSize * 100)} min={50} max={200} step={5} unit="%" onChange={(v) => set({ logoSize: v / 100 })} />

      <p className={styles.settingGroup}>3D Grid</p>
      <Slider label="Opacity" val={Math.round(s.gridOpacity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => set({ gridOpacity: v / 100 })} />
      <ColorRow label="Color" val={s.gridColor} onChange={(v) => set({ gridColor: v })} />
      <Slider label="Cell size" val={s.gridCellSize} min={0.5} max={10} step={0.5} unit="m" onChange={(v) => set({ gridCellSize: v })} />
      <Slider label="Divisions" val={s.gridDivisions} min={2} max={40} step={1} onChange={(v) => set({ gridDivisions: v })} />

      <p className={styles.settingGroup}>Accent</p>
      <ColorRow label="Color" val={s.accentColor} onChange={(v) => set({ accentColor: v })} />

      <button className={styles.resetBtn} onClick={reset}>Reset to defaults</button>
    </div>
  )
}

// ── Panel tabs ───────────────────────────────────────────────────────────────
type PanelId = 'layers' | 'settings'

const TABS: Array<{ id: PanelId; icon: string; label: string }> = [
  { id: 'layers',   icon: '≡', label: 'Layers'   },
  { id: 'settings', icon: '⚙', label: 'Settings' },
]

// ── Layout ───────────────────────────────────────────────────────────────────
export default function WorkspaceLayout() {
  const [open, setOpen] = useState<PanelId | null>(null)
  const [uploadDismissed, setUploadDismissed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const drawings           = useAppStore((s) => s.drawings)
  const addDrawings        = useAppStore((s) => s.addDrawings)
  const projectWallTypes   = useAppStore((s) => s.projectWallTypes)
  const detectedWallTypes  = useAppStore((s) => s.detectedWallTypes)
  const setProjectWallTypes = useAppStore((s) => s.setProjectWallTypes)
  const logoOpacity = useUISettingsStore((s) => s.logoOpacity)
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
        <div
          className={styles.logo}
          style={{ opacity: logoOpacity, transform: `scale(${logoSize})`, transformOrigin: 'left center' }}
        >
          <span className={styles.logoBlue}>Blue</span>Print3D
          <span className={styles.logoSub}>by LearnIt3D</span>
        </div>

        <div className={styles.topbarActions}>
          <button className={styles.topbarBtn} onClick={() => fileInputRef.current?.click()} title="Upload a floor plan">
            + Upload
          </button>
        </div>
      </div>

      {/* Left tab strip */}
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

      {/* Slide-out panel */}
      <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{TABS.find((t) => t.id === open)?.label}</span>
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
          {open === 'settings' && <SettingsContent />}
        </div>
      </div>

      {/* Upload hint — small dismissable card, top-right, only when no drawings */}
      {showUploadHint && (
        <div className={styles.uploadHint}>
          <div className={styles.uploadHintText}>
            <span className={styles.uploadHintIcon}>📐</span>
            <div>
              <div className={styles.uploadHintTitle}>Drop a floor plan</div>
              <div className={styles.uploadHintSub}>PDF · PNG · JPG · TIFF</div>
            </div>
          </div>
          <div className={styles.uploadHintActions}>
            <button className={styles.uploadHintBtn} onClick={() => fileInputRef.current?.click()}>
              Browse files
            </button>
            <button className={styles.uploadHintDismiss} onClick={() => setUploadDismissed(true)} title="Dismiss">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
