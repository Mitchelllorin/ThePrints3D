/**
 * THE ARENA — Break It, first.
 *
 * The bench used to be a read-out: pick a part, push the load, read where the
 * maker's numbers stop it. That is still here underneath, but the thing the app
 * is now for is the break itself — so the panel opens on the dashboard that
 * drives it, and the roster moved down the column to being a choice about the
 * specimen rather than the point of the screen.
 *
 * WHAT IS ON THE DASHBOARD, and why each is where it is:
 *
 *   • Presets at the top. One tap arms a job that is proven to break — the
 *     Parallam on 24 ft first. They are the fastest route to the product's one
 *     real moment, and they are data with a test behind them (`benchPresets`),
 *     so a preset that stops breaking fails the build instead of quietly
 *     becoming a demo of nothing.
 *   • The ramp: Push, Hold, Reset. Push runs the load up; Hold parks it and
 *     counts the seconds it has carried — load duration is what KD is about,
 *     and it is honest to show the time without pretending to model creep.
 *   • A gauge per check, in the five F.U.S.E. bands, each with its limit marked
 *     and labelled with whose number it is. Bending and shear are the maker's
 *     factored resistance; the sag limit is the app's L/360 and says so, and it
 *     can never read FAILED.
 *   • Your breaks, read from the spine. Runs and per-part personal bests, in
 *     catalogue order — never a ranking between makers.
 *
 * THE PANEL GETS OUT OF THE WAY WHEN IT BREAKS. The failure card owns the foot
 * of the screen and the part owns the middle. Two surfaces competing for the
 * same pixels is the overlap bug the family rules are about, so on a break this
 * column collapses to a strip with the one control that matters — Reset.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BENCH_LEVEL_COLOR, PHASE_COLOR, PHASE_LABEL, PRESETS, RAMP_MAX, RAMP_STEP,
  arenaRoster, benchLevelFor, breakFor, envelopeLine, envelopeOf, holdsAt, isRateable,
  personalBests, readRuns, recordBenchRun, runWhen, serviceLevelFor, verdictAt,
  type ArenaSpecimen, type BenchPreset,
} from '../../services/arena'
import { loadLog } from '../../lib/fuseRecord'
import { useBenchStore } from '../../store/useBenchStore'
import styles from './ArenaPanel.module.css'

/** What each basis means, on the card, in the trade's words. */
const BASIS_LABEL: Record<ArenaSpecimen['basis'], string> = {
  'canadian-verified': 'CSA O86',
  'us-reference': 'U.S. ASD',
  insufficient: 'No rating',
}

const pct = (u: number) => (Number.isFinite(u) ? `${(u * 100).toFixed(1)}%` : '—')
const num = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-CA') : '—')

/**
 * One check's stress bar.
 *
 * The fill is the utilisation, capped at the limit mark; the mark is at the
 * limit, not at the end of the bar, so a member past its resistance reads as
 * past the line rather than as a full bar. The owner line under it is the part
 * that keeps this honest: the maker's number for a strength limit, the app's own
 * L/360 for sag.
 */
function StressBar({ name, utilisation, reading, limit, unit, owner, service }: {
  name: string
  utilisation: number
  reading: number
  limit: number
  unit: string
  owner: string
  service?: boolean
}) {
  const level = service ? serviceLevelFor(utilisation) : benchLevelFor(utilisation)
  const fill = Math.min(1, Math.max(0, Number.isFinite(utilisation) ? utilisation : 1))
  return (
    <div className={styles.gauge}>
      <div className={styles.gaugeTop}>
        <span className={styles.gaugeName}>{name}</span>
        <span className={styles.gaugePct} style={{ color: BENCH_LEVEL_COLOR[level] }}>{pct(utilisation)}</span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-valuenow={Math.round((Number.isFinite(utilisation) ? utilisation : 1) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name}, ${pct(utilisation)} of the limit`}
      >
        <span className={styles.fill} style={{ width: `${fill * 100}%`, background: BENCH_LEVEL_COLOR[level] }} />
        <span className={styles.limitMark} aria-hidden />
      </div>
      <div className={styles.gaugeFoot}>
        <span>{num(reading)} / {num(limit)} {unit}</span>
        <span className={styles.owner}>{owner}</span>
      </div>
    </div>
  )
}

export default function ArenaPanel() {
  const roster = useMemo(() => arenaRoster(), [])
  const setOpen = useBenchStore((s) => s.setOpen)

  // The bench lives in the scene only while the arena is open, and closing it
  // is a reset — the alternative is a beam hovering over somebody's plan.
  useEffect(() => {
    setOpen(true)
    return () => {
      const s = useBenchStore.getState()
      s.reset()
      s.setOpen(false)
    }
  }, [setOpen])

  const specimenId = useBenchStore((s) => s.specimenId)
  const setup = useBenchStore((s) => s.setup)
  const multiple = useBenchStore((s) => s.multiple)
  const running = useBenchStore((s) => s.running)
  const holding = useBenchStore((s) => s.holding)
  const holdStartedAt = useBenchStore((s) => s.holdStartedAt)
  const breakState = useBenchStore((s) => s.break)

  const specimen = specimenId ? roster.find((s) => s.id === specimenId) ?? null : null
  const onBench = specimen && isRateable(specimen) ? specimen : null
  const verdict = onBench ? verdictAt(onBench, setup, multiple) : null

  /** The ramp: ~11 ticks a second, the rate the family's bench runs at. */
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => useBenchStore.getState().push(), 90)
    return () => window.clearInterval(id)
  }, [running])

  /** Hold: the member carries the load while the clock runs. */
  const [held, setHeld] = useState(0)
  useEffect(() => {
    if (!holding || holdStartedAt == null) { setHeld(0); return }
    const id = window.setInterval(() => setHeld((Date.now() - holdStartedAt) / 1000), 100)
    return () => window.clearInterval(id)
  }, [holding, holdStartedAt])

  /** The log, re-read whenever a run is filed. */
  const [tick, setTick] = useState(0)
  const log = useMemo(() => loadLog(typeof window === 'undefined' ? null : window.localStorage), [tick])
  const runs = useMemo(() => readRuns(typeof window === 'undefined' ? null : window.localStorage), [tick])
  const parts = useMemo(
    () => roster.filter(isRateable).map((s) => ({ id: s.id, label: s.label })),
    [roster],
  )
  const bests = useMemo(() => personalBests(log, parts), [log, parts])

  /**
   * THE MOMENT. Reaching factored resistance files the run, isolates the part
   * and parks the ramp — once, guarded by `breakState`, because this effect
   * re-runs on every ramp tick until the break lands.
   */
  useEffect(() => {
    if (!verdict || breakState) return
    if (!verdict.strengthFailed) return
    const b = breakFor(verdict)
    if (!b) return
    useBenchStore.getState().fail(b)
    if (typeof window !== 'undefined') recordBenchRun(window.localStorage, b)
    setTick((t) => t + 1)
  }, [verdict, breakState])

  const resetBench = () => {
    useBenchStore.getState().reset()
    setTick((t) => t + 1)
  }

  const applyPreset = (p: BenchPreset) => {
    useBenchStore.getState().applyPreset(p.specimenId, p.setup)
  }

  const pickPart = (id: string) => {
    const s = useBenchStore.getState()
    s.setSpecimen(s.specimenId === id ? null : id)
  }

  const presetActive = (p: BenchPreset) =>
    p.specimenId === specimenId && p.setup.spanFt === setup.spanFt

  /* ── Broken: the card owns the foot, this column says how to run again ─── */

  if (breakState) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.mark}>BREAK IT</span>
          <span className={styles.sub}>run filed</span>
        </div>
        <p className={styles.brokenLine}>
          {breakState.label} broke at {breakState.multiple.toFixed(2)}×.
        </p>
        <button className={styles.reset} onClick={resetBench}>Reset bench</button>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.mark}>BREAK IT</span>
        <span className={styles.sub}>load bench · CSA O86</span>
      </div>

      {/* THE PRESETS. Each is a proven break, and says where it happens. */}
      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`${styles.preset} ${presetActive(p) ? styles.presetOn : ''}`}
            onClick={() => applyPreset(p)}
            title={p.note}
            aria-pressed={presetActive(p)}
          >
            <span className={styles.presetName}>{p.label}</span>
            <span className={styles.presetMeta}>breaks at {p.breaks.at.toFixed(2)}× · holds {holdsAt(p).toFixed(2)}×</span>
          </button>
        ))}
      </div>

      {/* THE RAMP. Big, because it is the whole control. */}
      <div className={styles.ramp}>
        <div className={styles.rampRow}>
          <span className={styles.rampValue}>{multiple.toFixed(2)}×</span>
          <span className={styles.rampUnit}>
            {Math.round((setup.liveLoadPsf + setup.deadLoadPsf) * setup.spacingFt * multiple)} plf
          </span>
        </div>
        {/* The gauge for the factor BEING RAMPED — the load itself, against the
            ceiling of its own ramp. Not a strength band: 4× is not a limit the
            beam has, it is the end of the dial, and colouring it red would say
            otherwise. */}
        <div className={styles.rampMeter} aria-hidden>
          <span
            className={styles.rampFill}
            style={{ width: `${((multiple - 1) / (RAMP_MAX - 1)) * 100}%` }}
          />
        </div>
        <input
          className={styles.range}
          type="range"
          min={1}
          max={RAMP_MAX}
          step={RAMP_STEP}
          value={multiple}
          onChange={(e) => useBenchStore.getState().setMultiple(Number(e.target.value))}
          aria-label="Load, multiple of the entered load"
        />
        <div className={styles.buttons}>
          <button
            className={styles.push}
            onClick={() => {
              const s = useBenchStore.getState()
              if (s.multiple >= RAMP_MAX) s.setMultiple(1)
              if (s.running) s.stop()
              else s.start()
            }}
            disabled={!onBench}
            aria-busy={running}
          >
            {running ? 'Pushing' : multiple > 1 ? 'More' : 'Push it'}
          </button>
          <button
            className={`${styles.hold} ${holding ? styles.holdOn : ''}`}
            onClick={() => useBenchStore.getState().hold()}
            disabled={!onBench}
            aria-pressed={holding}
          >
            {holding ? `Held ${held.toFixed(1)}s` : 'Hold'}
          </button>
          <button className={styles.reset} onClick={resetBench}>Reset</button>
        </div>
      </div>

      {/* THE GAUGES. Every check in play, its limit marked and owned. */}
      {verdict && (
        <div className={styles.gauges}>
          <StressBar
            name="Bending"
            utilisation={verdict.utilisation.bending}
            reading={verdict.demand.bendingPsi}
            limit={verdict.capacity.bendingPsi}
            unit="psi"
            owner="maker's Mr"
          />
          <StressBar
            name="Shear"
            utilisation={verdict.utilisation.shear}
            reading={verdict.demand.shearLb}
            limit={verdict.capacity.shearLb}
            unit="lb"
            owner="maker's Vr"
          />
          <StressBar
            name="Sag"
            utilisation={verdict.utilisation.deflection}
            reading={verdict.demand.deflectionIn}
            limit={verdict.demand.allowIn}
            unit="in"
            owner="app's L/360"
            service
          />
          {verdict.exceedsL360 && <span className={styles.service}>OVER L/360 — springy, not broken</span>}
        </div>
      )}

      {/* THE JOB. Span is the one thing about a build the plate cannot know. */}
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
          onChange={(e) => useBenchStore.getState().setSetup({ spanFt: Number(e.target.value) })}
          aria-label="Clear span, feet"
        />
      </label>
      <p className={styles.meta}>
        {setup.liveLoadPsf} psf live + {setup.deadLoadPsf} psf dead, {setup.spacingFt} ft tributary
      </p>

      {/* THE SPECIMEN. Down the column, because picking the part is not the job. */}
      <div className={styles.roster}>
        {roster.map((s) => {
          const on = specimenId === s.id
          const rated = isRateable(s)
          return (
            <button
              key={s.id}
              className={`${styles.card} ${on ? styles.cardOn : ''} ${rated ? '' : styles.cardOff}`}
              onClick={() => rated && pickPart(s.id)}
              disabled={!rated}
              aria-pressed={on}
              title={rated ? `${s.label} — ${s.basisNote}` : s.basisNote}
            >
              <span className={styles.cardTop}>
                <span className={styles.cardName}>{s.label}</span>
                <span className={`${styles.chip} ${styles[`chip_${s.basis.replace(/-/g, '_')}`] ?? ''}`}>
                  {BASIS_LABEL[s.basis]}
                </span>
              </span>
              {rated ? (
                <span className={styles.cardLine}>{envelopeLine(envelopeOf(s, setup))}</span>
              ) : (
                <span className={styles.cardMissing}>Waiting on the plate: {s.missing.join(', ')}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* THE VERDICT, while it stands. */}
      {verdict && (
        <div className={styles.verdict}>
          <div className={styles.verdictHead}>
            <span className={styles.phase} style={{ color: PHASE_COLOR[verdict.phase], borderColor: PHASE_COLOR[verdict.phase] }}>
              {PHASE_LABEL[verdict.phase]}
            </span>
            <span className={styles.gov}>{verdict.mode}</span>
          </div>
          {verdict.phase !== 'nominal' && <p className={styles.why}>{verdict.why}</p>}
          <p className={styles.factors}>{`φ 0.90 · KD 1.00 · KH 1.00 · KS 1.00 · KT 1.00 · KL 1.00 · depth ×${verdict.capacity.factors.depth.toFixed(4)}`}</p>
        </div>
      )}

      {!onBench && (
        <p className={styles.empty}>Nothing on the bench. Pick a part with a rating on it.</p>
      )}

      {/* THE LEADERBOARD — device only, read off the spine, per part. */}
      <div className={styles.section}>
        <span className={styles.sectionHead}>Your breaks</span>
        {runs.length === 0 ? (
          <p className={styles.empty}>No runs yet. Push one until it breaks.</p>
        ) : (
          <ul className={styles.runs}>
            {runs.slice(0, 5).map((r) => (
              <li key={r.id} className={styles.run}>
                <span className={styles.runName}>{r.label}</span>
                <span className={styles.runMeta}>
                  {r.multiple.toFixed(2)}× · {num(r.loadPlf)} plf · {r.spanFt} ft
                </span>
                <span className={styles.runWhen}>{runWhen(r.at)}</span>
              </li>
            ))}
          </ul>
        )}

        <span className={styles.sectionHead}>Personal bests</span>
        <ul className={styles.pbs}>
          {bests.map((b) => (
            <li key={b.specimenId} className={styles.pb}>
              <span className={styles.pbLabel}>{b.label}</span>
              <span className={styles.pbValue}>
                {b.best ? `${num(b.best.loadPlf)} plf · ${b.best.spanFt} ft` : '—'}
              </span>
              <span className={styles.pbCount}>{b.breaks} run{b.breaks === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
        <p className={styles.pbNote}>
          Best is the heaviest load broken on that member, with the span it was on. Each part
          keeps its own — the bench does not rank one maker against another.
        </p>
      </div>
    </div>
  )
}

