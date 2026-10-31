import { useAppStore } from '../../store/useAppStore'
import styles from './TopBar.module.css'

export default function TopBar({ onSettingsOpen, settingsOpen, onJobsOpen }: {
  onSettingsOpen: () => void
  settingsOpen: boolean
  /** Save & load. In the bar because a job list you cannot find is a job list
   *  that does not exist — it used to live only inside Settings. */
  onJobsOpen: () => void
}) {
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
          className={styles.jobsBtn}
          onClick={onJobsOpen}
          title="Save & load jobs"
          aria-label="Save and load jobs"
        >
          <span aria-hidden style={{ fontSize: 14 }}>🗂</span>
          <span>Jobs</span>
        </button>
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
