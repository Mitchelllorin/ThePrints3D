/**
 * THE OPEN JOB SURVIVES THE APP BEING KILLED.
 *
 * Save → wipe the workspace → reopen must hand back the job exactly: the walls
 * on the sheet AND everything the old manual save dropped (stood-up openings,
 * the roof, undo cleared so it can't step back into another job). IndexedDB is
 * swapped for a Map; the serialise/deserialise round trip is the real one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./pdfRasterizer', () => ({
  rasterizePDF: vi.fn(),
  rasterizeImage: vi.fn(),
  rasterizeFile: vi.fn(),
}))

const db = new Map<string, unknown>()
vi.mock('./projectStorage', async (importActual) => {
  const real = await importActual<typeof import('./projectStorage')>()
  return {
    ...real,
    saveProject: vi.fn(async (p: { id: string }) => { db.set(p.id, structuredClone(p)) }),
    loadProject: vi.fn(async (id: string) => (db.has(id) ? structuredClone(db.get(id)) : null)),
    listProjects: vi.fn(async () => [...db.values()]),
    deleteProject: vi.fn(async (id: string) => { db.delete(id) }),
  }
})

import { useAppStore } from '../store/useAppStore'
import { beginSession, currentJobId, flushJob, newJob, openJob, readSaveState, removeJob, renameJob } from './currentJob'
import { saveProject } from './projectStorage'
import type { Drawing, PlacedObject, TracedLine } from '../types'

const s = () => useAppStore.getState()

function drawing(): Drawing {
  return {
    id: 'd1',
    name: 'plan.png',
    source: 'drawn',
    type: 'floor_plan',
    file: new File(['<svg/>'], 'plan.svg', { type: 'image/svg+xml' }),
    pageCount: 1,
    currentPage: 1,
    previewUrl: null,
    rasterUrl: null,
    rasterWidth: 1000,
    rasterHeight: 800,
    parsedWalls: [{ x1: 0, y1: 0, x2: 900, y2: 0, thickness: 15, source: 'user' }],
    parsedRooms: [],
    parsedOpenings: [],
    parsedText: [],
    parsedSymbols: [],
    parsedAnnotationCandidates: [],
    parseProgress: 100,
    floorNumber: 0,
    status: 'done',
    scaleMmPerPx: 10,
  } as unknown as Drawing
}

const door = { id: 'obj-1', catalogId: 'door-3068', x: 1, y: 0, z: 2, rotationY: 0, level: 0 } as unknown as PlacedObject
const roof = { id: 'roof-1', points: [[0, 0], [9, 0], [9, 7]] } as unknown as TracedLine

function putAJobOn() {
  useAppStore.setState((st) => {
    st.drawings = [drawing()]
    st.placedObjects = [door]
    st.roofAreas = [roof]
  })
}

beforeEach(async () => {
  await newJob()
  db.clear()
})

describe('the open job', () => {
  it('saves nothing while the sheet is empty and no job exists', async () => {
    await flushJob()
    expect(db.size).toBe(0)
    expect(currentJobId()).toBeNull()
  })

  it('comes back whole after the workspace is wiped', async () => {
    putAJobOn()
    await flushJob()
    const id = currentJobId()!
    expect(id).toBeTruthy()

    await newJob()
    expect(s().drawings).toHaveLength(0)
    expect(s().placedObjects).toHaveLength(0)

    expect(await openJob(id)).toBe(true)
    expect(currentJobId()).toBe(id)
    expect(s().drawings[0].parsedWalls[0].x2).toBe(900)
    expect(s().drawings[0].file).toBeInstanceOf(File)
    expect(s().placedObjects.map((o) => o.id)).toEqual(['obj-1'])
    expect(s().roofAreas.map((r) => r.id)).toEqual(['roof-1'])
    expect(s().historyPast).toHaveLength(0)
  })

  /**
   * A COLD START IS A CLEAN SHEET.
   *
   * It used to reopen the last job before the front door was even tapped, so a
   * framer measuring a different house opened onto yesterday's plan — and the
   * first edit wrote back over it. Starting a session must drop the POINTER and
   * nothing else: the record, with everything on it, is still in the library.
   */
  it('starts a session clean without touching the job left behind', async () => {
    putAJobOn()
    await flushJob()
    const lastNight = currentJobId()!

    beginSession()
    expect(currentJobId()).toBeNull()
    s().clearWorkspace()                       // a reload opens an empty store
    expect((db.get(lastNight) as { drawings: unknown[] }).drawings).toHaveLength(1)

    putAJobOn()                                // today's work, a different house
    await flushJob()
    expect(currentJobId()).not.toBe(lastNight)
    expect((db.get(lastNight) as { drawings: unknown[] }).drawings).toHaveLength(1)
    expect(db.size).toBe(2)
  })

  it('names a new job after the sheet it was started from', async () => {
    putAJobOn()
    await flushJob()
    expect((db.get(currentJobId()!) as { name: string }).name).toBe('plan')
  })

  it('keeps writing to the same job, not a new one each save', async () => {
    putAJobOn()
    await flushJob()
    useAppStore.setState((st) => { st.roofAreas = [] })
    await flushJob()
    expect(db.size).toBe(1)
  })

  it('saves a cleared job empty, so it does not come back on relaunch', async () => {
    putAJobOn()
    await flushJob()
    const id = currentJobId()!
    s().clearWorkspace()
    await flushJob()
    const rec = db.get(id) as { drawings: unknown[] }
    expect(rec.drawings).toHaveLength(0)
  })

  it('renames the open job', async () => {
    putAJobOn()
    await flushJob()
    const id = currentJobId()!
    await renameJob(id, '  Smith garage  ')
    expect((db.get(id) as { name: string }).name).toBe('Smith garage')
  })

  it('deleting the open job empties the workspace', async () => {
    putAJobOn()
    await flushJob()
    const id = currentJobId()!
    await removeJob(id)
    expect(db.has(id)).toBe(false)
    expect(currentJobId()).toBeNull()
    expect(s().drawings).toHaveLength(0)
  })
})

/**
 * A FAILED SAVE IS NOT SILENT.
 *
 * The catch in flushJob used to be empty, so a full device looked exactly like a
 * saved job. This pins the two halves of the fix: the failure is reported, in
 * words that name the fix, and the next good save clears it without anyone
 * having to dismiss anything.
 */
describe('a save that fails', () => {
  it('reports a full device, then clears itself on the next good save', async () => {
    putAJobOn()
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    vi.mocked(saveProject).mockRejectedValueOnce(quota)

    await expect(flushJob()).resolves.toBeUndefined()   // never throws at the UI
    const failed = readSaveState()
    expect(failed?.status).toBe('error')
    expect(failed?.status === 'error' && failed.message).toMatch(/no room left/i)
    expect(s().drawings).toHaveLength(1)                // the work is still on screen

    await flushJob()
    expect(readSaveState()?.status).toBe('saved')
  })
})
