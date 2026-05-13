import { useAppStore } from '../../store/useAppStore'
import styles from './TopBar.module.css'

export default function TopBar() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const drawings = useAppStore((s) => s.drawings)
  const buildModel = useAppStore((s) => s.buildModel)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)

  const hasDrawings = drawings.length > 0

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button
          className={styles.menuBtn}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="Toggle sidebar"
        >
          ☰
        </button>
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
      </nav>

      <div className={styles.right}>
        {hasDrawings && view !== 'model' && (
          <button className={styles.buildBtn} onClick={buildModel}>
            ⬡ Build 3D Model
          </button>
        )}
      </div>
    </header>
  )
}
