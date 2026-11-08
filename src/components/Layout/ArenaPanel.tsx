/**
 * THE ARENA — the load bench, in the rail.
 *
 * F.U.S.E. has two experiments now. The years panel asks what goes first and
 * when; this one asks something a framer can answer with a number today: put
 * this beam on this span, load it, and where do the maker's own figures stop it?
 *
 * The bench is the same one CircuiTry3D and AutoMotive3D run — real branded
 * parts, one shared ramp, F.U.S.E. calling the grade — with the specimen swapped
 * for a beam and the stressor swapped for load. One part, one ramp.
 *
 * THERE IS NO VERSUS RUN, ON PURPOSE. A strength figure is only meaningful on the
 * basis it was tabulated on, and two parts from two documents are not something
 * the bench can rank without becoming a comparison nobody asked the makers to
 * enter. If a framer wants to know which part carries more, they run each one and
 * read its own envelope.
 *
 * TWO LIMITS, KEPT APART. Bending and shear are strength limit states: 1.25D + 1.5L
 * against factored resistance, and only those two can produce a FAILED chip.
 * Sag past L/360 is a serviceability limit on specified load — it gets its own
 * chip that says "OVER L/360" and never the word failed, because nothing has
 * broken. The factor chain the verdict used is printed under the numbers, so the
 * arithmetic can be checked against the report rather than taken on trust.
 *
 * WHAT IT DOES NOT DO YET, AND WHY THAT IS PRINTED RATHER THAN FAKED.
 *
 * A part whose plate is missing a figure does not run. It sits on the roster with
 * the missing field named, which is the honest answer to "why is this maker not
 * on the bench": Nordic's report publishes a layup and a depth limit and no
 * strength values at all. When that plate catches up, the row lights up on its
 * own — nothing in the code is holding it back.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SETUP, PHASE_COLOR, PHASE_LABEL, RAMP_MAX, RAMP_STEP,
  arenaRoster, envelopeLine, envelopeOf, factorNote, isRateable, verdictAt,
  type ArenaSpecimen, type BenchSetup,
} from '../../services/arena'
import styles from './ArenaPanel.module.css'

/** What each basis means, on the card, in the trade's words. */
const BASIS_LABEL: Record<ArenaSpecimen['basis'], string> = {
  'canadian-verified': 'CSA O86',
  'us-reference': 'U.S. ASD',
  insufficient: 'No rating',
}

const pct = (u: number) => (Number.isFinite(u) ? `${(u * 100).toFixed(1)}%` : '—')
const num = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-CA') : '—')

export default function ArenaPanel() {
  const roster = useMemo(() => arenaRoster(), [])
  const [pickedId, setPickedId] = useState<string | null>(() => {
    const first = roster.find(isRateable)
    return first ? first.id : null
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

  const picked = pickedId ? roster.find((s) => s.id === pickedId) ?? null : null
  const running_ = picked && isRateable(picked) ? picked : null
  const verdict = running_ ? verdictAt(running_, setup, multiple) : null

  const pick = (id: string) => {
    setPickedId((cur) => (cur === id ? null : id))
    setMultiple(1)
    setRunning(false)
  }

  const canRun = running_ != null
  const started = multiple > 1

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.mark}>ARENA</span>
        <span className={styles.sub}>Load bench · one ramp · CSA O86</span>
      </div>

      {/* THE ROSTER. Every branded part the bench may run, plus the ones it
          cannot — a maker should be able to see what is stopping them. */}
      <div className={styles.roster}>
        {roster.map((s) => {
          const on = pickedId === s.id
          const rated = isRateable(s)
          return (
            <button
              key={s.id}
              className={`${styles.card} ${on ? styles.cardOn : ''} ${rated ? '' : styles.cardOff}`}
              onClick={() => pick(s.id)}
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

      {verdict && (
        <div className={styles.verdict}>
          <div className={styles.verdictHead}>
            <span className={styles.phase} style={{ color: PHASE_COLOR[verdict.phase], borderColor: PHASE_COLOR[verdict.phase] }}>
              {PHASE_LABEL[verdict.phase]}
            </span>
            {verdict.exceedsL360 && (
              <span className={styles.service}>OVER L/360</span>
            )}
            <span className={styles.gov}>{verdict.mode}</span>
          </div>

          {/* DEMAND BESIDE RESISTANCE — the gap is the lesson, and it is the
              reason this beats reading the datasheet. Bending and shear are
              factored load over factored resistance; the sag is specified load. */}
          <dl className={styles.numbers}>
            <dt>Bending</dt>
            <dd>{num(verdict.demand.bendingPsi)} / {num(verdict.capacity.bendingPsi)} psi · {pct(verdict.utilisation.bending)} of Mr</dd>
            <dt>Shear</dt>
            <dd>{num(verdict.demand.shearLb)} / {num(verdict.capacity.shearLb)} lb · {pct(verdict.utilisation.shear)} of Vr</dd>
            <dt>Sag</dt>
            <dd>{verdict.demand.deflectionIn.toFixed(3)} / {verdict.demand.allowIn.toFixed(3)} in · {pct(verdict.utilisation.deflection)} of L/360</dd>
          </dl>

          <p className={styles.factors}>{factorNote(verdict.capacity.factors)}</p>

          {(verdict.phase !== 'nominal' || verdict.exceedsL360) && (
            <>
              <p className={styles.why}>{verdict.why}</p>
              <p className={styles.fix}>{verdict.fix}</p>
            </>
          )}
        </div>
      )}

      {!canRun && (
        <p className={styles.empty}>
          Nothing on the bench. Pick a part with a rating on it.
        </p>
      )}
    </div>
  )
}
