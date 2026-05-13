import { useMemo, useState } from 'react'
import {
  convertValue,
  inchesToFeetInches,
  parseFeetInches,
  type ConverterKind,
  type ConverterUnit,
} from '../../services/unitConverter'
import styles from './Toolbox.module.css'

const UNIT_OPTIONS: Record<ConverterKind, Array<{ value: ConverterUnit; label: string }>> = {
  length: [
    { value: 'mm', label: 'Millimeters (mm)' },
    { value: 'cm', label: 'Centimeters (cm)' },
    { value: 'm', label: 'Meters (m)' },
    { value: 'in', label: 'Inches (in)' },
    { value: 'ft', label: 'Feet (ft)' },
    { value: 'ft-in', label: 'Feet-Inches (ft-in)' },
    { value: 'yd', label: 'Yards (yd)' },
  ],
  area: [
    { value: 'mm2', label: 'Square millimeters (mm²)' },
    { value: 'm2', label: 'Square meters (m²)' },
    { value: 'ft2', label: 'Square feet (ft²)' },
    { value: 'yd2', label: 'Square yards (yd²)' },
  ],
  volume: [
    { value: 'm3', label: 'Cubic meters (m³)' },
    { value: 'ft3', label: 'Cubic feet (ft³)' },
    { value: 'yd3', label: 'Cubic yards (yd³)' },
  ],
  weight: [
    { value: 'kg', label: 'Kilograms (kg)' },
    { value: 'lb', label: 'Pounds (lb)' },
  ],
  temperature: [
    { value: 'c', label: 'Celsius (°C)' },
    { value: 'f', label: 'Fahrenheit (°F)' },
  ],
  pressure: [
    { value: 'kpa', label: 'kPa' },
    { value: 'psi', label: 'PSI' },
  ],
}

export default function UnitConverter() {
  const [kind, setKind] = useState<ConverterKind>('length')
  const [from, setFrom] = useState<ConverterUnit>('mm')
  const [to, setTo] = useState<ConverterUnit>('ft-in')
  const [input, setInput] = useState('3000')

  const parsedValue = useMemo(() => {
    if (kind === 'length' && from === 'ft-in') return parseFeetInches(input)
    const num = Number(input)
    return Number.isFinite(num) ? num : null
  }, [kind, from, input])

  const output = useMemo(() => {
    if (parsedValue == null) return null
    return convertValue(kind, parsedValue, from, to)
  }, [kind, parsedValue, from, to])

  const outputLabel = useMemo(() => {
    if (output == null) return '—'
    if (kind === 'length' && to === 'ft-in') {
      return `${inchesToFeetInches(output)} (${output.toFixed(2)} in)`
    }
    return output.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }, [kind, output, to])

  return (
    <section className={styles.panel}>
      <h3>Unit Converter</h3>
      <div className={styles.grid2}>
        <div className={styles.field}>
          <label>Category</label>
          <select
            className={styles.select}
            value={kind}
            onChange={(e) => {
              const nextKind = e.target.value as ConverterKind
              setKind(nextKind)
              const first = UNIT_OPTIONS[nextKind][0].value
              setFrom(first)
              setTo(UNIT_OPTIONS[nextKind][1]?.value ?? first)
              setInput('0')
            }}
          >
            <option value="length">Length</option>
            <option value="area">Area</option>
            <option value="volume">Volume</option>
            <option value="weight">Weight</option>
            <option value="temperature">Temperature</option>
            <option value="pressure">Pressure</option>
          </select>
        </div>

        <div className={styles.field}>
          <label>From</label>
          <select className={styles.select} value={from} onChange={(e) => setFrom(e.target.value as ConverterUnit)}>
            {UNIT_OPTIONS[kind].map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label>To</label>
          <select className={styles.select} value={to} onChange={(e) => setTo(e.target.value as ConverterUnit)}>
            {UNIT_OPTIONS[kind].map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label>Input value {from === 'ft-in' ? '(e.g. 10\' 6\")' : ''}</label>
          <input className={styles.input} value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
      </div>

      <div className={styles.result}>
        Result: {outputLabel}
      </div>
    </section>
  )
}
