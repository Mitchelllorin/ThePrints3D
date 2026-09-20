/**
 * CorpusPanel — the answer to "what does this app keep about me?", and the
 * button that makes the answer nothing.
 *
 * The corpus has been quietly filling up since it was built: every print that
 * came through, the pixels it was measured from, what the detector read off it,
 * and every correction made against it. All of that was true and none of it was
 * visible. `forgetEverything()` was written into the very first corpus commit on
 * the principle that data you cannot delete is not kept, it is taken — and then
 * nothing ever called it. A delete that is only reachable from the source code
 * is not a delete.
 *
 * So this is deliberately plain. It states the count, it states the weight, it
 * says where the data lives, and it offers the two things a person is entitled
 * to: a copy, and its removal.
 *
 * WHY IT SHOWS THE SPLIT
 * ----------------------
 * "3 prints, 41 corrections, 18 MB" is not the interesting part. The interesting
 * part is that the 41 corrections are permanent and the 18 MB is not: pixels are
 * kept under a budget and the least-corrected print loses its image first. A
 * user who has taught the app something should be able to see that what they
 * taught it is the part being protected.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  corpusStats, listSheets, correctionsForSheet, exportCorpus, forgetEverything,
  type CorpusStats, type CorpusSheet,
} from '../../services/corpus'
import styles from './WorkspaceLayout.module.css'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

/** A sheet plus the one number that decides whether its pixels are safe. */
interface SheetRow {
  sheet: CorpusSheet
  corrections: number
}

/** Every number the panel shows, read in one go so it can be written in one go. */
async function readCorpus(): Promise<{ stats: CorpusStats; rows: SheetRow[] }> {
  const [stats, sheets] = await Promise.all([corpusStats(), listSheets()])
  const rows = await Promise.all(
    sheets.map(async (sheet) => ({
      sheet,
      corrections: (await correctionsForSheet(sheet.id)).length,
    })),
  )
  return { stats, rows }
}

export default function CorpusPanel() {
  const [stats, setStats] = useState<CorpusStats | null>(null)
  const [rows, setRows] = useState<SheetRow[]>([])
  /** Two taps to delete. A `confirm()` would block the whole page. */
  const [armed, setArmed] = useState(false)

  /**
   * READ THE WHOLE PICTURE, THEN WRITE IT ONCE.
   *
   * This used to `setStats` the moment the counts came back and `setRows` a
   * round of IndexedDB reads later, so the panel rendered a corpus size next to
   * an empty sheet list for as long as the corrections took — and every sheet
   * is its own read, so on a laptop with a corpus in it that gap is visible.
   * Both reads finish before either piece of state moves.
   *
   * `alive` is the other half. The reads are asynchronous and the panel is a
   * drawer: close it mid-read and the writes landed on a component that was
   * gone. It also orders two loads racing each other — the mount read and the
   * one `doForget` fires — so the stale one cannot overwrite the fresh one.
   *
   * The read itself is `readCorpus`, outside the component, because it is four
   * database calls and none of them are React's business.
   */
  const refresh = useCallback(() => {
    let alive = true
    void readCorpus().then((next) => {
      if (!alive) return
      setStats(next.stats)
      setRows(next.rows)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => refresh(), [refresh])

  // Arming a delete should not stay armed while somebody thinks about it.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(t)
  }, [armed])

  const doExport = async () => {
    try {
      const json = await exportCorpus()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      a.download = `theprints3d-corpus-${Date.now()}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (e) {
      console.error('Corpus export failed', e)
    }
  }

  const doForget = async () => {
    await forgetEverything()
    setArmed(false)
    refresh()
  }

  if (!stats) return <p className={styles.sectionNote}>Reading…</p>

  return (
    <>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Prints kept</span>
        <span className={styles.settingVal} style={{ width: 'auto', marginLeft: 'auto' }}>{stats.sheets}</span>
      </div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Corrections</span>
        <span className={styles.settingVal} style={{ width: 'auto', marginLeft: 'auto' }}>{stats.corrections}</span>
      </div>
      {/* Deliberately NOT called "images": this number is the raster AND the
          original file the user handed over, and on a real print the file is
          almost all of it. Naming it after the smaller half would hide the
          thing the budget is actually spent on. */}
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Space used</span>
        <span className={styles.settingVal} style={{ width: 'auto', marginLeft: 'auto' }}>
          {mb(stats.bytes)} of {mb(stats.budgetBytes)}
        </span>
      </div>

      <p className={styles.sectionNote}>
        Everything here stays on this device — nothing is uploaded. What you
        corrected is kept for good. Space goes on the drawings themselves, so
        when it runs low the original files go first, then the pictures of the
        prints you corrected least.
      </p>

      {rows.length > 0 && (
        <div style={{ margin: '6px 2px 0' }}>
          {rows.map(({ sheet, corrections }) => (
            <div key={sheet.id} className={styles.settingRow} style={{ padding: '2px 4px' }}>
              <span
                className={styles.settingLabel}
                style={{ width: 'auto', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={sheet.sourceName || sheet.name}
              >
                {sheet.name}
              </span>
              <span className={styles.settingVal} style={{ width: 'auto' }}>
                {corrections > 0 ? `${corrections} taught` : 'untaught'}
                {sheet.raster ? '' : ' · no image'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.specDivider} />
      <button className={styles.specBtn} onClick={doExport} disabled={stats.sheets === 0}>
        Export what's kept
      </button>
      <button
        className={styles.specBtn}
        style={armed ? { color: '#f87171', borderColor: '#f87171' } : undefined}
        onClick={() => (armed ? void doForget() : setArmed(true))}
      >
        {armed ? 'Tap again to erase it all' : 'Forget everything'}
      </button>
    </>
  )
}
