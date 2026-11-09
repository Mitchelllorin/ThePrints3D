/**
 * THE FAILURE CARD — the five things the moment has to say, and nothing else.
 *
 * Part, maker and part number; what failed; the reading it failed at; the limit;
 * and whose number that limit is. It sits on the bottom edge as a transient
 * sheet, never over the part: the sweep has parked the member in the middle
 * third of the frame, and the card is a strip along the foot, so the two cannot
 * meet at any phone height.
 *
 * It stays until it is dismissed, and the isolate stays with it — that is the
 * order's behaviour, not an oversight. Reset is the way back, and it is the same
 * Reset that is on the dashboard, so there is exactly one way the scene is
 * restored and it re-arms the bench at 1×.
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
    <section className={styles.card} role="alert" aria-label="Part failed">
      <div className={styles.top}>
        <span className={styles.chip} style={{ color: BENCH_LEVEL_COLOR.failed, borderColor: BENCH_LEVEL_COLOR.failed }}>
          FAILED
        </span>
        <span className={styles.part}>{b.label}</span>
      </div>

      <p className={styles.maker}>{b.manufacturer} · {b.partNumber}</p>
      <p className={styles.what}>{b.mode}</p>

      <dl className={styles.numbers}>
        <dt>At</dt>
        <dd>
          {fmt(b.reading)} {b.readingUnit} · {b.multiple.toFixed(2)}× · {fmt(b.loadPlf)} plf
          on {b.spanFt} ft
        </dd>
        <dt>Limit</dt>
        <dd>{fmt(b.limit)} {b.readingUnit} — the maker's factored resistance</dd>
      </dl>

      <p className={styles.factors}>{b.factorLine}</p>

      <div className={styles.actions}>
        <button className={styles.dismiss} onClick={dismiss}>Dismiss</button>
        <button className={styles.reset} onClick={reset}>Reset bench</button>
      </div>
    </section>
  )
}
