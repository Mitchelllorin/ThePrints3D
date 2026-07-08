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
import type { ParsedWall } from '../../types'

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
      <p style={{ color: '#6b7280', fontSize: 10.5, margin: '6px 0 0' }}>Estimates from the drawn model — verify against local code &amp; waste factors.</p>
    </div>
  )
}
