import { useState } from 'react'
import UnitConverter from './UnitConverter'
import ConstructionCalculators from './ConstructionCalculators'
import styles from './Toolbox.module.css'

type ToolsTab = 'converter' | 'calculators'

export default function Toolbox() {
  const [tab, setTab] = useState<ToolsTab>('converter')

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Toolbox</h1>
        <p className={styles.subtitle}>
          Converters and construction calculators for day-to-day estimating work.
        </p>
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
