/**
 * F.U.S.E.™ — the years timeline, in the rail.
 *
 * The build review answers "what is wrong with this drawing today". This
 * answers the other question, the one that decides where the money goes: WHAT
 * GOES FIRST, and when. Scrub the years and the building ages in front of you —
 * the cladding chalks, the wrap's laps go, the sheathing swells, and the order
 * they arrive in is the reading.
 *
 * Three deliberate choices:
 *
 *   • THE SCRUBBER IS THE WHOLE PANEL. A number per product would be a table
 *     you read once; a timeline you can push is a thing you learn something
 *     from, because the answer changes as you move it. Year 0 is "everything is
 *     new"; year 12 is "this is your next five years".
 *
 *   • ONE LAYER AT A TIME, worst first. Same rule as the review card: a wall of
 *     text gets skipped, and the fact that matters is always the first one.
 *     ‹ › walk the line down the wall.
 *
 *   • SHOW ME FLIES AND UNCOVERS. A verdict about sheathing is useless while
 *     the siding is still drawn on top of it, so the jump also throws the
 *     model's own visibility switches — the ones in Layers — so you can see
 *     exactly what is being talked about and put them back yourself.
 *
 * The four questions at the foot are what the model cannot know: the site, the
 * roof covering, whether the roof space breathes, and whether anything is being
 * kept up. Everything else comes out of the drawings, including the fact that a
 * wrap is protected (see services/fuse/building.ts).
 */
import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { useSceneConfig } from '../../store/useSceneConfig'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import { FLOOR_ASSEMBLY_H } from '../../services/framingGeometry'
import { focusSceneFor } from '../../services/buildFocus'
import {
  HORIZON_YEARS, RISK_COLOR, RISK_LABEL, ROOF_COVERINGS, SITES,
  cameraForAssembly, readBuilding, siteById, uncoverFor,
  type AssemblyState, type BuildShape,
} from '../../services/fuse'
import styles from './FusePanel.module.css'

/** A tick on the timeline, at the year a layer goes. */
function Tick({ year, level }: { year: number; level: AssemblyState['level'] }) {
  return (
    <span
      className={styles.tick}
      style={{ left: `${(year / HORIZON_YEARS) * 100}%`, background: RISK_COLOR[level] }}
    />
  )
}

export default function FusePanel() {
  const drawings = useAppStore((s) => s.drawings)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)

  const framingMaterial = useConfigStore((s) => s.framingMaterial)
  const storeyHeightM = useSceneConfig(wizardInputs).wallHeightM + FLOOR_ASSEMBLY_H

  // Selected field by field, not as the whole store: the rail is over the
  // model, and an unrelated settings write must not re-render it (same reason
  // RailCascade reads one boolean for "something to edit").
  const cladding = useUISettingsStore((s) => s.cladding)
  const wrbKind = useUISettingsStore((s) => s.wrbKind)
  const woodSheathing = useUISettingsStore((s) => s.woodSheathing)
  const boardKind = useUISettingsStore((s) => s.boardKind)
  const fuseYear = useUISettingsStore((s) => s.fuseYear)
  const fuseSiteId = useUISettingsStore((s) => s.fuseSiteId)
  const fuseRoofing = useUISettingsStore((s) => s.fuseRoofing)
  const fuseAtticVentilated = useUISettingsStore((s) => s.fuseAtticVentilated)
  const fuseMaintained = useUISettingsStore((s) => s.fuseMaintained)
  const setUI = useUISettingsStore((s) => s.set)

  /** Which layer the walk is on, and whether its reasoning is open. Both reset
   *  per layer, exactly like the review card — "why" never carries over onto
   *  the next thing. */
  const [step, setStep] = useState(0)
  const [whyOpen, setWhyOpen] = useState(false)

  const hasWalls = drawings.some((d) => d.parsedWalls.length > 0) || placedObjects.length > 0

  /** Storeys the model was drawn with — one plus the deepest level anything
   *  sits on, so a roof aims at the roof and not at the ground floor's. */
  const storeys = useMemo(() => {
    const levels = [
      ...drawings.flatMap((d) => d.parsedWalls.map((w) => w.level ?? 0)),
      ...floorsAreas.map((f) => f.level ?? 0),
      ...roofAreas.map((r) => r.level ?? 0),
      ...placedObjects.map((o) => o.level ?? 0),
    ]
    return 1 + Math.max(0, ...levels)
  }, [drawings, floorsAreas, roofAreas, placedObjects])

  const year = Math.min(HORIZON_YEARS, Math.max(0, Math.round(fuseYear)))
  const reading = useMemo(
    () => readBuilding({
      shape: {
        framingMaterial, cladding, wrb: wrbKind, woodSheathing, board: boardKind,
        hasWalls, hasRoof: roofAreas.length > 0, storeys,
        hasPlumbing: plumbingLines.length > 0, hasElectrical: electricalLines.length > 0,
        roofing: fuseRoofing,
      },
      siteId: fuseSiteId,
      answered: { atticVentilated: fuseAtticVentilated, maintained: fuseMaintained },
      year,
    }),
    [framingMaterial, cladding, wrbKind, woodSheathing, boardKind, hasWalls,
      roofAreas.length, storeys, plumbingLines.length, electricalLines.length,
      fuseRoofing, fuseSiteId, fuseAtticVentilated, fuseMaintained, year],
  )

  const site = siteById(fuseSiteId)
  const states = reading.states
  const stepIndex = states.length === 0 ? 0 : Math.min(step, states.length - 1)
  const shown = states[stepIndex]

  // Built once and reused by every jump, so two verdicts cannot land the camera
  // in two slightly different places.
  const scene = useMemo(
    () => focusSceneFor({ drawings, placedObjects, overlay, storeyHeightM }).scene,
    [drawings, placedObjects, overlay, storeyHeightM],
  )

  /** Take me there — and take the covering off it so there is something to see. */
  const showMe = (s: AssemblyState) => {
    setCameraPreset(cameraForAssembly(s.look, scene, { storeys }))
    const uncover = uncoverFor(s.look.reveal)
    if (Object.keys(uncover).length > 0) setUI(uncover)
  }

  const goStep = (n: number) => {
    setStep(Math.max(0, Math.min(states.length - 1, n)))
    setWhyOpen(false)
  }

  if (!hasWalls) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.mark}>⚡ F.U.S.E.<sup>™</sup></span>
        </div>
        <p className={styles.empty}>
          Nothing to age yet. Draw a wall or build one and F.U.S.E. starts the clock.
        </p>
      </div>
    )
  }

  /** The one line that says what this year means. */
  const yearLine = shown == null
    ? 'Nothing in this wall to score.'
    : shown.failsYear == null
      ? `Holding — ${Math.round(shown.reserve * 100)}% left`
      : shown.failsYear <= year
        ? `Gone — year ${shown.failsYear}`
        : `Goes in year ${shown.failsYear}`

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.mark}>⚡ F.U.S.E.<sup>™</sup></span>
        <span className={styles.sub}>Failure Understanding · {HORIZON_YEARS} years</span>
      </div>

      {/* THE TIMELINE. Big read-out, the track with a tick per failure, and the
          scrubber itself — the whole point of the panel. */}
      <div className={styles.timeline}>
        <div className={styles.yearRow}>
          <span className={styles.year}>{year}</span>
          <span className={styles.yearUnit}>{year === 0 ? 'new' : year === 1 ? 'year' : 'years'}</span>
          <span className={styles.spacer} />
          <span className={styles.gone}>
            {reading.failedCount === 0 ? 'all holding' : `${reading.failedCount} gone`}
          </span>
        </div>
        <div className={styles.track} aria-hidden>
          {states.filter((s) => s.failsYear != null).map((s) => (
            <Tick key={s.id} year={s.failsYear!} level="failed" />
          ))}
          <span className={styles.now} style={{ left: `${(year / HORIZON_YEARS) * 100}%` }} />
        </div>
        <input
          className={styles.range}
          type="range"
          min={0}
          max={HORIZON_YEARS}
          step={1}
          value={year}
          onChange={(e) => setUI({ fuseYear: Number(e.target.value) })}
          aria-label="Years from new"
        />
      </div>

      {reading.first === null && year >= HORIZON_YEARS && (
        <p className={styles.clear}>
          Nothing goes inside {HORIZON_YEARS} years at this site with this detail.
          That is the whole answer, and it is a good one.
        </p>
      )}

      {shown && (
        <div className={styles.verdict}>
          <div className={styles.walkHead}>
            <span className={styles.count}>{stepIndex + 1} of {states.length}</span>
            <span className={styles.walkHint}>worst first</span>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.dot} style={{ background: RISK_COLOR[shown.level] }} />
              <span className={styles.label}>{shown.label}</span>
              <span className={styles.level} style={{ color: RISK_COLOR[shown.level] }}>
                {RISK_LABEL[shown.level]}
              </span>
            </div>

            <div className={styles.bar}><span style={{ width: `${Math.round(shown.reserve * 100)}%`, background: RISK_COLOR[shown.level] }} /></div>
            <p className={styles.yearLine}>{yearLine}</p>
            <p className={styles.mode}>{shown.mode}</p>
            <p className={styles.wet}>
              Wet {Math.round(shown.wetTime * 100)}% of the year; built to shed {Math.round(shown.wetCapacity * 100)}%.
              {shown.exposed && ' The layer in front of it has already gone.'}
            </p>

            {whyOpen && (
              <div className={styles.why}>
                <p>{shown.why}</p>
                {shown.citation && <p className={styles.cite}>{shown.citation}</p>}
                <p className={styles.fix}>{shown.fix}</p>
              </div>
            )}
          </div>

          <div className={styles.nav}>
            <button className={styles.go} onClick={() => showMe(shown)}>Show me</button>
            <button className={styles.whyBtn} onClick={() => setWhyOpen((w) => !w)}>
              {whyOpen ? 'Hide' : 'Why?'}
            </button>
            <span className={styles.arrows}>
              <button className={styles.arrow} onClick={() => goStep(stepIndex - 1)} disabled={stepIndex === 0} aria-label="Previous layer">‹</button>
              <button className={styles.arrow} onClick={() => goStep(stepIndex + 1)} disabled={stepIndex >= states.length - 1} aria-label="Next layer">›</button>
            </span>
          </div>
        </div>
      )}

      {/* WHAT THE MODEL CANNOT KNOW. Not preferences — each one changes which
          layer fails first, which is why they are worth answering. */}
      <div className={styles.answers}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Site</span>
          <select
            className={styles.select}
            value={site.id}
            onChange={(e) => setUI({ fuseSiteId: e.target.value })}
            aria-label="Site climate"
          >
            {SITES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <p className={styles.blurb}>{site.blurb}</p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Roof covering</span>
          <select
            className={styles.select}
            value={fuseRoofing}
            onChange={(e) => setUI({ fuseRoofing: e.target.value as BuildShape['roofing'] })}
            aria-label="Roof covering"
          >
            {ROOF_COVERINGS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={fuseAtticVentilated}
            onChange={(e) => setUI({ fuseAtticVentilated: e.target.checked })}
          />
          <span>Roof space is vented</span>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={fuseMaintained}
            onChange={(e) => setUI({ fuseMaintained: e.target.checked })}
          />
          <span>Kept painted / sealed on schedule</span>
        </label>
      </div>

      <p className={styles.foot}>
        Estimates from this model and this site: what goes first, and why. Not a
        warranty — the local trade gives you the year.
      </p>
    </div>
  )
}
