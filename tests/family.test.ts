import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import family from '../src/data/family.json'
import { FAMILY_SELF } from '../src/components/Layout/FamilyDrawer'

// The same order as 3dlearningfamily.com and the family band on every site:
// the three apps people can use now, then the shop. The same list, file for
// file, in CircuiTry3D and AutoMotive3D.
const ORDER = ['CircuiTry3D', 'ThePrints3D', 'AutoMotive3D', 'ElectriMotive3D', 'TheAtom3D', 'TheCell3D', 'AnyBody3D', 'AnyPlanet3D', 'ThePyramids3D']

describe('the 3D Learning Family', () => {
  it('is all nine, in family order, and includes this app', () => {
    expect(family.apps.map((a) => a.name)).toEqual(ORDER)
    expect(family.apps.some((a) => a.name === FAMILY_SELF)).toBe(true)
  })

  it('puts the live apps up front, each with its own site', () => {
    const live = family.apps.filter((a) => a.live)
    expect(live.map((a) => a.name)).toEqual(ORDER.slice(0, 3))
    for (const app of live) expect(app.site, app.name).toBeTruthy()
  })

  it('links siblings to their own sites, never a store listing', () => {
    for (const app of family.apps) {
      if (app.site) {
        expect(app.site, app.name).toMatch(/^https:\/\/[a-z0-9.-]+$/)
        expect(app.site, app.name).not.toMatch(/play\.google|apps\.apple/)
      }
      expect(app.line, app.name).toBeTruthy()
    }
  })

  it('is headed by the family site and signed by its maker', () => {
    expect(family.home).toBe('https://3dlearningfamily.com')
    expect(family.maker).toBe('Mitchell Lorin McKnight')
  })

  // The other two apps carry the same family.json. Compared parsed, so a
  // checkout's line endings can't fail it. Checked wherever they are checked out
  // next to this repo (C:\Dev); skipped, not failed, where not.
  const readJson = (url: URL) => JSON.parse(readFileSync(url, 'utf8'))
  const ours = readJson(new URL('../src/data/family.json', import.meta.url))
  for (const sibling of ['CircuiTry3D', 'AutoMotive3D']) {
    const theirs = new URL(`../../${sibling}/src/data/family.json`, import.meta.url)
    it.skipIf(!existsSync(theirs))(`${sibling} carries the same family.json`, () => {
      expect(readJson(theirs)).toEqual(ours)
    })
  }
})
