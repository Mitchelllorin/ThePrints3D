import { useState } from 'react'
import UnitConverter from './UnitConverter'
import ConstructionCalculators from './ConstructionCalculators'
import { useAppStore } from '../../store/useAppStore'
import styles from './Toolbox.module.css'

type ToolsTab = 'converter' | 'calculators'

export default function Toolbox() {
  const [tab, setTab] = useState<ToolsTab>('converter')
  const setView = useAppStore((s) => s.setView)
  const hasDrawings = useAppStore((s) => s.drawings.length > 0)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Toolbox</h1>
        <p className={styles.subtitle}>
          Converters and construction calculators for day-to-day estimating work.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className={styles.tabBtn} onClick={() => setView('drawings')} disabled={!hasDrawings}>
            ← Back to Drawings
          </button>
          <button className={styles.tabBtn} onClick={() => setView('model')} disabled={!hasDrawings}>
            Go to 3D Model →
          </button>
        </div>
      </header>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${tab === 'converter' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('converter')}
        >
          Unit Converter
        </button>
        <button
          className={`${styles.tabBtn} ${tab === 'calculators' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('calculators')}
        >
          Construction Calculators
        </button>
      </div>

      {tab === 'converter' ? <UnitConverter /> : <ConstructionCalculators />}
    </div>
  )
}
