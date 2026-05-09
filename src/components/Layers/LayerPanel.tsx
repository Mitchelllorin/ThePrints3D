import { useAppStore } from '../../store/useAppStore'
import type { Layer } from '../../types'
import styles from './LayerPanel.module.css'

export default function LayerPanel() {
  const layers = useAppStore((s) => s.layers)
  const toggleLayer = useAppStore((s) => s.toggleLayer)
  const setLayerOpacity = useAppStore((s) => s.setLayerOpacity)

  return (
    <div className={styles.panel}>
      {layers.map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          onToggle={() => toggleLayer(layer.id)}
          onOpacity={(v) => setLayerOpacity(layer.id, v)}
        />
      ))}
    </div>
  )
}

interface RowProps {
  layer: Layer
  onToggle: () => void
  onOpacity: (v: number) => void
}

function LayerRow({ layer, onToggle, onOpacity }: RowProps) {
  return (
    <div className={`${styles.row} ${!layer.visible ? styles.hidden : ''}`}>
      <button className={styles.eyeBtn} onClick={onToggle} title="Toggle visibility">
        {layer.visible ? '👁' : '🙈'}
      </button>

      <span
        className={styles.swatch}
        style={{ background: layer.color }}
      />

      <span className={styles.icon}>{layer.icon}</span>
      <span className={styles.label}>{layer.label}</span>

      {layer.visible && (
        <input
          className={styles.opacity}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={layer.opacity}
          onChange={(e) => onOpacity(parseFloat(e.target.value))}
          title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
        />
      )}
    </div>
  )
}
