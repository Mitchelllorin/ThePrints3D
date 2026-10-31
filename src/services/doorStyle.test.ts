import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { doorStyle, doorTypeName, DOOR_TYPES, framedShiftM, doorOrderName } from './doorStyle'
import { roughOpening } from './roughOpening'
import { lvlHeaderFor, buildWallFraming } from './framingGeometry'
import { SUBTYPES, getCatalogItem, isWallMountedType } from '../data/objectCatalog'

const DOOR_W = 0.9144
const door = (widthM: number, subtype?: string) => ({ type: 'door', subtype, scaleX: widthM / DOOR_W })
const IN = 0.0254

describe('doorStyle', () => {
  it('goes by width when no Type is set, as it always has', () => {
    expect(doorStyle(door(0.9144))).toBe('single')
    expect(doorStyle(door(1.52))).toBe('double')
    expect(doorStyle(door(2.74))).toBe('garage')
  })

  it('lets the Type win over width', () => {
    // The whole point: a 6-ft patio slider is not a pair of swing doors.
    expect(doorStyle(door(1.8288, 'Patio Slider'))).toBe('patio')
    expect(doorStyle(door(1.2192, 'Bifold'))).toBe('bifold')
    expect(doorStyle(door(0.762, 'Pocket'))).toBe('pocket')
    expect(doorStyle(door(1.524, 'Bypass'))).toBe('bypass')
    expect(doorStyle(door(1.8288, 'Hinged Double'))).toBe('double')
  })

  it('reads an old "Sliding" by width: patio when wide, bypass when not', () => {
    expect(doorStyle(door(1.8288, 'Sliding'))).toBe('patio')
    expect(doorStyle(door(1.2192, 'Sliding'))).toBe('bypass')
  })

  it('is null for anything that is not a door', () => {
    expect(doorStyle({ type: 'window', scaleX: 1 })).toBeNull()
  })

  it('offers every Type the card lists, and names each style back', () => {
    expect(SUBTYPES.door).toEqual(DOOR_TYPES.map((t) => t.name))
    for (const t of DOOR_TYPES) expect(doorTypeName(t.style)).toBe(t.name)
  })
})

describe('door presets in Place', () => {
  it('patio and closet doors place as plain doors with their Type set', () => {
    expect(getCatalogItem('patio-door')?.placesAs).toEqual({ type: 'door', subtype: 'Patio Slider' })
    expect(getCatalogItem('closet-door')?.placesAs).toEqual({ type: 'door', subtype: 'Bifold' })
    expect(isWallMountedType('patio-door')).toBe(true)
    expect(isWallMountedType('closet-door')).toBe(true)
  })
})

describe('patio slider rough opening', () => {
  it('frames a 6068 at 72-1/2" × 80-1/2"', () => {
    const ro = roughOpening('door', 'Patio Slider', 72 * IN, 80 * IN)
    expect(ro.rule).toBe('patio')
    expect(ro.widthM / IN).toBeCloseTo(72.5, 5)
    expect(ro.heightM / IN).toBeCloseTo(80.5, 5)
  })
})

describe('lvlHeaderFor', () => {
  it('deepens the header as the span grows', () => {
    expect(lvlHeaderFor(38 * IN).label).toBe('9-1/4')      // a 3-ft door
    expect(lvlHeaderFor(48.5 * IN).label).toBe('9-1/4')    // a 4-ft window
    expect(lvlHeaderFor(72.5 * IN).label).toBe('11-7/8')   // a 6-ft slider
    expect(lvlHeaderFor(96.5 * IN).label).toBe('14')       // an 8-ft slider
    expect(lvlHeaderFor(192 * IN).label).toBe('16')        // a 16-ft garage door
  })
})

describe('framedShiftM — a pocket kit frames off the doorway, not around it', () => {
  it('pushes the hole half a door toward the pocket side', () => {
    const p = { ...door(0.9144, 'Pocket'), swing: 'right' as const }
    expect(framedShiftM(p)).toBeCloseTo(0.4572, 6)
    expect(framedShiftM({ ...p, swing: 'left' })).toBeCloseTo(-0.4572, 6)
    // With a 73" hole shifted 18": doorway jamb at -18.5", pocket end at +54.5".
    const ro = roughOpening('door', 'Pocket', 36 * IN, 80 * IN).widthM
    const shift = framedShiftM({ ...door(36 * IN, 'Pocket'), swing: 'right' })
    expect((shift - ro / 2) / IN).toBeCloseTo(-18.5, 5)
    expect((shift + ro / 2) / IN).toBeCloseTo(54.5, 5)
  })
  it('leaves every other door centred', () => {
    expect(framedShiftM(door(0.9144))).toBe(0)
    expect(framedShiftM(door(1.8288, 'Patio Slider'))).toBe(0)
  })
})

describe('pocket door frame kit in the wall', () => {
  const kitMeshes = (opening: Parameters<typeof buildWallFraming>[0]['openings']) => {
    const g = buildWallFraming({ length: 5, height: 2.44, thickness: 0.089, openings: opening })
    const out: THREE.Mesh[] = []
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && String(o.userData.info).startsWith('Pocket door frame kit')) out.push(o as THREE.Mesh) })
    return out
  }
  const RO = 73 * IN, DOOR = 36 * IN

  it('stands the kit in the hole, all on the pocket side, and never on the cut list', () => {
    const kit = kitMeshes([{ centerM: 2.5, widthM: RO, type: 'door', heightM: 84.5 * IN, pocket: { dir: 1, doorW: DOOR } }])
    expect(kit.length).toBeGreaterThan(4)
    for (const m of kit) expect(m.userData.cut).toBeUndefined()
    // Hole is centred at local x=0, spanning ±36.5". The doorway is the left
    // 36"; every slat and the mouth jamb sit to the right of it.
    const slats = kit.filter((m) => (m.geometry as THREE.BoxGeometry).parameters.width > 0.5
      && (m.geometry as THREE.BoxGeometry).parameters.width < RO - 0.01)
    expect(slats.length).toBeGreaterThan(0)
    for (const s of slats) expect(s.position.x).toBeGreaterThan(0)
  })

  it('draws no kit in a plain door', () => {
    expect(kitMeshes([{ centerM: 2.5, widthM: 38 * IN, type: 'door', heightM: 82.5 * IN }])).toHaveLength(0)
  })
})

describe('doorOrderName', () => {
  it('names what gets bought, with its size', () => {
    expect(doorOrderName(door(36 * IN, 'Pocket'))).toBe('Pocket door frame kit + slab, 36"')
    expect(doorOrderName(door(72 * IN, 'Patio Slider'))).toBe(`Patio slider, 6'-0"`)
    expect(doorOrderName(door(48 * IN, 'Bifold'))).toBe('Bifold closet door, 48"')
    expect(doorOrderName({ type: 'sofa', scaleX: 1 })).toBeNull()
  })
})
