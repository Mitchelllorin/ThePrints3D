import { useMemo, useState } from 'react'
import { estimateMaterials, materialReportToCsv } from '../../services/materialEstimator'
import type { Drawing } from '../../types'
import styles from './Toolbox.module.css'

interface Props {
  drawing: Drawing
}

export default function MaterialReportPanel({ drawing }: Props) {
  const [ceilingHeightFt, setCeilingHeightFt] = useState(9)
  const [studSpacingIn, setStudSpacingIn] = useState<16 | 24>(16)
  const [wasteFactorPct, setWasteFactorPct] = useState(10)
  const [sheetSize, setSheetSize] = useState<'4x8' | '4x12'>('4x8')
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({})

  const report = useMemo(() => {
    if (!drawing.scaleMmPerPx) return null
    return estimateMaterials(drawing.parsedWalls, drawing.scaleMmPerPx, {
      ceilingHeightFt,
      studSpacingIn,
      wasteFactorPct,
      drywallSheetSize: sheetSize,
      itemUnitCosts: unitCosts,
    })
  }, [drawing.parsedWalls, drawing.scaleMmPerPx, ceilingHeightFt, studSpacingIn, wasteFactorPct, sheetSize, unitCosts])

  if (!drawing.scaleMmPerPx || drawing.status !== 'ready') {
    return <p className={styles.warning}>Material estimator requires a processed drawing with calibrated scale.</p>
  }

  if (!report) return null

  const exportCsv = () => {
    const csv = materialReportToCsv(report)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = drawing.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-z0-9-_ ]/gi, '-')
      .trim()
      .replace(/\s+/g, '_')
    a.download = `${safeName || 'drawing'}-material-report.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className={styles.panel}>
      <h3>Material Report · {drawing.name}</h3>
      <div className={styles.grid2}>
        <div className={styles.field}>
          <label>Ceiling height (ft)</label>
          <input className={styles.input} type="number" value={ceilingHeightFt} onChange={(e) => setCeilingHeightFt(Number(e.target.value) || 9)} />
        </div>
        <div className={styles.field}>
          <label>Stud spacing</label>
          <select className={styles.select} value={studSpacingIn} onChange={(e) => setStudSpacingIn(Number(e.target.value) as 16 | 24)}>
            <option value={16}>16" OC</option>
            <option value={24}>24" OC</option>
          </select>
        </div>
        <div className={styles.field}>
          <label>Waste factor (%)</label>
          <input className={styles.input} type="number" value={wasteFactorPct} onChange={(e) => setWasteFactorPct(Number(e.target.value) || 0)} />
        </div>
        <div className={styles.field}>
          <label>Drywall sheet</label>
          <select className={styles.select} value={sheetSize} onChange={(e) => setSheetSize(e.target.value as '4x8' | '4x12')}>
            <option value="4x8">4x8</option>
            <option value="4x12">4x12</option>
          </select>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit Cost</th>
              <th>Estimated</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={item.id}>
                <td>{item.label}</td>
                <td>{item.quantity}</td>
                <td>{item.unit}</td>
                <td>
                  <input
                    className={styles.input}
                    type="number"
                    value={unitCosts[item.id] ?? ''}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setUnitCosts((prev) => ({
                        ...prev,
                        [item.id]: Number.isFinite(n) ? n : 0,
                      }))
                    }}
                    style={{ width: 90 }}
                  />
                </td>
                <td>{typeof item.estimatedCost === 'number' ? `$${item.estimatedCost.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.grid2}>
        <div className={styles.small}>Total wall length: {report.totals.totalWallLengthFt.toFixed(2)} lf</div>
        <div className={styles.small}>Framed: {report.totals.framedWallLengthFt.toFixed(2)} lf · Masonry: {report.totals.masonryWallLengthFt.toFixed(2)} lf</div>
        <div className={styles.cardResult}>Estimated cost: {report.totals.estimatedCost == null ? '—' : `$${report.totals.estimatedCost.toFixed(2)}`}</div>
        <button className={styles.btn} onClick={exportCsv}>⬇ Export CSV</button>
      </div>
    </section>
  )
}
