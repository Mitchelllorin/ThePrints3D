import { useAppStore } from '../../store/useAppStore'
import { DEFAULT_WALL_DETECTION_CONFIG } from '../../store/wallDetectionConfig'
import styles from './WallCalibrationPanel.module.css'

interface SliderRowProps {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onReset: () => void
}

function SliderRow({ label, hint, value, min, max, step, onChange, onReset }: SliderRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
        <button className={styles.resetBtn} onClick={onReset} title="Reset to default">&#8635;</button>
      </div>
      <p className={styles.hint}>{hint}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.slider}
      />
      <div className={styles.minMax}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

export default function WallCalibrationPanel({ onClose }: { onClose: () => void }) {
  const config = useAppStore((s) => s.wallDetectionConfig)
  const setConfig = useAppStore((s) => s.setWallDetectionConfig)
  const D = DEFAULT_WALL_DETECTION_CONFIG

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>&#127917; Wall Detection Calibration</h3>
          <button className={styles.closeBtn} onClick={onClose}>&#x2715;</button>
        </div>
        <p className={styles.subtitle}>
          Tune how the AI and heuristic detector interpret your drawings. Changes apply on the next analysis run.
        </p>
        <SliderRow label="AI Confidence Threshold" hint="How certain the AI must be before marking a pixel as wall. Lower = catches more, higher = less noise." value={config.aiThreshold} min={0.1} max={0.9} step={0.05} onChange={(v) => setConfig({ aiThreshold: v })} onReset={() => setConfig({ aiThreshold: D.aiThreshold })} />
        <SliderRow label="Edge Sensitivity" hint="Lower values detect faint lines. Raise if getting too much noise." value={config.edgeThreshold} min={1} max={30} step={1} onChange={(v) => setConfig({ edgeThreshold: v })} onReset={() => setConfig({ edgeThreshold: D.edgeThreshold })} />
        <SliderRow label="Min Wall Length (px)" hint="Segments shorter than this are discarded. Raise to reduce clutter." value={config.minWallLengthPx} min={10} max={200} step={2} onChange={(v) => setConfig({ minWallLengthPx: v })} onReset={() => setConfig({ minWallLengthPx: D.minWallLengthPx })} />
        <SliderRow label="Min Wall Thickness (px)" hint="Lines thinner than this are ignored. Raise to skip hairlines." value={config.minWallThicknessPx} min={1} max={20} step={1} onChange={(v) => setConfig({ minWallThicknessPx: v })} onReset={() => setConfig({ minWallThicknessPx: D.minWallThicknessPx })} />
        <SliderRow label="Max Wall Thickness (px)" hint="Lines thicker than this won't be treated as walls. Raise for thick structural walls." value={config.maxWallThicknessPx} min={20} max={300} step={5} onChange={(v) => setConfig({ maxWallThicknessPx: v })} onReset={() => setConfig({ maxWallThicknessPx: D.maxWallThicknessPx })} />
        <SliderRow label="Merge Gap (px)" hint="Gaps smaller than this between segments get auto-joined. Raise if walls are being split up." value={config.mergeGapPx} min={0} max={30} step={1} onChange={(v) => setConfig({ mergeGapPx: v })} onReset={() => setConfig({ mergeGapPx: D.mergeGapPx })} />
        <div className={styles.footer}>
          <button className={styles.resetAllBtn} onClick={() => setConfig({ ...D })}>&#8635; Reset All to Defaults</button>
        </div>
      </div>
    </div>
  )
                                                                                                                                                                                                       }
