/**
 * TakeoffContent — a live material takeoff (counts/quantities) for everything
 * drawn: wall feet + studs + board, floor/roof areas + sheets, plumbing /
 * electrical / HVAC feet by type, and fixture counts. Rendered INSIDE the
 * Settings drawer (not a floating pill) so the workspace stays clear.
 */
import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { computeTakeoff } from '../../services/takeoff'
import { builtScene, countBuiltMembers, groupBuiltMembers } from '../../services/builtScene'
import type { ParsedWall } from '../../types'

const LAYER_TITLE: Record<string, string> = {
  framing: 'Framing', roof: 'Roof', floors: 'Floors',
  drywall: 'Board', sheathing: 'Sheathing', cladding: 'Cladding',
}

export default function TakeoffContent() {
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const hvacLines = useAppStore((s) => s.hvacLines)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)
  const roofOverhangIn = useConfigStore((s) => s.roofOverhangIn)

  const sections = useMemo(() => {
    const active = drawings.find((d) => d.id === overlay.drawingId) ?? drawings[0] ?? null
    const scaleMmPerPx = active?.scaleMmPerPx ?? 23.5
    const walls: ParsedWall[] = drawings.flatMap((d) => d.parsedWalls)
    const wallHeightM = deriveWorkspaceSceneConfig(wizardInputs).wallHeightM
    return computeTakeoff({
      scaleMmPerPx, wallHeightM, walls,
      plumbing: plumbingLines, electrical: electricalLines, hvac: hvacLines,
      floors: floorsAreas, roof: roofAreas,
      placedObjects: placedObjects.map((o) => ({ type: o.type })),
      roofOverhangM: roofOverhangIn * 0.0254,
    })
  }, [drawings, overlay.drawingId, plumbingLines, electricalLines, hvacLines, floorsAreas, roofAreas, placedObjects, wizardInputs, roofOverhangIn])

  const empty = sections.length === 0

  // Recounted whenever the panel renders — cheap, and always current with what
  // is actually standing rather than a snapshot that can drift.
  const built = countBuiltMembers(builtScene.current)

  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#e5e7eb' }}>
      {empty ? (
        <p style={{ color: '#9ca3af', margin: 0 }}>Nothing drawn yet — trace walls, floors, or trades and the counts appear here.</p>
      ) : (
        sections.map((sec) => (
          <div key={sec.title} style={{ marginBottom: 10 }}>
            <div style={{ color: '#f97316', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>{sec.title}</div>
            {sec.items.map((it) => (
              <div key={it.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: '#cbd5e1' }}>{it.label}</span>
                <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{it.quantity} {it.unit}</span>
              </div>
            ))}
          </div>
        ))
      )}
      {/* COUNTED FROM THE MODEL, not estimated from the lines.
          The section above re-derives quantities from rules of thumb — studs at
          16" o.c., sheets at 32 sq ft — and cannot see per-wall framing, the
          ceiling height, a per-edge overhang, the felt or the ridge caps.
          Measured on the two-storey preset it claimed 932 studs against a model
          holding 629, and could not tell a 2×4 from a 2×8.
          This is the actual bill: every member the builders stamped with the
          name a supplier would recognise, tallied. No estimating step to be
          wrong. Only what is STANDING — hide the roof and the rafters leave. */}
      {built.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 8 }}>
          <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            Counted from the model
          </div>
          {groupBuiltMembers(built).map((g) => (
            <div key={g.layer} style={{ marginBottom: 8 }}>
              <div style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>
                {LAYER_TITLE[g.layer] ?? g.layer}
              </div>
              {g.items.map((m) => (
                <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ color: '#cbd5e1' }}>{m.label}</span>
                  <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{m.count} ea</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <p style={{ color: '#6b7280', fontSize: 10.5, margin: '6px 0 0' }}>Estimates from the drawn model — verify against local code &amp; waste factors.</p>
    </div>
  )
}
