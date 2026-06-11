import { useAppStore } from '../../store/useAppStore'
import styles from './TopBar.module.css'

export default function TopBar({ onSettingsOpen, settingsOpen }: { onSettingsOpen: () => void; settingsOpen: boolean }) {
  const sidebarOpen  = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button
          className={styles.menuBtn}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="Toggle layers panel"
        >
          ☰
        </button>
        <div className={styles.brand}>
          <span className={styles.brandName}>
            <span className={styles.brandBlue}>Blue</span>
            <span>Print3D</span>
          </span>
          <span className={styles.brandSub}>by LearnIt3D</span>
        </div>
      </div>

      <div className={styles.right}>
        <button
          className={`${styles.settingsBtn} ${settingsOpen ? styles.settingsBtnActive : ''}`}
          onClick={onSettingsOpen}
          title="Display settings"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
