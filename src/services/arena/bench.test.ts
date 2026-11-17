import { describe, expect, it } from 'vitest'
import {
  BENCH_FILL, BENCH_SWEEP_SECONDS, BENCH_Y, PRESETS, benchLevelFor, benchPose, breakFor,
  benchViewOffsetPx, benchViewOffsets, easeInOut, envelopeOf, holdsAt, presetBreakVerdict,
  projectBenchBox, serviceLevelFor,
  specimenForPreset, verdictAt,
} from './index'
import { benchRecordInput, personalBests, readRuns, recordBenchRun, runsFrom } from './index'
import { loadLog, record } from '../../lib/fuseRecord'

/** A device's local storage, in memory. The spine takes anything with two methods. */
function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size },
  } as Storage
}

const PARALLAM = PRESETS[0]
const WEST_FRASER = PRESETS[1]

describe('the presets', () => {
  it('breaks the Parallam on 24 ft at 3.55×, and holds at 3.50×', () => {
    const s = specimenForPreset(PARALLAM)
    expect(s).not.toBeNull()
    expect(PARALLAM.specimenId).toBe('weyerhaeuser-parallam-2_2e-3_1_2x19')
    expect(PARALLAM.setup.spanFt).toBe(24)

    const env = envelopeOf(s!, PARALLAM.setup)
    expect(env.failedAt).toBeCloseTo(3.55, 10)
    expect(PARALLAM.breaks.at).toBe(3.55)

    // The step under the break is a real hold, not a rounding artefact.
    const under = verdictAt(s!, PARALLAM.setup, holdsAt(PARALLAM))
    expect(holdsAt(PARALLAM)).toBe(3.5)
    expect(under.strengthFailed).toBe(false)
    expect(under.utilisation.bending).toBeLessThan(1)

    const at = verdictAt(s!, PARALLAM.setup, PARALLAM.breaks.at)
    expect(at.strengthFailed).toBe(true)
    expect(at.strengthGoverning).toBe('bending')
  })

  it('every preset breaks where it claims, in the limit it claims', () => {
    for (const p of PRESETS) {
      const s = specimenForPreset(p)
      expect(s, p.id).not.toBeNull()
      const at = verdictAt(s!, p.setup, p.breaks.at)
      expect(at.strengthFailed, p.id).toBe(true)
      expect(at.strengthGoverning, p.id).toBe(p.breaks.check)
      // …and one ramp step earlier it does not.
      const under = verdictAt(s!, p.setup, holdsAt(p))
      expect(under.strengthFailed, p.id).toBe(false)
    }
  })

  it('isolates the part that broke, hides the rest and shows the card', () => {
    const v = presetBreakVerdict(PARALLAM)!
    const b = breakFor(v)!
    expect(b.isolate).toEqual({
      target: PARALLAM.specimenId,
      hideOthers: true,
      card: true,
    })
    expect(b.check).toBe('bending')
    expect(b.reading).toBeCloseTo(v.demand.bendingPsi, 10)
    expect(b.limit).toBeCloseTo(v.capacity.bendingPsi, 10)
    expect(b.reading / b.limit).toBeGreaterThanOrEqual(1)
    expect(b.limitOwner).toBe('maker')
    expect(b.multiple).toBe(3.55)
    expect(b.spanFt).toBe(24)
    expect(b.loadPlf).toBeGreaterThan(0)
    expect(b.factorLine).toMatch(/φ 0\.90/)
  })

  it('gives the camera exactly ONE part to land on, per preset', () => {
    for (const p of PRESETS) {
      const b = breakFor(presetBreakVerdict(p)!)!
      expect(b.isolate.target, p.id).toBe(p.specimenId)
      expect(b.isolate.hideOthers, p.id).toBe(true)
      expect(b.isolate.card, p.id).toBe(true)
    }
  })

  it('never hands the camera a failure for sag past L/360', () => {
    const s = specimenForPreset(PARALLAM)!
    const sagging = verdictAt(s, PARALLAM.setup, 2.2)
    expect(sagging.exceedsL360).toBe(true)
    expect(sagging.strengthFailed).toBe(false)
    expect(breakFor(sagging)).toBeNull()
  })

  it('has five levels, and never lets a serviceability limit read as failed', () => {
    expect(benchLevelFor(0.2)).toBe('safe')
    expect(benchLevelFor(0.45)).toBe('stressed')
    expect(benchLevelFor(0.7)).toBe('warning')
    expect(benchLevelFor(0.9)).toBe('critical')
    expect(benchLevelFor(1)).toBe('failed')
    // A beam at 2.4× its L/360 is bouncy, not broken.
    expect(serviceLevelFor(2.4)).toBe('critical')
  })
})

describe('the sweep', () => {
  it('frames the beam in the middle third at portrait, landscape and square', () => {
    const len = 24 * 0.3048
    for (const aspect of [360 / 640, 640 / 360, 1]) {
      const pose = benchPose([0, 1.35, 0], len, aspect)
      const d = Math.hypot(
        pose.position[0] - pose.target[0],
        pose.position[1] - pose.target[1],
        pose.position[2] - pose.target[2],
      )
      const hHalf = Math.atan(Math.tan((55 * Math.PI) / 360) * aspect)
      const fill = len / (2 * d * Math.tan(hHalf))
      expect(fill).toBeCloseTo(BENCH_FILL, 10)
      expect(pose.target).toEqual([0, 1.35, 0])
    }
  })

  it('lands the part centred in the canvas left above the chrome, at about BENCH_FILL', () => {
    // Section 4 of BREAK-IT, as pixels: at the end of the sweep the part's own
    // box must sit in the middle of the VISIBLE band and span about a third of
    // it — not the centre of a viewport whose foot is covered.
    const beam = { lengthM: 24 * 0.3048, depthM: 3.5 * 0.0254, widthM: 1.75 * 0.0254 }
    const cases: Array<[number, number, number]> = [
      [360, 640, 178],   // portrait, strip up
      [360, 640, 236],   // portrait, card up
      [640, 360, 150],   // landscape
      [700, 700, 0],     // square, no chrome
    ]
    for (const [W, H, chrome] of cases) {
      const pose = benchPose([0, BENCH_Y, 0], beam.lengthM, W / H)
      const off = benchViewOffsets(pose, beam, { widthPx: W, heightPx: H, chromeBottomPx: chrome })
      const box = projectBenchBox(pose, beam, {
        widthPx: W, heightPx: H, offsetXPx: off.x, offsetYPx: off.y,
      })
      const visibleH = H - chrome
      // Solved from the box, so the box is where it was asked to be.
      expect(Math.abs(box.cx - W / 2)).toBeLessThan(0.5)
      expect(Math.abs(box.cy - visibleH / 2)).toBeLessThan(0.5)
      // Close in: about BENCH_FILL of the width — a long thin member is framed on its length.
      expect(box.width).toBeGreaterThan(W * BENCH_FILL * 0.75)
      expect(box.width).toBeLessThan(W * BENCH_FILL * 1.25)
      // And wholly inside the visible band, clear of the chrome.
      expect(box.left).toBeGreaterThanOrEqual(-0.5)
      expect(box.right).toBeLessThanOrEqual(W + 0.5)
      expect(box.top).toBeGreaterThanOrEqual(-0.5)
      expect(box.bottom).toBeLessThanOrEqual(visibleH + 0.5)
    }
  })

  it('shifts by half the chrome, and never by more than half the canvas', () => {
    expect(benchViewOffsetPx(640, 0)).toBe(0)
    expect(benchViewOffsetPx(640, 200)).toBe(100)
    expect(benchViewOffsetPx(640, 9999)).toBe(320)
    expect(benchViewOffsetPx(640, -40)).toBe(0)
  })

  it('eases end to end over about a second', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10)
    // Eased, not linear: a quarter in is well under a quarter of the way.
    expect(easeInOut(0.25)).toBeLessThan(0.25)
    expect(easeInOut(0.75)).toBeGreaterThan(0.75)
    expect(BENCH_SWEEP_SECONDS).toBe(1)
  })
})

describe('the leaderboard', () => {
  it('writes a run to the spine and reads it back as a run', () => {
    const store = fakeStorage()
    const b = breakFor(presetBreakVerdict(PARALLAM)!)!
    recordBenchRun(store, b)

    expect(loadLog(store)).toHaveLength(1)
    const runs = readRuns(store)
    expect(runs).toHaveLength(1)
    expect(runs[0].specimenId).toBe(b.specimenId)
    expect(runs[0].label).toBe(b.label)
    expect(runs[0].manufacturer).toBe(b.manufacturer)
    expect(runs[0].partNumber).toBe(b.partNumber)
    expect(runs[0].mode).toBe(b.mode)
    expect(runs[0].multiple).toBe(3.55)
    expect(runs[0].spanFt).toBe(24)
    expect(runs[0].loadPlf).toBe(b.loadPlf)
    expect(runs[0].at).toBe(b.at)
  })

  it('keeps a personal best per part and never re-ranks the parts', () => {
    const store = fakeStorage()
    const p = breakFor(presetBreakVerdict(PARALLAM)!)!
    const w = breakFor(presetBreakVerdict(WEST_FRASER)!)!
    recordBenchRun(store, p)
    recordBenchRun(store, { ...p, at: p.at + 1000, loadPlf: p.loadPlf * 2 })
    recordBenchRun(store, w)

    const parts = [
      { id: p.specimenId, label: p.label },
      { id: w.specimenId, label: w.label },
    ]
    const bests = personalBests(loadLog(store), parts)
    // Catalogue order, whatever the numbers say — the strongest break here is
    // on a different part, and the list must not sort itself by it.
    expect(bests.map((b) => b.specimenId)).toEqual(parts.map((x) => x.id))
    expect(bests[0].breaks).toBe(2)
    expect(bests[0].best!.loadPlf).toBeCloseTo(p.loadPlf * 2, 6)
    expect(bests[1].breaks).toBe(1)
  })

  it('reads only this app\u2019s bench runs, not another app\u2019s or the years panel\u2019s', () => {
    const store = fakeStorage()
    record(store, {
      app: 'circuitry3d', subject: 'Resistor', runId: 'r1',
      metrics: [{ key: 'multiple', rated: null, actual: 2, unit: '×' }],
    })
    record(store, {
      app: 'theprints3d', subject: 'Wall assembly',
      metrics: [{ key: 'reserve', rated: 100, actual: 82, unit: '%' }],
    })
    expect(runsFrom(loadLog(store))).toHaveLength(0)
    expect(readRuns(store)).toHaveLength(0)
  })

  it('files exactly the fields the card and the list need', () => {
    const b = breakFor(presetBreakVerdict(PARALLAM)!)!
    const input = benchRecordInput(b)
    expect(input.app).toBe('theprints3d')
    expect(input.level).toBe('failed')
    expect(input.basis).toBe('simulated')
    expect(input.runId).toBe(b.specimenId)
    expect(input.metrics!.map((m) => m.key)).toEqual(['multiple', 'span', 'load'])
    expect(input.metrics!.every((m) => Number.isFinite(m.actual))).toBe(true)
  })
})
