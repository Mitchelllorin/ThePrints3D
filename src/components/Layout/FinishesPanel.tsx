/**
 * FinishesPanel — what the building is MADE OF: sheathing, barrier, cladding,
 * interior board, and when any of it appears.
 *
 * This lived in Settings, which was wrong. Settings is for how the APP behaves —
 * grid, colours, units, label size. These are decisions about the BUILDING:
 * cladding changes a wall's real thickness, drives the barrier choice, and
 * decides whether there is a brick ledge. Putting them beside the grid colour
 * meant leaving the thing you were doing to make a decision about the thing you
 * were doing.
 *
 * So it lives in the Build drawer with Floors, Framing and Roof, in the order the
 * work happens: sheathe, wrap, clad, board.
 *
 * Self-contained on purpose — it reads and writes the UI settings store directly,
 * so it can be mounted anywhere without threading props through a panel.
 */
import { useAppStore } from '../../store/useAppStore'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import {
  recommendedWrb, wallTakesEnvelope, wallFramingSpec,
  type WrbKind, type WoodSheathing, type CladdingKind, type BoardKind,
} from '../../services/constructionCode'
import styles from './FinishesPanel.module.css'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  )
}

function Pick<T extends string>({ value, options, onChange }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function FinishesPanel() {
  const ui = useUISettingsStore()
  const setUI = useUISettingsStore((s) => s.set)

  // What the EXTERIOR walls on this plan are actually framed in, so the barrier
  // advice fits the building rather than a guess. Steel anywhere on the shell is
  // enough — DensGlass wants an AVB whether or not there is wood elsewhere.
  const framingMaterial = useAppStore((s) => {
    for (const d of s.drawings) {
      for (const w of d.parsedWalls) {
        if (w.source !== 'user') continue
        if (!wallTakesEnvelope(w.wallRole, w.framingType)) continue
        if (wallFramingSpec(w.framingType, w.wallRole).material === 'steel') return 'steel' as const
      }
    }
    return 'wood' as const
  })

  const wantedWrb = recommendedWrb(ui.cladding, framingMaterial)

  return (
    <div className={styles.body}>
      {/* WHEN, as opposed to WHICH. Framing is the thing you are working on while
          you build; cladding it the instant you pull a wall hides the work. */}
      <Row label="Apply">
        <Pick
          value={ui.finishTiming}
          options={[{ value: 'later', label: 'When I say' }, { value: 'live', label: 'As I build' }]}
          onChange={(v) => setUI({ finishTiming: v, finishesApplied: false })}
        />
      </Row>
      {ui.finishTiming === 'later' && (
        <button className={styles.applyBtn} onClick={() => setUI({ finishesApplied: !ui.finishesApplied })}>
          {ui.finishesApplied ? '← Back to bare frame' : 'Apply finishes now'}
        </button>
      )}

      <p className={styles.group}>Exterior</p>
      <label className={styles.row}>
        <span className={styles.label}>Sheathe</span>
        <input type="checkbox" className={styles.check} checked={ui.sheathingVisible}
          onChange={(e) => setUI({ sheathingVisible: e.target.checked })} />
      </label>
      <Row label="Panel">
        <Pick<WoodSheathing>
          value={ui.woodSheathing}
          options={[{ value: 'osb', label: 'OSB 7/16"' }, { value: 'plywood', label: 'CDX plywood 15/32"' }]}
          onChange={(v) => setUI({ woodSheathing: v })}
        />
      </Row>
      <label className={styles.row}>
        <span className={styles.label}>Barrier</span>
        <input type="checkbox" className={styles.check} checked={ui.wrapVisible}
          onChange={(e) => setUI({ wrapVisible: e.target.checked })} />
      </label>
      <Row label="Type">
        <Pick<WrbKind>
          value={ui.wrbKind}
          options={[
            { value: 'housewrap', label: 'Housewrap (Tyvek-type)' },
            { value: 'felt', label: 'Asphalt felt (tar paper)' },
            { value: 'fluid', label: 'Fluid-applied' },
            { value: 'avb', label: 'Air/vapour barrier (steel)' },
            { value: 'integrated', label: 'Integrated in sheathing (ZIP)' },
          ]}
          onChange={(v) => setUI({ wrbKind: v })}
        />
      </Row>
      {/* Wet-applied finishes bond to housewrap and wreck its drainage — a real
          failure, so say so rather than silently building a wall that leaks. */}
      {wantedWrb !== ui.wrbKind && (
        <button className={styles.advice} onClick={() => setUI({ wrbKind: wantedWrb })}>
          {wantedWrb === 'felt' ? 'This finish wants felt behind it — switch?'
            : wantedWrb === 'avb' ? 'Steel + DensGlass wants an air/vapour barrier — switch?'
            : 'Housewrap suits this wall — switch?'}
        </button>
      )}
      <Row label="Cladding">
        <Pick<CladdingKind>
          value={ui.cladding}
          options={[
            { value: 'none', label: 'None (dried-in)' },
            { value: 'vinyl-lap', label: 'Vinyl lap siding' },
            { value: 'fiber-cement-lap', label: 'Fiber-cement lap (Hardie)' },
            { value: 'wood-lap', label: 'Wood bevel siding' },
            { value: 'panel', label: 'Rainscreen panel' },
            { value: 'stucco', label: 'Stucco (3-coat)' },
            { value: 'brick-veneer', label: 'Brick veneer (+ledge)' },
            { value: 'stone-veneer', label: 'Adhered stone veneer' },
          ]}
          onChange={(v) => setUI({ cladding: v })}
        />
      </Row>

      <p className={styles.group}>Interior</p>
      <label className={styles.row}>
        <span className={styles.label}>Board</span>
        <input type="checkbox" className={styles.check} checked={ui.drywallVisible}
          onChange={(e) => setUI({ drywallVisible: e.target.checked })} />
      </label>
      <Row label="Type">
        <Pick<BoardKind>
          value={ui.boardKind}
          options={[
            { value: 'gypsum-half', label: 'Gypsum 1/2"' },
            { value: 'gypsum-type-x', label: 'Gypsum 5/8" Type X (fire)' },
            { value: 'mold-resistant', label: 'Mould-resistant (DensArmor)' },
            { value: 'cement-board', label: 'Cement board (Durock)' },
            { value: 'glassmat-tile', label: 'Glass-mat tile backer (DensShield)' },
            { value: 'foam-waterproof', label: 'Waterproof foam (Schluter KERDI-BOARD)' },
          ]}
          onChange={(v) => setUI({ boardKind: v })}
        />
      </Row>
      <Row label="Sheets">
        <Pick<'vertical' | 'horizontal'>
          value={ui.drywallOrientation}
          options={[{ value: 'vertical', label: 'Vertical (4×8 standing)' }, { value: 'horizontal', label: 'Horizontal' }]}
          onChange={(v) => setUI({ drywallOrientation: v })}
        />
      </Row>
    </div>
  )
}
