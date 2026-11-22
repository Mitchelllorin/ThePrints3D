import { beforeEach, describe, expect, it, vi } from 'vitest'

// IndexedDB and localStorage stand-ins: node has neither.
const idbStore = new Map<string, unknown>()
vi.mock('idb', () => ({
  openDB: async () => ({
    put: async (_s: string, v: unknown, k: string) => { idbStore.set(k, v) },
    get: async (_s: string, k: string) => idbStore.get(k),
    delete: async (_s: string, k: string) => { idbStore.delete(k) },
  }),
}))
const ls = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => { ls.set(k, v) },
  removeItem: (k: string) => { ls.delete(k) },
})

const flush = () => new Promise((r) => setTimeout(r, 0))

async function fresh() {
  vi.resetModules()
  return import('./importTrail')
}

describe('an import that the page died under', () => {
  beforeEach(() => { ls.clear(); idbStore.clear() })

  it('says nothing after a clean start or a finished import', async () => {
    const t = await fresh()
    expect(await t.takeUnfinishedImport()).toBeNull()
    t.savePickedFile(new File(['x'], 'plan.jpg', { type: 'image/jpeg' }))
    t.markImport('raster')
    t.markImport('done')
    await flush()
    expect(await (await fresh()).takeUnfinishedImport()).toBeNull()
  })

  it('knows the print never arrived when the page died in the picker', async () => {
    const t = await fresh()
    t.markImport('picker')
    expect(await (await fresh()).takeUnfinishedImport()).toEqual({ kind: 'lost-in-picker' })
  })

  it('resumes once with the saved file when the page died while reading it', async () => {
    const t = await fresh()
    t.markImport('picker')
    t.savePickedFile(new File(['pixels'], 'plan.jpg', { type: 'image/jpeg' }))
    t.markImport('raster')
    await flush()
    const left = await (await fresh()).takeUnfinishedImport()
    expect(left?.kind).toBe('resume')
    if (left?.kind === 'resume') {
      expect(left.file.name).toBe('plan.jpg')
      expect(left.file.type).toBe('image/jpeg')
    }
  })

  it('does not resume a second time — a print that kills the page cannot loop', async () => {
    const t = await fresh()
    t.savePickedFile(new File(['pixels'], 'plan.jpg', { type: 'image/jpeg' }))
    await flush()
    const t2 = await fresh()
    expect((await t2.takeUnfinishedImport())?.kind).toBe('resume')
    t2.markImport('raster') // the resume starts reading, and the page dies again
    expect(await (await fresh()).takeUnfinishedImport()).toEqual({ kind: 'gave-up', name: 'plan.jpg' })
  })

  it('leaves reprocessing a sheet alone — only a pick starts a trail', async () => {
    const t = await fresh()
    t.markImport('raster', 'sample.pdf')
    t.markImport('detect')
    expect(await (await fresh()).takeUnfinishedImport()).toBeNull()
  })
})
