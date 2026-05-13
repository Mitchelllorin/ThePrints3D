export type ConverterKind = 'length' | 'area' | 'volume' | 'weight' | 'temperature' | 'pressure'

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in' | 'yd'
export type AreaUnit = 'mm2' | 'm2' | 'ft2' | 'yd2'
export type VolumeUnit = 'm3' | 'ft3' | 'yd3'
export type WeightUnit = 'kg' | 'lb'
export type TemperatureUnit = 'c' | 'f'
export type PressureUnit = 'kpa' | 'psi'

export type ConverterUnit = LengthUnit | AreaUnit | VolumeUnit | WeightUnit | TemperatureUnit | PressureUnit

const MM_PER_IN = 25.4
const MM_PER_FT = 304.8
const MM_PER_YD = 914.4
const M2_PER_FT2 = 0.09290304
const M2_PER_YD2 = 0.83612736
const M3_PER_FT3 = 0.028316846592
const M3_PER_YD3 = 0.764554857984
const LB_PER_KG = 2.2046226218
const KPA_PER_PSI = 6.8947572932

export function parseFeetInches(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const normalized = trimmed
    .replace(/\s+/g, ' ')
    .replace('”', '"')
    .replace('“', '"')
    .replace('′', "'")
    .replace('″', '"')

  const full = normalized.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/)
  if (full) {
    const feet = Number(full[1])
    const inches = full[2] ? Number(full[2]) : 0
    if (!Number.isFinite(feet) || !Number.isFinite(inches) || feet < 0 || inches < 0) return null
    return feet * 12 + inches
  }

  const dash = normalized.match(/^(\d+(?:\.\d+)?)\s*[- ]\s*(\d+(?:\.\d+)?)$/)
  if (dash) {
    const feet = Number(dash[1])
    const inches = Number(dash[2])
    if (!Number.isFinite(feet) || !Number.isFinite(inches) || feet < 0 || inches < 0) return null
    return feet * 12 + inches
  }

  const inchesOnly = Number(normalized.replace('"', ''))
  if (Number.isFinite(inchesOnly) && inchesOnly >= 0) return inchesOnly

  return null
}

export function inchesToFeetInches(inches: number): string {
  if (!Number.isFinite(inches)) return '—'
  const safeInches = Math.max(0, inches)
  const feet = Math.floor(safeInches / 12)
  const remainder = safeInches - feet * 12
  const rounded = Math.round(remainder * 16) / 16
  return `${feet}' ${rounded.toFixed(2).replace(/\.00$/, '')}\"`
}

function lengthToMm(value: number, unit: LengthUnit): number {
  switch (unit) {
    case 'mm': return value
    case 'cm': return value * 10
    case 'm': return value * 1000
    case 'in': return value * MM_PER_IN
    case 'ft': return value * MM_PER_FT
    case 'ft-in': return value * MM_PER_IN
    case 'yd': return value * MM_PER_YD
  }
}

function mmToLength(valueMm: number, unit: LengthUnit): number {
  switch (unit) {
    case 'mm': return valueMm
    case 'cm': return valueMm / 10
    case 'm': return valueMm / 1000
    case 'in': return valueMm / MM_PER_IN
    case 'ft': return valueMm / MM_PER_FT
    case 'ft-in': return valueMm / MM_PER_IN
    case 'yd': return valueMm / MM_PER_YD
  }
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return mmToLength(lengthToMm(value, from), to)
}

function areaToM2(value: number, unit: AreaUnit): number {
  switch (unit) {
    case 'mm2': return value / 1_000_000
    case 'm2': return value
    case 'ft2': return value * M2_PER_FT2
    case 'yd2': return value * M2_PER_YD2
  }
}

function m2ToArea(valueM2: number, unit: AreaUnit): number {
  switch (unit) {
    case 'mm2': return valueM2 * 1_000_000
    case 'm2': return valueM2
    case 'ft2': return valueM2 / M2_PER_FT2
    case 'yd2': return valueM2 / M2_PER_YD2
  }
}

export function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  return m2ToArea(areaToM2(value, from), to)
}

function volumeToM3(value: number, unit: VolumeUnit): number {
  switch (unit) {
    case 'm3': return value
    case 'ft3': return value * M3_PER_FT3
    case 'yd3': return value * M3_PER_YD3
  }
}

function m3ToVolume(valueM3: number, unit: VolumeUnit): number {
  switch (unit) {
    case 'm3': return valueM3
    case 'ft3': return valueM3 / M3_PER_FT3
    case 'yd3': return valueM3 / M3_PER_YD3
  }
}

export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit): number {
  return m3ToVolume(volumeToM3(value, from), to)
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value
  return from === 'kg' ? value * LB_PER_KG : value / LB_PER_KG
}

export function convertTemperature(value: number, from: TemperatureUnit, to: TemperatureUnit): number {
  if (from === to) return value
  return from === 'c' ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  if (from === to) return value
  return from === 'kpa' ? value / KPA_PER_PSI : value * KPA_PER_PSI
}

export function convertValue(kind: ConverterKind, value: number, from: ConverterUnit, to: ConverterUnit): number {
  switch (kind) {
    case 'length':
      return convertLength(value, from as LengthUnit, to as LengthUnit)
    case 'area':
      return convertArea(value, from as AreaUnit, to as AreaUnit)
    case 'volume':
      return convertVolume(value, from as VolumeUnit, to as VolumeUnit)
    case 'weight':
      return convertWeight(value, from as WeightUnit, to as WeightUnit)
    case 'temperature':
      return convertTemperature(value, from as TemperatureUnit, to as TemperatureUnit)
    case 'pressure':
      return convertPressure(value, from as PressureUnit, to as PressureUnit)
  }
}
