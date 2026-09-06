/**
 * THE RELIABILITY GATE.
 *
 * `score-corpus.mjs` measures. It does not judge, so a run that got worse looks
 * exactly like a run that got better: a table of numbers somebody has to read
 * and remember. That is how a 48% wall loss shipped — the numbers existed, and
 * comparing them by eye against a run from last week was a chore nobody owed.
 *
 * This is the judgement. It holds a committed baseline, re-scores the corpus,
 * and EXITS NONZERO when detection got worse. Improvements are reported and
 * never fail — the gate exists to stop backsliding, not to freeze the engine.
 *
 *   node scripts/corpus-gate.mjs                 # score, compare, pass/fail
 *   node scripts/corpus-gate.mjs --run out.json  # compare a run already scored
 *   node scripts/corpus-gate.mjs --update        # accept current as the baseline
 *
 * Updating the baseline is deliberate and separate, because "the gate is red so
 * change the gate" must be a decision somebody makes on purpose and can be seen
 * making in the diff.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const has = (n) => args.includes(n)

const BASELINE = 'scripts/corpus-baseline.json'

/**
 * HOW MUCH MOVEMENT IS JUST NOISE?
 *
 * Measured, not guessed: two consecutive scoring runs of the same commit moved
 * `walls` on one print of six (85 → 87, 2.4%) and moved `rooms` and `enclosed`
 * on none of them. OCR runs on a time budget, so the room seeding can differ
 * slightly between runs and carry a couple of derived walls with it.
 *
 * So the wall tolerance is 10% — comfortably above the noise floor, and far
 * below the kind of loss this is built to catch. Room and enclosure counts are
 * whole small numbers where one is a real change, so they get a tolerance of
 * one and no more.
 */
const WALL_DROP_TOLERANCE = 0.10
const COUNT_DROP_TOLERANCE = 1

/** Pull the per-print metrics we judge on out of a raw scorer result. */
function metricsOf(result) {
  const named = new Map()
  for (const e of result.events ?? []) {
    // The `stages` event is the one carrying roomsNamed, keyed by drawing id
    // ("score-<print>.pdf"), which is the print name with a wrapper on it.
    if (e.event !== 'stages' || typeof e.roomsNamed !== 'number') continue
    named.set(String(e.drawingId).replace(/^score-/, '').replace(/\.[^.]+$/, ''), e.roomsNamed)
  }
  const out = {}
  for (const r of result.rows ?? []) {
    out[r.print] = {
      walls: r.walls,
      rooms: r.rooms,
      enclosed: r.enclosed,
      roomsNamed: named.get(r.print) ?? 0,
    }
  }
  return out
}

function scoreNow() {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-gate-'))
  const out = join(dir, 'run.json')
  console.log('scoring corpus (several minutes — real PDFs are rasterised) ...\n')
  execFileSync('node', ['scripts/score-corpus.mjs', '--out', out], { stdio: 'inherit' })
  return JSON.parse(readFileSync(out, 'utf8'))
}

const runFile = flag('--run')
const result = runFile ? JSON.parse(readFileSync(runFile, 'utf8')) : scoreNow()
const current = metricsOf(result)

if (has('--update')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
  console.log(`\nbaseline updated: ${BASELINE}`)
  console.log('Commit it, and say in the message WHY the numbers moved.')
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(`\nNo baseline at ${BASELINE}. Create one with --update.`)
  process.exit(2)
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))

const failures = []
const notes = []

for (const [print, base] of Object.entries(baseline)) {
  const now = current[print]
  if (!now) {
    failures.push(`${print}: MISSING from this run — the print was not scored at all`)
    continue
  }

  /**
   * EMPTY IS A FAILURE, NOT A LOW SCORE.
   *
   * A drawing the engine cannot read must still produce a model; handing a
   * tradesperson an empty workspace is the one outcome that is never
   * acceptable. This is an absolute floor, checked regardless of the baseline.
   */
  if (!now.walls) failures.push(`${print}: ZERO walls — detection produced no model`)
  if (!now.rooms) failures.push(`${print}: ZERO rooms — nothing enclosed anything`)

  const wallFloor = Math.floor(base.walls * (1 - WALL_DROP_TOLERANCE))
  if (now.walls < wallFloor) {
    const pct = (((base.walls - now.walls) / base.walls) * 100).toFixed(0)
    failures.push(`${print}: walls ${base.walls} → ${now.walls} (down ${pct}%, floor ${wallFloor})`)
  }
  if (now.enclosed < base.enclosed - COUNT_DROP_TOLERANCE) {
    failures.push(`${print}: enclosed ${base.enclosed} → ${now.enclosed}`)
  }
  /**
   * Naming is held because it was zero everywhere for the life of the project
   * and nobody noticed. A metric that silently returned to zero once can do it
   * again, and the thing it silently disables is tile backer on a wet wall.
   */
  if (now.roomsNamed < base.roomsNamed - COUNT_DROP_TOLERANCE) {
    failures.push(`${print}: roomsNamed ${base.roomsNamed} → ${now.roomsNamed}`)
  } else if (base.roomsNamed > 0 && now.roomsNamed === 0) {
    /**
     * Going to zero is never within tolerance.
     *
     * On a print that named one room, a plain ±1 tolerance would wave through
     * 1 → 0 — a total loss of naming, scored as noise. Zero is the value this
     * metric held for the entire life of the project without anyone noticing,
     * so zero is the one number it is never allowed to quietly return to.
     */
    failures.push(`${print}: roomsNamed ${base.roomsNamed} → 0 — naming lost entirely`)
  }

  const gained = []
  if (now.walls > base.walls) gained.push(`walls +${now.walls - base.walls}`)
  if (now.enclosed > base.enclosed) gained.push(`enclosed +${now.enclosed - base.enclosed}`)
  if (now.roomsNamed > base.roomsNamed) gained.push(`named +${now.roomsNamed - base.roomsNamed}`)
  if (gained.length) notes.push(`${print}: ${gained.join(', ')}`)
}

for (const print of Object.keys(current)) {
  if (!baseline[print]) notes.push(`${print}: NEW print, not yet in the baseline`)
}

console.log('\n' + '─'.repeat(64))
console.table(
  Object.keys({ ...baseline, ...current }).map((print) => {
    const b = baseline[print] ?? {}
    const c = current[print] ?? {}
    const d = (k) => (b[k] === undefined || c[k] === undefined ? '—' : b[k] === c[k] ? `${c[k]}` : `${b[k]} → ${c[k]}`)
    return { print, walls: d('walls'), rooms: d('rooms'), enclosed: d('enclosed'), named: d('roomsNamed') }
  }),
)

if (notes.length) {
  console.log('\nimproved / new:')
  for (const n of notes) console.log(`  + ${n}`)
}

if (failures.length) {
  console.log('\nREGRESSED:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  console.log('\nDetection got worse. Fix it, or update the baseline on purpose.')
  process.exit(1)
}

console.log('\n✓ no regression against the baseline')
