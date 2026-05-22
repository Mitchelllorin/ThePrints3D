import type { WallTypePreset } from '../types'

const THICKNESS_KEY = 'blueprint3d-last-wall-thickness'
const TYPE_KEY = 'blueprint3d-last-wall-type'
const LOAD_BEARING_KEY = 'blueprint3d-last-load-bearing'
const INTERNAL_KEY = 'blueprint3d-last-internal'

export interface WallMemory {
  thicknessMm: number
  presetId: string
  loadBearing: boolean
  isInternal: boolean
}

function loadNumber(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key)
    return v !== null ? parseFloat(v) : fallback
  } catch {
    return fallback
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v !== null ? v === 'true' : fallback
  } catch {
    return fallback
  }
}

const DEFAULTS: WallMemory = {
  thicknessMm: 90,
  presetId: 'stud-2x4',
  loadBearing: false,
  isInternal: true,
}

let _cache: WallMemory | null = null

function get(): WallMemory {
  if (!_cache) {
    _cache = {
      thicknessMm: loadNumber(THICKNESS_KEY, DEFAULTS.thicknessMm),
      presetId: localStorage.getItem(TYPE_KEY) ?? DEFAULTS.presetId,
      loadBearing: loadBool(LOAD_BEARING_KEY, DEFAULTS.loadBearing),
      isInternal: loadBool(INTERNAL_KEY, DEFAULTS.isInternal),
    }
  }
  return _cache
}

function save(): void {
  if (!_cache) return
  try {
    localStorage.setItem(THICKNESS_KEY, String(_cache.thicknessMm))
    localStorage.setItem(TYPE_KEY, _cache.presetId)
    localStorage.setItem(LOAD_BEARING_KEY, String(_cache.loadBearing))
    localStorage.setItem(INTERNAL_KEY, String(_cache.isInternal))
  } catch { /* ignore */ }
}

export function getWallMemory(): WallMemory {
  return { ...get() }
}

export function setWallMemory(memory: Partial<WallMemory>): void {
  const current = get()
  _cache = { ...current, ...memory }
  save()
}

export function setWallFromPreset(preset: WallTypePreset, loadBearing: boolean, isInternal: boolean): void {
  setWallMemory({
    thicknessMm: preset.thicknessMm,
    presetId: preset.id,
    loadBearing,
    isInternal,
  })
}

export function getThicknessMm(): number {
  return get().thicknessMm
}

export function getPresetId(): string {
  return get().presetId
}

export function isLoadBearing(): boolean {
  return get().loadBearing
}

export function isInternal(): boolean {
  return get().isInternal
}

export function hasMemory(): boolean {
  try {
    return localStorage.getItem(THICKNESS_KEY) !== null
  } catch {
    return false
  }
}

export function clearWallMemory(): void {
  _cache = null
  try {
    localStorage.removeItem(THICKNESS_KEY)
    localStorage.removeItem(TYPE_KEY)
    localStorage.removeItem(LOAD_BEARING_KEY)
    localStorage.removeItem(INTERNAL_KEY)
  } catch { /* ignore */ }
}
