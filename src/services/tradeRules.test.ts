import { describe, it, expect } from 'vitest'
import {
  wireGaugeForAmps, electricalMountM, plumbingRule, bandForElectrical,
  OUTLET_MAX_SPACING_M, SERVICE_ENTRY, ELECTRICAL_MOUNTS, PLUMBING_FIXTURES,
} from './tradeRules'

const IN = 0.0254

describe('wireGaugeForAmps', () => {
  it('maps standard residential breakers to copper gauge', () => {
    expect(wireGaugeForAmps(15)).toBe('14 AWG')
    expect(wireGaugeForAmps(20)).toBe('12 AWG')
    expect(wireGaugeForAmps(30)).toBe('10 AWG')
    expect(wireGaugeForAmps(50)).toBe('6 AWG')
  })
  it('rounds an in-between amperage UP to the next safe gauge', () => {
    expect(wireGaugeForAmps(16)).toBe('12 AWG') // 16A needs 12 AWG, not 14
    expect(wireGaugeForAmps(1)).toBe('14 AWG')
  })
})

describe('electrical mounts', () => {
  it('gives standard device heights AFF', () => {
    expect(electricalMountM('outlet')).toBeCloseTo(12 * IN, 4)
    expect(electricalMountM('switch')).toBeCloseTo(48 * IN, 4)
    expect(electricalMountM('thermostat')).toBeCloseTo(60 * IN, 4)
  })
  it('is tolerant of naming (spaces/case)', () => {
    expect(electricalMountM('Counter Outlet')).toBeCloseTo(44 * IN, 4)
  })
  it('returns null for an unknown device', () => {
    expect(electricalMountM('flux-capacitor')).toBeNull()
  })
  it('routes switches/outlets in-wall, ceiling fixtures overhead', () => {
    expect(bandForElectrical('switch')).toBe('in-wall')
    expect(bandForElectrical('light')).toBe('ceiling')
    expect(bandForElectrical('unknown')).toBe('in-wall') // safe default
  })
})

describe('plumbing fixtures', () => {
  it('gives rough-in heights + sizes per fixture', () => {
    const wc = plumbingRule('toilet')!
    expect(wc.drainM).toBe(0)      // WC drains at the floor
    expect(wc.drainIn).toBe(3)     // 3" branch
    const lav = plumbingRule('lavatory')!
    expect(lav.drainM).toBeCloseTo(18 * IN, 4)
    expect(lav.drainIn).toBe(1.5)
    expect(lav.supplyIn).toBe(0.5)
  })
  it('kitchen sink sits lower than a bath lav and shares 1/2" supply', () => {
    expect(plumbingRule('kitchen-sink')!.drainM).toBeLessThan(plumbingRule('lavatory')!.drainM)
    expect(plumbingRule('kitchen-sink')!.supplyIn).toBe(0.5)
  })
  it('returns null for an unknown fixture', () => {
    expect(plumbingRule('teleporter')).toBeNull()
  })
})

describe('placement / service rules', () => {
  it('caps outlet spacing at 12 ft (NEC 210.52)', () => {
    expect(OUTLET_MAX_SPACING_M).toBeCloseTo(12 * 12 * IN, 4) // 3.6576 m
  })
  it('plumbing + electrical service enter from outside (under-floor)', () => {
    expect(SERVICE_ENTRY.plumbing.band).toBe('under-floor')
    expect(SERVICE_ENTRY.electrical.band).toBe('under-floor')
    expect(SERVICE_ENTRY.hvac.band).toBe('ceiling')
  })
  it('every mount/fixture rule carries a note (the "why", for the user)', () => {
    for (const r of Object.values(ELECTRICAL_MOUNTS)) expect(r.note.length).toBeGreaterThan(0)
    for (const r of Object.values(PLUMBING_FIXTURES)) expect(r.note.length).toBeGreaterThan(0)
  })
})
