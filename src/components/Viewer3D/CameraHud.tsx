import { useAppStore } from '../../store/useAppStore'
import styles from './CameraHud.module.css'

/**
 * Floating camera preset buttons. Sits OUTSIDE the <Canvas>, dispatches
 * preset poses to the store; the in-canvas CameraController applies them.
 */
export default function CameraHud() {
  const setPreset = useAppStore((s) => s.setCameraPreset)
  return (
    <div className={styles.hud}>
      <button
        className={styles.hudBtn}
        title="Isometric (home view)"
        onClick={() => setPreset({ position: [12, 10, 12], target: [0, 0, 0] })}
      >
        ⌂
      </button>
      <button
        className={styles.hudBtn}
        title="Top-down view"
        onClick={() => setPreset({ position: [0, 35, 0.01], target: [0, 0, 0] })}
      >
        ⬒
      </button>
      <button
        className={styles.hudBtn}
        title="Front elevation"
        onClick={() => setPreset({ position: [0, 5, 25], target: [0, 0, 0] })}
      >
        ▭
      </button>
      <button
        className={styles.hudBtn}
        title="Side elevation"
        onClick={() => setPreset({ position: [25, 5, 0], target: [0, 0, 0] })}
      >
        ◧
      </button>
      <button
        className={styles.hudBtn}
        title="Reset / fit-to-view"
        onClick={() => setPreset({ position: [12, 10, 12], target: [0, 0, 0] })}
      >
        ⟲
      </button>
    </div>
  )
}
