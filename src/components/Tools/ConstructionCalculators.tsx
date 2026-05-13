import { useMemo, useState } from 'react'
import styles from './Toolbox.module.css'

// Roofing "square" is the trade unit for 100 square feet of roof area.
const SQFT_PER_ROOF_SQUARE = 100

function toNumber(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export default function ConstructionCalculators() {
  const [slabLength, setSlabLength] = useState('20')
  const [slabWidth, setSlabWidth] = useState('20')
  const [slabDepthIn, setSlabDepthIn] = useState('4')

  const [paintArea, setPaintArea] = useState('1200')
  const [paintCoverage, setPaintCoverage] = useState('350')

  const [floorArea, setFloorArea] = useState('1800')
  const [floorWastePct, setFloorWastePct] = useState('10')
  const [boxCoverage, setBoxCoverage] = useState('24')

  const [roofArea, setRoofArea] = useState('2000')
  const [roofPitchRise, setRoofPitchRise] = useState('6')

  const [totalRiseIn, setTotalRiseIn] = useState('108')
  const [targetRiserIn, setTargetRiserIn] = useState('7')

  const [spanFt, setSpanFt] = useState('12')
  const [lumber, setLumber] = useState<'2x8' | '2x10' | '2x12'>('2x10')

  const [loadsVA, setLoadsVA] = useState('3000')
  const [voltage, setVoltage] = useState<'120' | '240'>('120')

  const concrete = useMemo(() => {
    const l = toNumber(slabLength)
    const w = toNumber(slabWidth)
    const dIn = toNumber(slabDepthIn)
    const yd3 = (l * w * (dIn / 12)) / 27
    const bags80 = yd3 * 45
    return { yd3, bags80 }
  }, [slabLength, slabWidth, slabDepthIn])

  const paint = useMemo(() => {
    const gallons = toNumber(paintArea) / Math.max(toNumber(paintCoverage), 1)
    return { gallons }
  }, [paintArea, paintCoverage])

  const flooring = useMemo(() => {
    const withWaste = toNumber(floorArea) * (1 + toNumber(floorWastePct) / 100)
    const boxes = withWaste / Math.max(toNumber(boxCoverage), 1)
    return { withWaste, boxes }
  }, [floorArea, floorWastePct, boxCoverage])

  const roofing = useMemo(() => {
    const pitchFactor = Math.sqrt(1 + (toNumber(roofPitchRise) / 12) ** 2)
    const adjusted = toNumber(roofArea) * pitchFactor
    const squares = adjusted / SQFT_PER_ROOF_SQUARE
    return { adjusted, squares }
  }, [roofArea, roofPitchRise])

  const stair = useMemo(() => {
    const rise = Math.max(toNumber(totalRiseIn), 1)
    const target = Math.max(toNumber(targetRiserIn), 1)
    const risers = Math.max(1, Math.round(rise / target))
    const actualRiser = rise / risers
    const treads = Math.max(risers - 1, 1)
    const run = treads * 10
    const stringer = Math.sqrt(rise ** 2 + run ** 2)
    return { risers, actualRiser, run, stringer }
  }, [totalRiseIn, targetRiserIn])

  const beam = useMemo(() => {
    const span = toNumber(spanFt)
    const limits: Record<'2x8' | '2x10' | '2x12', number> = {
      '2x8': 11,
      '2x10': 14,
      '2x12': 17,
    }
    const limit = limits[lumber]
    return { limit, ok: span <= limit }
  }, [spanFt, lumber])

  const electrical = useMemo(() => {
    const current = toNumber(loadsVA) / Math.max(Number(voltage), 1)
    const breaker = current <= 15 ? 15 : current <= 20 ? 20 : current <= 30 ? 30 : Math.ceil(current / 10) * 10
    return { current, breaker }
  }, [loadsVA, voltage])

  return (
    <section className={styles.panel}>
      <h3>Construction Calculators</h3>
      <div className={styles.cards}>
        <article className={styles.card}>
          <h3>Concrete (Slab)</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={slabLength} onChange={(e) => setSlabLength(e.target.value)} placeholder="Length (ft)" />
            <input className={styles.input} value={slabWidth} onChange={(e) => setSlabWidth(e.target.value)} placeholder="Width (ft)" />
            <input className={styles.input} value={slabDepthIn} onChange={(e) => setSlabDepthIn(e.target.value)} placeholder="Depth (in)" />
          </div>
          <p className={styles.cardResult}>{concrete.yd3.toFixed(2)} yd³ · {Math.ceil(concrete.bags80)} bags (80 lb)</p>
        </article>

        <article className={styles.card}>
          <h3>Paint Coverage</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={paintArea} onChange={(e) => setPaintArea(e.target.value)} placeholder="Wall area (sqft)" />
            <input className={styles.input} value={paintCoverage} onChange={(e) => setPaintCoverage(e.target.value)} placeholder="Coverage/gal" />
          </div>
          <p className={styles.cardResult}>{paint.gallons.toFixed(2)} gallons</p>
        </article>

        <article className={styles.card}>
          <h3>Flooring</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={floorArea} onChange={(e) => setFloorArea(e.target.value)} placeholder="Room area (sqft)" />
            <input className={styles.input} value={floorWastePct} onChange={(e) => setFloorWastePct(e.target.value)} placeholder="Waste %" />
            <input className={styles.input} value={boxCoverage} onChange={(e) => setBoxCoverage(e.target.value)} placeholder="Coverage/box" />
          </div>
          <p className={styles.cardResult}>{flooring.withWaste.toFixed(1)} sqft · {Math.ceil(flooring.boxes)} boxes</p>
        </article>

        <article className={styles.card}>
          <h3>Roofing</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={roofArea} onChange={(e) => setRoofArea(e.target.value)} placeholder="Footprint area (sqft)" />
            <input className={styles.input} value={roofPitchRise} onChange={(e) => setRoofPitchRise(e.target.value)} placeholder="Pitch rise (X in 12)" />
          </div>
          <p className={styles.cardResult}>{roofing.adjusted.toFixed(1)} sqft · {roofing.squares.toFixed(2)} squares</p>
        </article>

        <article className={styles.card}>
          <h3>Stair</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={totalRiseIn} onChange={(e) => setTotalRiseIn(e.target.value)} placeholder="Total rise (in)" />
            <input className={styles.input} value={targetRiserIn} onChange={(e) => setTargetRiserIn(e.target.value)} placeholder="Target riser (in)" />
          </div>
          <p className={styles.cardResult}>{stair.risers} risers · {stair.actualRiser.toFixed(2)}" each · stringer {stair.stringer.toFixed(1)}"</p>
        </article>

        <article className={styles.card}>
          <h3>Beam Span Check</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={spanFt} onChange={(e) => setSpanFt(e.target.value)} placeholder="Span (ft)" />
            <select className={styles.select} value={lumber} onChange={(e) => setLumber(e.target.value as '2x8' | '2x10' | '2x12')}>
              <option value="2x8">2x8</option>
              <option value="2x10">2x10</option>
              <option value="2x12">2x12</option>
            </select>
          </div>
          <p className={styles.cardResult}>{beam.ok ? 'Likely OK' : 'Over span'} (rule-of-thumb limit: {beam.limit} ft)</p>
          <p className={styles.small}>Use local code/engineer final sizing.</p>
        </article>

        <article className={styles.card}>
          <h3>Electrical Load</h3>
          <div className={styles.grid2}>
            <input className={styles.input} value={loadsVA} onChange={(e) => setLoadsVA(e.target.value)} placeholder="Connected load (VA)" />
            <select className={styles.select} value={voltage} onChange={(e) => setVoltage(e.target.value as '120' | '240')}>
              <option value="120">120V</option>
              <option value="240">240V</option>
            </select>
          </div>
          <p className={styles.cardResult}>{electrical.current.toFixed(1)} A · suggest {electrical.breaker}A breaker</p>
        </article>
      </div>
    </section>
  )
}
