/**
 * TakeoffPanel — a live material takeoff (counts/quantities) for everything
 * drawn: wall feet + studs + board, floor/roof areas + sheets, plumbing /
 * electrical / HVAC feet by type, and fixture counts. A floating, dismissible
 * card so the workspace stays clear (toggled by its own pill button).
 */
import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { deriveWorkspaceSceneConfig } from '../../services/workspaceScene'
import { computeTakeoff } from '../../services/takeoff'
import type { ParsedWall } from '../../types'

export default function TakeoffPanel() {
  const [open, setOpen] = useState(false)
  const drawings = useAppStore((s) => s.drawings)
  const overlay = useAppStore((s) => s.floorplanOverlay)
  const plumbingLines = useAppStore((s) => s.plumbingLines)
  const electricalLines = useAppStore((s) => s.electricalLines)
  const hvacLines = useAppStore((s) => s.hvacLines)
  const floorsAreas = useAppStore((s) => s.floorsAreas)
  const roofAreas = useAppStore((s) => s.roofAreas)
  const placedObjects = useAppStore((s) => s.placedObjects)
  const wizardInputs = useAppStore((s) => s.wizardInputs)

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
    })
  }, [drawings, overlay.drawingId, plumbingLines, electricalLines, hvacLines, floorsAreas, roofAreas, placedObjects, wizardInputs])

  const empty = sections.length === 0

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Material takeoff — quantities for everything drawn"
        style={{
          position: 'absolute', left: 12, bottom: 12, zIndex: 30,
          background: open ? '#f97316' : 'rgba(11,17,32,0.85)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8,
          padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        📋 Takeoff
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', left: 12, bottom: 52, zIndex: 30,
            width: 300, maxHeight: '70vh', overflowY: 'auto',
            background: 'rgba(11,17,32,0.96)', color: '#e5e7eb',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
            padding: '12px 14px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            fontSize: 12.5, lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Material Takeoff</strong>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>

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
          <p style={{ color: '#6b7280', fontSize: 10.5, margin: '6px 0 0' }}>Estimates from the drawn model — verify against local code & waste factors.</p>
        </div>
      )}
    </>
  )
}
