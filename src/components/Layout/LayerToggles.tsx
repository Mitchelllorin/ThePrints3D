/**
 * LayerToggles — compact top-right on/off buttons for the major building
 * systems. No sliders (visibility is all-or-nothing), no cartoon icons: just
 * clear text chips that flip each system's geometry on and off in the 3D model.
 */
import { useAppStore } from '../../store/useAppStore'
import type { LayerId } from '../../types'
import styles from './LayerToggles.module.css'

// The construction systems worth a one-tap toggle, in reading order.
const SYSTEMS: Array<{ id: LayerId; label: string }> = [
  { id: 'walls', label: 'Walls' },
  { id: 'floors', label: 'Floors' },
  { id: 'framing', label: 'Framing' },
  { id: 'electrical', label: 'Elec' },
  { id: 'plumbing', label: 'Plumb' },
  { id: 'mechanical', label: 'HVAC' },
]

export default function LayerToggles() {
  const layers = useAppStore((s) => s.layers)
  const toggleLayer = useAppStore((s) => s.toggleLayer)
  const byId = new Map(layers.map((l) => [l.id, l]))

  return (
    <div className={styles.bar}>
      {SYSTEMS.map((sys) => {
        const layer = byId.get(sys.id)
        if (!layer) return null
        return (
          <button
            key={sys.id}
            className={layer.visible ? styles.on : styles.off}
            onClick={() => toggleLayer(sys.id)}
            title={`${layer.label}: ${layer.visible ? 'visible — tap to hide' : 'hidden — tap to show'}`}
          >
            {sys.label}
          </button>
        )
      })}
    </div>
  )
}
