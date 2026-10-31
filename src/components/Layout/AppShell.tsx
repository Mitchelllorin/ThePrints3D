import { useState, type ReactNode } from 'react'
import { useAppStore } from '../../store/useAppStore'
import TopBar from './TopBar'
import Sidebar from './Sidebar'
import SettingsPanel from '../Settings/SettingsPanel'
import ProjectLibrary from '../Projects/ProjectLibrary'
import SaveStatus from './SaveStatus'
import styles from './AppShell.module.css'

interface Props {
  children: ReactNode
}

export default function AppShell({ children }: Props) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Save & load, reachable from every screen. The same list also lives inline
  // in Settings → Jobs, but that is the second door, not the only one.
  const [jobsOpen, setJobsOpen] = useState(false)

  return (
    <div className={styles.shell}>
      <TopBar
        onSettingsOpen={() => setSettingsOpen((o) => !o)}
        settingsOpen={settingsOpen}
        onJobsOpen={() => setJobsOpen(true)}
      />
      {/* THE SAVE, WHEN IT FAILS. Nothing renders while autosave is working. */}
      <SaveStatus onOpenJobs={() => setJobsOpen(true)} />
      <div className={styles.body}>
        <Sidebar />
        <main className={`${styles.main} ${!sidebarOpen ? styles.mainExpanded : ''}`}>
          {children}
        </main>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {jobsOpen && <ProjectLibrary onClose={() => setJobsOpen(false)} />}
    </div>
  )
}
