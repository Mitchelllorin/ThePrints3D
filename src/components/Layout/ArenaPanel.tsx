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
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  RampStrip, battleTicks, breakOrder, defaultSet, randomPart, randomSet, shortLabel,
  type RampState, type RampTick,
} from './ramp-strip/RampStrip'

const MODES = [
  { id: 'solo', label: 'Solo' },
  // Two to five members on the same job; the first to break ends the run.
  { id: 'battle', label: 'Battle' },
]
const SPAN = RAMP_MAX - 1

type Setup = Parameters<typeof verdictAt>[1]

/** Where a member goes past L/360 (sag) and where it breaks, as ramp multiples. */
function scanRamp(spec: ArenaSpecimen, setup: Setup): { sag: number | null; breaks: number | null } {
  let sag: number | null = null
  let breaks: number | null = null
  for (let m = 1; m <= RAMP_MAX + 1e-9 && breaks == null; m += RAMP_STEP) {
    const v = verdictAt(spec, setup, m)
    if (sag == null && v.utilisation.deflection >= 1) sag = m
    if (v.strengthFailed) breaks = m
  }
  return { sag, breaks }
}

/** What each basis means, on the card, in the trade's words. */
const BASIS_LABEL: Record<ArenaSpecimen['basis'], string> = {
  'canadian-verified': 'CSA O86',
  'us-reference': 'U.S. ASD',
  insufficient: 'No rating',
}

const pct = (u: number) => (Number.isFinite(u) ? `${(u * 100).toFixed(0)}%` : '—')
const num = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-CA') : '—')

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
  const rate = useBenchStore((s) => s.rate)
  const runFiled = useBenchStore((s) => s.runFiled)

  const [sheetOpen, setSheetOpen] = useState(false)

  const specimen = specimenId ? roster.find((s) => s.id === specimenId) ?? null : null
  const onBench = specimen && isRateable(specimen) ? specimen : null
  const verdict = onBench ? verdictAt(onBench, setup, multiple) : null

  /** Battle: the line-up, two to five members on this one job. null is Solo. */
  const [lineup, setLineupState] = useState<string[] | null>(null)
  const battle = Array.isArray(lineup) && lineup.length > 1

  /** Every member in play, with where on the track it breaks. */
  const contenders = useMemo(() => {
    if (!battle) return []
    return lineup.map((id) => {
      const spec = roster.find((r) => r.id === id)
      const b = spec && isRateable(spec) ? scanRamp(spec, setup).breaks : null
      return { id, label: spec?.label ?? id, breaksAt: b != null && b > 1 ? (b - 1) / SPAN : null }
    })
  }, [battle, lineup, roster, setup])

  /** Solo: where this member goes past L/360 and where it breaks. Battle: each one's break. */
  const ticks = useMemo<RampTick[]>(() => {
    if (battle) return battleTicks(contenders)
    if (!onBench) return []
    const { sag, breaks } = scanRamp(onBench, setup)
    const out: RampTick[] = []
    if (sag != null && sag > 1) out.push({ at: (sag - 1) / SPAN, kind: 'limit', label: 'L/360' })
    if (breaks != null && breaks > 1) out.push({ at: (breaks - 1) / SPAN, kind: 'break', label: 'breaks' })
    return out
  }, [battle, contenders, onBench, setup])

  /** The card sits on top of the strip, so it needs the strip's height. */
  const reportHeight = useCallback((px: number) => {
    document.documentElement.style.setProperty('--rs-h', `${px}px`)
  }, [])
  useEffect(() => () => {
    document.documentElement.style.removeProperty('--rs-h')
  }, [])

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

  /** Battle: the member expected to go first is the one on the bench. */
  const setLineup = (ids: string[] | null) => {
    setLineupState(ids)
    if (!ids || ids.length < 2) return
    const order = breakOrder(ids.map((id) => {
      const spec = roster.find((r) => r.id === id)
      const b = spec && isRateable(spec) ? scanRamp(spec, setup).breaks : null
      return { id, label: id, breaksAt: b }
    }))
    const go = order[0]?.id
    const s = useBenchStore.getState()
    if (go && go !== s.specimenId) {
      if (s.break) s.dismiss()
      s.setSpecimen(go)
    }
  }

  const presetActive = (p: BenchPreset) =>
    p.specimenId === specimenId && p.setup.spanFt === setup.spanFt

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

  /* ── The strip: the family one (ramp-strip/, canonical in _tools/ramp-strip) ── */

  const state: RampState = breakState
    ? 'failed'
    : running
      ? 'running'
      : holding
        ? 'paused'
        : runFiled && multiple >= RAMP_MAX
          ? 'done'
          : 'idle'
  // Strength is what breaks; sag is the app's serviceability line and never does.
  const level = breakState
    ? 'failed'
    : verdict
      ? benchLevelFor(Math.max(verdict.utilisation.bending, verdict.utilisation.shear))
      : 'safe'
  const plf = (m: number) => num((setup.liveLoadPsf + setup.deadLoadPsf) * setup.spacingFt * m)

  return (
    <RampStrip
      attrs={{ id: 'arena-strip', 'data-testid': 'ramp-strip' }}
      modes={MODES}
      mode={battle ? 'battle' : 'solo'}
      onMode={(id) => setLineup(id === 'solo' ? null : lineup ?? defaultSet(parts, specimenId ?? undefined, 3))}
      parts={parts}
      part={specimenId ?? undefined}
      onPart={(id) => useBenchStore.getState().setSpecimen(id)}
      picked={battle ? lineup : undefined}
      onPicked={battle ? setLineup : undefined}
      onShuffle={() => {
        if (battle) setLineup(randomSet(parts, lineup.length))
        else {
          const id = randomPart(parts, specimenId ?? undefined)
          if (id) useBenchStore.getState().setSpecimen(id)
        }
      }}
      rate={rate}
      onRate={(r) => useBenchStore.getState().setRate(r)}
      value={(multiple - 1) / SPAN}
      onValue={(v) => useBenchStore.getState().setMultiple(1 + v * SPAN)}
      step={RAMP_STEP / SPAN}
      readout={`${multiple.toFixed(2)}× · ${plf(multiple)} plf`}
      level={level}
      ticks={ticks}
      state={state}
      onRun={() => {
        if (breakState) useBenchStore.getState().dismiss()
        // The span may have changed since the line-up was picked, and with it who goes first.
        if (battle) setLineup(lineup)
        startRun()
      }}
      onPause={holdRun}
      onResume={() => {
        clearSurfaces()
        useBenchStore.getState().start()
      }}
      onReset={resetBench}
      result={
        breakState
          ? battle
            ? `${shortLabel(specimen?.label ?? 'Member')} first · ${multiple.toFixed(2)}×`
            : `Broke at ${multiple.toFixed(2)}×`
          : state === 'done'
            ? `Held to ${RAMP_MAX.toFixed(2)}×`
            : null
      }
      onMore={() => setSheetOpen(true)}
      onHeight={reportHeight}
    />
  )
}
