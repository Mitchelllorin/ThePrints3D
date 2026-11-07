/**
 * THE ARENA — the load bench, in the rail.
 *
 * F.U.S.E. has two experiments now. The years panel asks what goes first and
 * when; this one asks something a framer can answer with a number today: put
 * this beam on this span, load it, and where do the maker's own figures stop it?
 *
 * The bench is the same one CircuiTry3D and AutoMotive3D run — real branded
 * parts, one shared ramp, F.U.S.E. calling the grade — with the specimen swapped
 * for a beam and the stressor swapped for load. Pick one part for a solo run, two
 * for a versus run, and push the load until something lets go.
 *
 * WHAT IT DOES NOT DO YET, AND WHY THAT IS PRINTED RATHER THAN FAKED.
 *
 * A part whose plate is missing a figure does not run. It sits on the roster with
 * the missing field named, which is the honest answer to "why is this maker not
 * on the bench": Nordic's report publishes a layup and a depth limit and no
 * strength values at all, and Parallam's 20" depth needs a depth factor TJ-7001
 * does not print. When those plates catch up, the row lights up on its own —
 * nothing in the code is holding them back.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SETUP, PHASE_COLOR, PHASE_LABEL, RAMP_MAX, RAMP_STEP,
  arenaRoster, duelFor, envelopeLine, envelopeOf, isRateable, verdictAt,
  type ArenaSpecimen, type ArenaVerdict, type BenchSetup,
} from '../../services/arena'
import styles from './ArenaPanel.module.css'

const MAX_PICKED = 2

/** What each basis means, on the card, in the trade's words. */
const BASIS_LABEL: Record<ArenaSpecimen['basis'], string> = {
  'canadian-verified': 'CSA O86',
  'us-reference': 'U.S. ASD',
  insufficient: 'No rating',
}

export default function ArenaPanel() {
  const roster = useMemo(() => arenaRoster(), [])
  const [picked, setPicked] = useState<string[]>(() => {
    const first = roster.find(isRateable)
    return first ? [first.id] : []
  })
  const [setup, setSetup] = useState<BenchSetup>(DEFAULT_SETUP)
  const [multiple, setMultiple] = useState(1)
  const [running, setRunning] = useState(false)

  /** The ramp. A timer at ~12 ticks a second — the rate the family's bench runs
   *  at — and it stops itself at the ceiling rather than spinning forever. */
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      setMultiple((m) => {
        const next = m + RAMP_STEP * 2
        if (next >= RAMP_MAX) {
          setRunning(false)
          return RAMP_MAX
        }
        return next
      })
    }, 90)
    return () => window.clearInterval(id)
  }, [running])

  const pickedSpecs = picked
    .map((id) => roster.find((s) => s.id === id))
    .filter((s): s is ArenaSpecimen => s != null)
  const running_ = pickedSpecs.filter(isRateable)
  const verdicts: ArenaVerdict[] = running_.map((s) => verdictAt(s, setup, multiple))
  const duel = running_.length > 1 ? duelFor(running_, setup) : null
  const winner = duel?.winnerId ? roster.find((s) => s.id === duel.winnerId) : null

  const toggle = (id: string) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      const next = [...cur, id].slice(-MAX_PICKED)
      return next
    })
    setMultiple(1)
    setRunning(false)
  }

  const canRun = running_.length > 0
  const started = multiple > 1

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.mark}>ARENA</span>
        <span className={styles.sub}>Load bench · one ramp</span>
      </div>

      {/* THE ROSTER. Every branded part in the catalogue, including the ones the
          bench cannot run — a maker should be able to see what is stopping them. */}
      <div className={styles.roster}>
        {roster.map((s) => {
          const on = picked.includes(s.id)
          const rated = isRateable(s)
          return (
            <button
              key={s.id}
              className={`${styles.card} ${on ? styles.cardOn : ''} ${rated ? '' : styles.cardOff}`}
              onClick={() => toggle(s.id)}
              aria-pressed={on}
              title={rated ? `${s.label} — ${s.basisNote}` : s.basisNote}
            >
              <span className={styles.cardTop}>
                <span className={styles.cardName}>{s.label}</span>
                <span className={`${styles.chip} ${styles[`chip_${s.basis.replace(/-/g, '_')}`] ?? ''}`}>
                  {BASIS_LABEL[s.basis]}
                </span>
              </span>
              <span className={styles.cardSize}>{s.member.name}</span>
              {rated ? (
                <span className={styles.cardLine}>{envelopeLine(envelopeOf(s, setup))}</span>
              ) : (
                <span className={styles.cardMissing}>Waiting on the plate: {s.missing.join(', ')}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* THE SPAN. The one thing about the job the plate cannot know. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Span <b>{setup.spanFt} ft</b>
        </span>
        <input
          className={styles.range}
          type="range"
          min={6}
          max={24}
          step={1}
          value={setup.spanFt}
          onChange={(e) => { setSetup({ ...setup, spanFt: Number(e.target.value) }); setMultiple(1); setRunning(false) }}
          aria-label="Clear span, feet"
        />
      </label>

      <p className={styles.meta}>
        {setup.liveLoadPsf} psf live + {setup.deadLoadPsf} psf dead, {setup.spacingFt} ft tributary
      </p>

      {/* THE RAMP. Big, because it is the whole control. */}
      <div className={styles.ramp}>
        <div className={styles.rampRow}>
          <span className={styles.rampValue}>{multiple.toFixed(2)}×</span>
          <span className={styles.rampUnit}>{Math.round((setup.liveLoadPsf + setup.deadLoadPsf) * setup.spacingFt * multiple)} plf</span>
          <span className={styles.spacer} />
          <button
            className={styles.push}
            onClick={() => { if (!canRun) return; if (multiple >= RAMP_MAX) setMultiple(1); setRunning(!running) }}
            disabled={!canRun}
            aria-busy={running}
          >
            {running ? 'Pushing' : started ? 'More' : 'Push it'}
          </button>
        </div>
        <input
          className={styles.range}
          type="range"
          min={1}
          max={RAMP_MAX}
          step={RAMP_STEP}
          value={multiple}
          onChange={(e) => { setRunning(false); setMultiple(Number(e.target.value)) }}
          aria-label="Load, multiple of the entered load"
        />
      </div>

      {duel && (
        <p className={styles.duel}>
          {winner
            ? `${winner.label} lasts longest — to ${(duel.entries[0].endurance).toFixed(1)}×`
            : `Level at ${(duel.entries[0].endurance).toFixed(1)}× — neither runs out first.`}
        </p>
      )}

      {verdicts.map((v) => (
        <div key={v.specimen.id} className={styles.verdict}>
          <div className={styles.verdictHead}>
            <span className={styles.phase} style={{ color: PHASE_COLOR[v.phase], borderColor: PHASE_COLOR[v.phase] }}>
              {PHASE_LABEL[v.phase]}
            </span>
            <span className={styles.gov}>{v.mode}</span>
          </div>

          {/* RATED BESIDE ACTUAL — the gap is the lesson, and it is the reason
              this beats reading the datasheet. */}
          <dl className={styles.numbers}>
            <dt>Bending</dt>
            <dd>{Math.round(v.demand.bendingPsi)} / {Math.round(v.capacity.bendingPsi)} psi</dd>
            <dt>Shear</dt>
            <dd>{Math.round(v.demand.shearPsi)} / {Math.round(v.capacity.shearPsi)} psi</dd>
            <dt>Sag</dt>
            <dd>{v.demand.deflectionIn.toFixed(3)} / {v.demand.allowIn.toFixed(3)} in</dd>
          </dl>

          {v.phase !== 'nominal' && (
            <>
              <p className={styles.why}>{v.why}</p>
              <p className={styles.fix}>{v.fix}</p>
            </>
          )}
        </div>
      ))}

      {!canRun && (
        <p className={styles.empty}>
          Nothing on the bench yet. Pick a part with a rating on it.
        </p>
      )}
    </div>
  )
}
