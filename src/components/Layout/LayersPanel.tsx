/**
 * LayersPanel — the 4 trade layers (Framing / Plumbing / Electrical / HVAC),
 * each a colour dot + name (tap to make active) + On/Off visibility toggle, with
 * the active layer highlighted. Shared by the bottom "Place & Layers" drawer.
 */
import { useAppStore } from '../../store/useAppStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import styles from './WorkspaceLayout.module.css'

const LAYER_ROWS: Array<{ key: 'framing' | 'plumbing' | 'electrical' | 'hvac'; label: string; color: string }> = [
  { key: 'framing', label: 'Framing', color: '#ffffff' },
  { key: 'plumbing', label: 'Plumbing', color: '#60a5fa' },
  { key: 'electrical', label: 'Electrical', color: '#facc15' },
  { key: 'hvac', label: 'HVAC', color: '#4ade80' },
]

export default function LayersPanel() {
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
