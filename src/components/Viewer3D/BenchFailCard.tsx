/**
 * THE FAILURE CARD — the five things the moment has to say, and nothing else.
 *
 * Part, maker and part number; what failed; the reading it failed at; the limit;
 * and whose number that limit is. It sits on the bottom edge as a transient
 * sheet, never over the part: the sweep has parked the member in the middle of
 * the band the card leaves free, and the card is a strip along the foot, so the
 * two cannot meet at any phone height.
 *
 * THE FACTOR CHAIN MOVED TO THE REPORT. It was a line of small print on the
 * card; the card's job is the moment, and every line it adds pushes the part's
 * band up. The factors are listed in docs/arena-report.md, where Mitchell
 * checks them.
 *
 * It stays until dismissed, and the isolate stays with it — that is the order's
 * behaviour, not an oversight. Reset is the way back, and it is the same Reset
 * the bench had, so there is exactly one way the scene is restored and it
 * re-arms the ramp at 1×.
 */
import { BENCH_LEVEL_COLOR } from '../../services/arena/bench'
import { useBenchStore } from '../../store/useBenchStore'
import styles from './BenchFailCard.module.css'

const fmt = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-CA') : '—'

export default function BenchFailCard() {
  const b = useBenchStore((s) => s.break)
  const dismiss = useBenchStore((s) => s.dismiss)
  const reset = useBenchStore((s) => s.reset)
  if (!b) return null

  return (
    <section
      id="bench-fail-card"
      data-testid="bench-fail-card"
      className={styles.card}
      role="alert"
      aria-label="Part failed"
    >
      <div className={styles.top}>
        <span
          className={styles.chip}
          style={{ color: BENCH_LEVEL_COLOR.failed, borderColor: BENCH_LEVEL_COLOR.failed }}
        >
          FAILED
        </span>
        <span className={styles.part}>{b.label}</span>
      </div>

      <p className={styles.line}>{b.manufacturer} · {b.partNumber}</p>
      <p className={styles.what}>{b.mode}</p>

      <dl className={styles.numbers}>
        <dt>At</dt>
        <dd>{fmt(b.reading)} {b.readingUnit} · {b.multiple.toFixed(2)}× · {fmt(b.loadPlf)} plf · {b.spanFt} ft</dd>
        <dt>Limit</dt>
        <dd>{fmt(b.limit)} {b.readingUnit} — the maker&rsquo;s factored resistance</dd>
      </dl>

      <div className={styles.actions}>
        <button className={styles.dismiss} onClick={dismiss}>Dismiss</button>
        <button className={styles.reset} onClick={reset}>Reset bench</button>
      </div>
    </section>
  )
}
