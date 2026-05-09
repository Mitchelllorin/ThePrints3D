import type { ReactNode } from 'react'
import { useAppStore } from '../../store/useAppStore'
import TopBar from './TopBar'
import Sidebar from './Sidebar'
import styles from './AppShell.module.css'

interface Props {
  children: ReactNode
}

export default function AppShell({ children }: Props) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)

  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={`${styles.main} ${!sidebarOpen ? styles.mainExpanded : ''}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
