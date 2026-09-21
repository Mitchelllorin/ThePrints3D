/**
 * FRAMING — the two ways of reading the framing, where you can find them.
 *
 * Both switches already existed. They sat as rows in the Layers list, under
 * Structure, between the on/off for every layer in the model — 20px tall,
 * 10.5px text — and "Top plates: On/Off" never said that turning the top plates
 * OFF is how you get the top-down stud layout. Nobody would guess that, and
 * nobody did: asked where the stud layout was, the answer was "I can't find it".
 *
 * So they get a rail slot of their own, named for what they are FOR:
 *
 *   - STUD LAYOUT. Lifts the top plates away and looks straight down on the
 *     framed model, so the stud heads read the way a panel print draws them:
 *     singles, L's, T's and packs. Turning it off puts the plates back and
 *     leaves the camera where you had it.
 *   - COLOUR BY MEMBER. Every stick coloured by what it is. Off by default —
 *     some people want it and some do not — and its key shows only while it is
 *     on, so there is never a legend explaining colours nobody is looking at.
 *
 * The rows in Layers stay: that is where "what is visible" lives, and a switch
 * should be findable from where people look for it, which is more than one
 * place.
 */
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import { useAppStore } from '../../store/useAppStore'
import { MEMBER_KEY } from '../../services/memberColours'
import { planViewCamera } from '../../services/builtScene'
import styles from './FramingPanel.module.css'

export default function FramingPanel() {
  const topPlatesHidden = useUISettingsStore((s) => s.topPlatesHidden)
  const memberColours = useUISettingsStore((s) => s.memberColours)
  const setUI = useUISettingsStore((s) => s.set)
  const planView = useFloorplanLocalStore((s) => s.planView)
  const setPlanView = useFloorplanLocalStore((s) => s.setPlanView)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)

  /**
   * NOT PLAN VIEW. The first version of this switched to plan view, and plan
   * view HIDES THE BUILT MODEL — it is the print on its own, on purpose. So the
   * stud layout lifted the plates off and then hid every stud it had just
   * uncovered, leaving the drawing with nothing framed on it.
   *
   * The stud layout is the FRAMED MODEL seen from straight overhead. Same camera
   * as plan view — square on, framed to the real viewport shape — but the model
   * stays up, and if you were in plan view it takes you out of it so the studs
   * can be seen.
   */
  const toggleStudLayout = () => {
    const on = !topPlatesHidden
    setUI({ topPlatesHidden: on })
    if (on) {
      if (planView) setPlanView(false)
      const aspect = window.innerWidth / Math.max(1, window.innerHeight)
      setCameraPreset(planViewCamera(useAppStore.getState().floorplanOverlay, aspect))
    }
  }

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={`${styles.row} ${topPlatesHidden ? styles.on : ''}`}
        onClick={toggleStudLayout}
        aria-pressed={topPlatesHidden}
      >
        {/* On-state is a fill, a heavier border AND a check — never colour alone. */}
        <span className={styles.check} aria-hidden>{topPlatesHidden ? '✓' : ''}</span>
        <span className={styles.text}>
          <span className={styles.label}>Stud layout</span>
          <span className={styles.note}>Plates off, from above</span>
        </span>
      </button>

      <button
        type="button"
        className={`${styles.row} ${memberColours ? styles.on : ''}`}
        onClick={() => setUI({ memberColours: !memberColours })}
        aria-pressed={memberColours}
      >
        <span className={styles.check} aria-hidden>{memberColours ? '✓' : ''}</span>
        <span className={styles.text}>
          <span className={styles.label}>Colour by member</span>
          <span className={styles.note}>Every stick by what it is</span>
        </span>
      </button>

      {memberColours && (
        <ul className={styles.key} aria-label="Framing colour key">
          {MEMBER_KEY.map((m) => (
            <li key={m.kind} className={styles.keyItem}>
              <span className={styles.swatch} style={{ background: m.color }} />
              {m.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
