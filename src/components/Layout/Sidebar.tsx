import { useAppStore } from '../../store/useAppStore'
import LayerPanel from '../Layers/LayerPanel'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import WallTypeLegend from '../WallTypeLegend'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const sidebarOpen       = useAppStore((s) => s.sidebarOpen)
  const projectWallTypes  = useAppStore((s) => s.projectWallTypes)
  const detectedWallTypes = useAppStore((s) => s.detectedWallTypes)
  const setProjectWallTypes = useAppStore((s) => s.setProjectWallTypes)

  return (
    <aside className={`${styles.sidebar} ${!sidebarOpen ? styles.sidebarCollapsed : ''}`}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Layers</h2>
        <LayerPanel />
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Annotations</h2>
        <AnnotationPanel />
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Wall Types</h2>
        <WallTypeLegend
          types={projectWallTypes}
          onUpdateTypes={setProjectWallTypes}
          detectedIds={detectedWallTypes.map((d) => d.wallType.id)}
        />
      </section>
    </aside>
  )
}
