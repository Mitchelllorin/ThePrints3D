/**
 * ONE LIST OF NAMEPLATES FOR THE WHOLE SCENE.
 *
 * Walls, subfloors, ceilings and the edit-mode hover each used to hang their
 * own label in the air, and none of them knew the others existed — which is
 * exactly why they ran into each other. Now each one only says "this object,
 * this is what it's called, these are its figures", and a single tracker lays
 * all of them out together (see nameplateLayout for the rules).
 *
 * Three pieces of shared state live here, outside React, because the tracker
 * reads them every frame inside the canvas and the overlay draws them outside
 * it:
 *   - the sources, keyed by a stable id;
 *   - which dot the user tapped open;
 *   - the latest layout, pushed to whoever is drawing it.
 */
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import type { NameplateField } from '../../services/nameplate'
import type { NameplateLayout, Tier } from '../../services/nameplateLayout'

export interface PlateContent {
  /** Tier 1: what it is. */
  title: string
  /** Tier 2 adds this — the one figure that matters most for the part. */
  figure: string | null
  /** Tier 3: every rated field, in the app's fixed order. */
  fields: NameplateField[] | null
}

export interface PlateSource extends PlateContent {
  /** The thing named. Its box is read every frame, so the plate follows it
   *  through orbit, zoom and explode without anyone telling it to. */
  object: THREE.Object3D
  selected: boolean
  warning: boolean
  /** A fixed tier that ignores the global dial (the hover name). */
  tier?: Tier
  /** First-registered order: the stable tie-break in the ranking. */
  order: number
}

const sources = new Map<string, PlateSource>()
let nextOrder = 0
let version = 0
let expandedId: string | null = null

export function nameplateSources(): ReadonlyMap<string, PlateSource> { return sources }
/** Bumps whenever a plate's content, selection or membership changes. */
export function nameplateVersion(): number { return version }

export function expandedNameplate(): string | null { return expandedId }
/** A tapped dot opens to full; tapping it again closes it. */
export function toggleExpandedNameplate(id: string): void {
  expandedId = expandedId === id ? null : id
  version++
}

function sameContent(a: PlateSource, b: Omit<PlateSource, 'order'>): boolean {
  return a.object === b.object && a.title === b.title && a.figure === b.figure
    && a.selected === b.selected && a.warning === b.warning && a.tier === b.tier
    && JSON.stringify(a.fields) === JSON.stringify(b.fields)
}

/**
 * Put a nameplate on an object for as long as the calling component wants one.
 * Pass null to take it off (a hidden storey, a part that is not built yet).
 */
export function useNameplateSource(id: string, source: Omit<PlateSource, 'order'> | null): void {
  const idRef = useRef(id)
  useEffect(() => {
    if (idRef.current !== id) { sources.delete(idRef.current); idRef.current = id; version++ }
    if (!source) {
      if (sources.delete(id)) version++
      return
    }
    const prev = sources.get(id)
    if (prev && sameContent(prev, source)) return
    sources.set(id, { ...source, order: prev?.order ?? nextOrder++ })
    version++
  })
  useEffect(() => () => {
    if (sources.delete(idRef.current)) version++
    if (expandedId === idRef.current) expandedId = null
  }, [])
}

// ── The layout, handed from the tracker to the overlay ─────────────────────

type Listener = (layout: NameplateLayout) => void
const listeners = new Set<Listener>()
let latest: NameplateLayout = { plates: [], dots: [], clusters: [] }

export function publishNameplateLayout(layout: NameplateLayout): void {
  latest = layout
  for (const l of listeners) l(layout)
}
export function latestNameplateLayout(): NameplateLayout { return latest }
export function onNameplateLayout(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
