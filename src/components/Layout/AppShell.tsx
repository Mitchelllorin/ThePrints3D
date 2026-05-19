import type { ReactNode } from 'react'
import TopBar from './TopBar'
import styles from './AppShell.module.css'

interface Props {
  children: ReactNode
}

export default function AppShell({ children }: Props) {
  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.body}>
        <main className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  )
}
