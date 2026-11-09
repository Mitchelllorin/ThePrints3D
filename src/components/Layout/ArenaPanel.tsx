/**
 * THE RAMP — the bench's dashboard, as a strip.
 *
 * The bench used to be a 208 px side column: a scroll of cards, gauges, roster
 * and history standing between the user and the model. That is a page about a
 * beam, not a beam. The order (BREAK-IT §5) is "less panel, more workspace", so
 * what is here now is one glass strip along the bottom edge:
 *
 *   • gauges — the three limits in play, one line of readouts with a 3 px bar
 *     each. Bending and shear are the maker's factored resistance; sag is the
 *     app's L/360 and can never read FAILED.
 *   • presets — one row of chips, each a job proven by a test to break. The
 *     labels say what happens, generically: the maker's name and part number
 *     belong to the part and its failure card, not to a button.
 *   • the ramp — Push, Hold, Reset, and the load slider. Pushing runs the load
 *     up; Hold parks it and counts the seconds carried.
 *   • Parts — everything that is not the moment (span, loads, the roster, the
 *     full check list, your runs and bests) opens as a transient sheet and
 *     closes the instant a run starts. It is the full list behind the three
 *     bars, not a second dashboard.
 *
 * AT THE BREAK THE STRIP GETS OUT OF THE WAY ENTIRELY. The failure card is the
 * strip at its minimum: it carries the run and the two ways back, and the part
 * gets the band the strip was occupying. One surface at the break, never two.
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
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
import styles from './ArenaPanel.module.css'

/** What each basis means, on the card, in the trade's words. */
const BASIS_LABEL: Record<ArenaSpecimen['basis'], string> = {
  'canadian-verified': 'CSA O86',
  'us-reference': 'U.S. ASD',
  insufficient: 'No rating',
}

const pct = (u: number) => (Number.isFinite(u) ? `${(u * 100).toFixed(0)}%` : '—')
const num = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-CA') : '—')

/**
 * One limit, as a single line in the strip: name, utilisation, and a 3 px bar
 * whose mark is the limit. The owner of the number lives in the sheet — on a
 * 360 px phone there is no room for it beside three bars, and the failure card
 * says it in full at the moment it matters.
 */
function MiniGauge({ name, utilisation, service }: {
  name: string
  utilisation: number
  service?: boolean
}) {
  const level = service ? serviceLevelFor(utilisation) : benchLevelFor(utilisation)
  const fill = Math.min(1, Math.max(0, Number.isFinite(utilisation) ? utilisation : 1))
  return (
    <div className={styles.mini}>
      <div className={styles.miniTop}>
        <span className={styles.miniName}>{name}</span>
        <span className={styles.miniPct} style={{ color: BENCH_LEVEL_COLOR[level] }}>{pct(utilisation)}</span>
      </div>
      <div
        className={styles.miniTrack}
        role="meter"
        aria-valuenow={Math.round((Number.isFinite(utilisation) ? utilisation : 1) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name}, ${pct(utilisation)} of the limit`}
      >
        <span className={styles.miniFill} style={{ width: `${fill * 100}%`, background: BENCH_LEVEL_COLOR[level] }} />
        <span className={styles.miniLimit} aria-hidden />
      </div>
    </div>
  )
}

/** One limit in the sheet: the same bar, with the reading, the limit and whose it is. */
function StressRow({ name, utilisation, reading, limit, unit, owner, service }: {
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
    <div className={styles.check}>
      <div className={styles.miniTop}>
        <span className={styles.miniName}>{name}</span>
        <span className={styles.miniPct} style={{ color: BENCH_LEVEL_COLOR[level] }}>{pct(utilisation)}</span>
      </div>
      <div className={styles.miniTrack} aria-hidden>
        <span className={styles.miniFill} style={{ width: `${fill * 100}%`, background: BENCH_LEVEL_COLOR[level] }} />
        <span className={styles.miniLimit} />
      </div>
      <div className={styles.checkFoot}>
        <span>{num(reading)} / {num(limit)} {unit}</span>
        <span className={styles.owner}>{owner}</span>
      </div>
    </div>
  )
}

export default function ArenaPanel() {
  const roster = useMemo(() => arenaRoster(), [])
  const setOpen = useBenchStore((s) => s.setOpen)

  // The bench lives in the scene only while the ramp is open, and closing it
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

  const [sheetOpen, setSheetOpen] = useState(false)

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

  /**
   * A RUN STARTS CLEAN. Any sheet or drawer open over the workspace goes the
   * moment the ramp is pushed — the model is the thing being loaded, and the
   * strip is all the chrome that is allowed to stay.
   */
  const clearSurfaces = () => {
    setSheetOpen(false)
    const fp = useFloorplanLocalStore.getState()
    fp.closeAllPanels()
    fp.setDrawerOpen('place', false)
  }

  const resetBench = () => {
    useBenchStore.getState().reset()
    setTick((t) => t + 1)
  }

  const startRun = () => {
    clearSurfaces()
    const s = useBenchStore.getState()
    if (s.multiple >= RAMP_MAX) s.setMultiple(1)
    if (s.running) s.stop()
    else s.start()
  }

  const holdRun = () => {
    clearSurfaces()
    useBenchStore.getState().hold()
  }

  const applyPreset = (p: BenchPreset) => {
    clearSurfaces()
    useBenchStore.getState().applyPreset(p.specimenId, p.setup)
  }

  const pickPart = (id: string) => {
    const s = useBenchStore.getState()
    s.setSpecimen(s.specimenId === id ? null : id)
  }

  const presetActive = (p: BenchPreset) =>
    p.specimenId === specimenId && p.setup.spanFt === setup.spanFt

  /* ── Broken: the card is the strip at its minimum. Nothing else. ────────── */

  if (breakState) return null

  /* ── The parts sheet — transient, and it leaves when a run starts. ──────── */

  if (sheetOpen) {
    return (
      <section
        id="ramp-sheet"
        data-testid="ramp-sheet"
        className={styles.sheet}
        role="dialog"
        aria-label="The Ramp — parts and settings"
      >
        <div className={styles.sheetHead}>
          <span className={styles.mark}>THE RAMP</span>
          <button className={styles.close} onClick={() => setSheetOpen(false)}>Close</button>
        </div>

        <div className={styles.sheetBody}>
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
            {setup.liveLoadPsf} psf live + {setup.deadLoadPsf} psf dead · {setup.spacingFt} ft tributary
          </p>

          {verdict && (
            <div className={styles.checks}>
              <StressRow
                name="Bending"
                utilisation={verdict.utilisation.bending}
                reading={verdict.demand.bendingPsi}
                limit={verdict.capacity.bendingPsi}
                unit="psi"
                owner="maker's Mr"
              />
              <StressRow
                name="Shear"
                utilisation={verdict.utilisation.shear}
                reading={verdict.demand.shearLb}
                limit={verdict.capacity.shearLb}
                unit="lb"
                owner="maker's Vr"
              />
              <StressRow
                name="Sag"
                utilisation={verdict.utilisation.deflection}
                reading={verdict.demand.deflectionIn}
                limit={verdict.demand.allowIn}
                unit="in"
                owner="app's L/360"
                service
              />
              <div className={styles.verdictLine}>
                <span className={styles.phase} style={{ color: PHASE_COLOR[verdict.phase], borderColor: PHASE_COLOR[verdict.phase] }}>
                  {PHASE_LABEL[verdict.phase]}
                </span>
                <span className={styles.gov}>{verdict.mode}</span>
              </div>
              {verdict.exceedsL360 && <span className={styles.service}>OVER L/360 — springy, not broken</span>}
            </div>
          )}

          {/* THE SPECIMEN. What is on the bench, in catalogue order. */}
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
                  {rated
                    ? <span className={styles.cardLine}>{envelopeLine(envelopeOf(s, setup))}</span>
                    : <span className={styles.cardMissing}>Waiting on the plate: {s.missing.join(', ')}</span>}
                </button>
              )
            })}
          </div>

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
          </div>
        </div>

        <div className={styles.sheetFoot}>
          <button className={styles.push} onClick={startRun} disabled={!onBench} aria-busy={running}>
            {running ? 'Pushing' : 'Push it'}
          </button>
          <button className={`${styles.hold} ${holding ? styles.holdOn : ''}`} onClick={holdRun} disabled={!onBench} aria-pressed={holding}>
            {holding ? `Held ${held.toFixed(1)}s` : 'Hold'}
          </button>
        </div>
      </section>
    )
  }

  /* ── The strip ──────────────────────────────────────────────────────────── */

  return (
    <div id="arena-strip" data-testid="ramp-strip" className={styles.strip}>
      <div className={styles.head}>
        <span className={styles.mark}>THE RAMP</span>
        <span className={styles.rampValue}>
          {multiple.toFixed(2)}× · {num((setup.liveLoadPsf + setup.deadLoadPsf) * setup.spacingFt * multiple)} plf
        </span>
      </div>

      {verdict ? (
        <div className={styles.gauges}>
          <MiniGauge name="Bend" utilisation={verdict.utilisation.bending} />
          <MiniGauge name="Shear" utilisation={verdict.utilisation.shear} />
          <MiniGauge name="Sag" utilisation={verdict.utilisation.deflection} service />
        </div>
      ) : (
        <p className={styles.empty}>Pick a part. Open Parts.</p>
      )}

      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            data-testid="ramp-preset"
            className={`${styles.preset} ${presetActive(p) ? styles.presetOn : ''}`}
            onClick={() => applyPreset(p)}
            title={p.note}
            aria-pressed={presetActive(p)}
          >
            <span className={styles.presetName}>{p.label}</span>
            <span className={styles.presetMeta}>breaks {p.breaks.at.toFixed(2)}× · holds {holdsAt(p).toFixed(2)}×</span>
          </button>
        ))}
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

      <div className={styles.actions}>
        <button
          data-testid="ramp-push"
          className={styles.push}
          onClick={startRun}
          disabled={!onBench}
          aria-busy={running}
        >
          {running ? 'Pushing' : multiple > 1 ? 'More' : 'Push it'}
        </button>
        <button
          className={`${styles.hold} ${holding ? styles.holdOn : ''}`}
          onClick={holdRun}
          disabled={!onBench}
          aria-pressed={holding}
        >
          {holding ? `${held.toFixed(0)}s` : 'Hold'}
        </button>
        <button
          className={styles.parts}
          onClick={() => setSheetOpen(true)}
          aria-expanded={false}
        >
          Parts
        </button>
        <button data-testid="ramp-reset" className={styles.reset} onClick={resetBench}>Reset</button>
      </div>
    </div>
  )
}
