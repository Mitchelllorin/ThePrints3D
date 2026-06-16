import { useAppStore } from '../../store/useAppStore'
import styles from './LayerPanel.module.css'

/**
 * Full layer list — one clean on/off toggle per layer (no opacity sliders,
 * no cartoon icons). The major systems also get quick top-right toggles; this
 * is the complete list with colour swatches.
 */
export default function LayerPanel() {
  const layers = useAppStore((s) => s.layers)
  const toggleLayer = useAppStore((s) => s.toggleLayer)

  return (
    <div className={styles.panel}>
      {layers.map((layer) => (
        <button
          key={layer.id}
          className={`${styles.row} ${!layer.visible ? styles.hidden : ''}`}
          onClick={() => toggleLayer(layer.id)}
          title={`${layer.label}: ${layer.visible ? 'visible' : 'hidden'}`}
        >
          <span className={styles.swatch} style={{ background: layer.color }} />
          <span className={styles.label}>{layer.label}</span>
          <span className={styles.state}>{layer.visible ? 'On' : 'Off'}</span>
        </button>
      ))}
    </div>
  )
}
