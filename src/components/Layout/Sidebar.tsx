import { useAppStore } from '../../store/useAppStore'
import LayerPanel from '../Layers/LayerPanel'
import AnnotationPanel from '../Annotations/AnnotationPanel'
import WallTypeLegend from '../WallTypeLegend'
import ProjectContextPanel from '../ProjectContext/ProjectContextPanel'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const view = useAppStore((s) => s.view)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const projectWallTypes = useAppStore((s) => s.projectWallTypes)
  const detectedWallTypes = useAppStore((s) => s.detectedWallTypes)
  const setProjectWallTypes = useAppStore((s) => s.setProjectWallTypes)

  if (!sidebarOpen) return null

  return (
    <aside className={styles.sidebar}>
      {view === 'model' && (
        <>
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
          <section className={styles.section}>
            <ProjectContextPanel phase="post3d" />
          </section>
        </>
      )}

      {view === 'drawings' && (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Drawing Set</h2>
            <p className={styles.hint}>Select a drawing to preview it</p>
          </section>
          <section className={styles.section}>
            <ProjectContextPanel phase="pre3d" />
          </section>
        </>
      )}

      {view === 'upload' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Getting Started</h2>
          <ol className={styles.steps}>
            <li>Upload your drawing set (PDF or images)</li>
            <li>Tag each sheet by discipline</li>
            <li>Click "Build 3D Model"</li>
            <li>Toggle layers to explore systems</li>
          </ol>
        </section>
      )}

      {view === 'tools' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Toolbox</h2>
          <p className={styles.hint}>Convert units and run quick construction calculators.</p>
        </section>
      )}
    </aside>
  )
}
