/**
 * FLOATING NAMEPLATES — the plates, drawn.
 *
 * The data plate floats with the part it names, beside it and never on it, so
 * the thing named stays in view. Where each one goes is decided by
 * `layoutNameplates`; this only draws the result:
 *
 *   - a small glass plate per part, sized to its tier;
 *   - a thin leader from a plate that had to be pushed away, back to its part;
 *   - a dot where a part is too small or too crowded for text — tap it and it
 *     opens to full;
 *   - one marker with a count where dots would sit on each other — tap it for
 *     the list.
 *
 * The tracker inside the canvas moves the plates every frame. React only
 * re-renders when WHICH plates exist, or their tier, changes; the positions
 * are written straight onto the elements, so orbiting a storey of plates does
 * not rebuild thirty components sixty times a second.
 *
 * Plate sizes come from plateMeasure, which the CSS module must agree with.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './FloatingNameplates.module.css'
import type { NameplateLayout, PlacedPlate } from '../../services/nameplateLayout'
import {
  latestNameplateLayout, nameplateSources, onNameplateLayout, toggleExpandedNameplate,
  type PlateContent,
} from './nameplateRegistry'

// ── Drawing ────────────────────────────────────────────────────────────────

function shapeKey(l: NameplateLayout): string {
  return [
    l.plates.map((p) => `${p.id}:${p.tier}:${p.leader ? 1 : 0}`).join(','),
    l.dots.map((d) => d.id).join(','),
    l.clusters.map((c) => c.ids.join('+')).join(','),
  ].join('|')
}

/** Where a leader meets the plate: the point on the plate's edge nearest the part. */
function leaderEnd(p: PlacedPlate): { x: number; y: number } {
  return {
    x: Math.max(p.box.x, Math.min(p.anchor.x, p.box.x + p.box.w)),
    y: Math.max(p.box.y, Math.min(p.anchor.y, p.box.y + p.box.h)),
  }
}

/** Remember a drawn element by id, so the tracker's positions can reach it. */
function keep<T extends Element>(ref: { current: Map<string, T> }, id: string, el: T | null): void {
  if (el) ref.current.set(id, el); else ref.current.delete(id)
}

function Plate({ plate, content }: { plate: PlacedPlate; content: PlateContent }) {
  if (plate.tier === 1) return <div className={styles.title}>{content.title}</div>
  if (plate.tier === 2 || !content.fields) {
    return (
      <div className={styles.title}>
        {content.title}
        {content.figure && <span className={styles.figure}> · {content.figure}</span>}
      </div>
    )
  }
  return (
    <>
      <div className={styles.title}>{content.title}</div>
      <div className={styles.rows}>
        {content.fields.map((f) => (
          <div key={f.key} className={styles.row}>
            <span className={styles.label}>{f.label}</span>
            {/* An empty slot keeps its place, so the next field never jumps up. */}
            <span className={`${styles.value} ${f.value == null ? styles.empty : ''}`}>{f.value ?? '—'}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export default function FloatingNameplates() {
  const [layout, setLayout] = useState<NameplateLayout>(latestNameplateLayout)
  const [openCluster, setOpenCluster] = useState<string | null>(null)
  const keyRef = useRef(shapeKey(layout))
  const plateEls = useRef(new Map<string, HTMLDivElement>())
  const lineEls = useRef(new Map<string, SVGLineElement>())
  const dotEls = useRef(new Map<string, HTMLElement>())

  /** Move everything to where the layout says — transform only. */
  const place = (l: NameplateLayout) => {
    for (const p of l.plates) {
      const el = plateEls.current.get(p.id)
      if (el) el.style.transform = `translate(${Math.round(p.box.x)}px, ${Math.round(p.box.y)}px)`
      const line = lineEls.current.get(p.id)
      if (line) {
        const e = leaderEnd(p)
        line.setAttribute('x1', String(p.anchor.x)); line.setAttribute('y1', String(p.anchor.y))
        line.setAttribute('x2', String(e.x)); line.setAttribute('y2', String(e.y))
      }
    }
    for (const d of l.dots) {
      const el = dotEls.current.get(d.id)
      if (el) el.style.transform = `translate(${Math.round(d.x)}px, ${Math.round(d.y)}px)`
    }
    for (const c of l.clusters) {
      const el = dotEls.current.get(c.ids.join('+'))
      if (el) el.style.transform = `translate(${Math.round(c.x)}px, ${Math.round(c.y)}px)`
    }
  }

  useEffect(() => onNameplateLayout((l) => {
    const k = shapeKey(l)
    if (k !== keyRef.current) { keyRef.current = k; setLayout(l) }
    else place(l)
  }), [])
  // After a re-render the new elements exist; put them where they belong
  // before the frame paints, so nothing flashes at the top-left corner.
  useLayoutEffect(() => { place(latestNameplateLayout()) })

  // A cluster's list is transient: it goes when its marker does.
  const openKey = openCluster && layout.clusters.some((c) => c.ids.join('+') === openCluster) ? openCluster : null

  const src = nameplateSources()

  return (
    <div className={styles.layer} data-nameplate-layer aria-hidden={layout.plates.length === 0 && layout.dots.length === 0 && layout.clusters.length === 0}>
      <svg className={styles.leaders}>
        {layout.plates.filter((p) => p.leader).map((p) => (
          <line key={p.id} ref={(el) => keep(lineEls, p.id, el)} className={styles.leader} />
        ))}
      </svg>

      {layout.plates.map((p) => {
        const c = src.get(p.id)
        if (!c) return null
        return (
          <div
            key={p.id}
            ref={(el) => keep(plateEls, p.id, el)}
            className={`${styles.plate} ${c.selected ? styles.selected : ''}`}
            style={{ width: p.box.w, height: p.box.h }}
            role="note"
          >
            <Plate plate={p} content={c} />
          </div>
        )
      })}

      {layout.dots.map((d) => {
        const c = src.get(d.id)
        return (
          <button
            key={d.id}
            ref={(el) => keep(dotEls, d.id, el)}
            type="button"
            className={styles.dot}
            aria-label={c ? `Show ${c.title}` : 'Show nameplate'}
            onClick={() => toggleExpandedNameplate(d.id)}
          >
            <span className={styles.dotMark} />
          </button>
        )
      })}

      {layout.clusters.map((cl) => {
        const key = cl.ids.join('+')
        const open = openKey === key
        return (
          <div key={key} ref={(el) => keep(dotEls, key, el)} className={styles.clusterWrap}>
            <button
              type="button"
              className={`${styles.dot} ${styles.cluster}`}
              aria-expanded={open}
              aria-label={`${cl.ids.length} nameplates here`}
              onClick={() => setOpenCluster(open ? null : key)}
            >
              <span className={styles.count}>{cl.ids.length}</span>
            </button>
            {open && (
              <ul className={styles.list}>
                {cl.ids.map((id) => (
                  <li key={id}>
                    <button type="button" className={styles.listItem}
                      onClick={() => { toggleExpandedNameplate(id); setOpenCluster(null) }}>
                      {src.get(id)?.title ?? id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
