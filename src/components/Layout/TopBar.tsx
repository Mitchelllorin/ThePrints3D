import { useAppStore } from '../../store/useAppStore'
import styles from './TopBar.module.css'

export default function TopBar() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const drawings = useAppStore((s) => s.drawings)
  const wizardOpen = useAppStore((s) => s.wizardOpen)
  const setWizardOpen = useAppStore((s) => s.setWizardOpen)
  const buildModel = useAppStore((s) => s.buildModel)

  const hasDrawings = drawings.length > 0
  const readyCount = drawings.filter(d => d.parsedWalls.length > 0).length

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>📐</span>
          <span className={styles.brandName}>
            <span className={styles.brandBlue}>Blue</span>
            <span>Print3D</span>
          </span>
        </div>
      </div>

      <nav className={styles.nav}>
        <button
          className={`${styles.navBtn} ${view === 'upload' ? styles.active : ''}`}
          onClick={() => setView('upload')}
        >
          Upload
        </button>
        <button
          className={`${styles.navBtn} ${view === 'drawings' ? styles.active : ''} ${!hasDrawings ? styles.disabled : ''}`}
          onClick={() => hasDrawings && setView('drawings')}
          disabled={!hasDrawings}
        >
          Drawings
          {hasDrawings && <span className={styles.badge}>{drawings.length}</span>}
        </button>
        <button
          className={`${styles.navBtn} ${wizardOpen ? styles.active : ''}`}
          onClick={() => setWizardOpen(!wizardOpen)}
        >
          🔧 Build Assistant
        </button>
        <button
          className={`${styles.navBtn} ${view === 'model' ? styles.active : ''} ${!hasDrawings ? styles.disabled : ''}`}
          onClick={() => hasDrawings && setView('model')}
          disabled={!hasDrawings}
        >
          3D Model
        </button>
        <button
          className={`${styles.navBtn} ${view === 'tools' ? styles.active : ''}`}
          onClick={() => setView('tools')}
        >
          Toolbox
        </button>
        <button
          className={`${styles.navBtn} ${view === 'create' ? styles.active : ''}`}
          onClick={() => setView('create')}
        >
          ✏️ Create
        </button>
      </nav>

      <div className={styles.right}>
        {hasDrawings && view !== 'model' && (
          <button className={styles.buildBtn} onClick={buildModel} disabled={readyCount === 0} title={readyCount === 0 ? 'Analyse drawings first' : 'Build 3D model from analysed drawings'}>
            ⬡ Build 3D Model
          </button>
        )}
      </div>
    </header>
  )
}
