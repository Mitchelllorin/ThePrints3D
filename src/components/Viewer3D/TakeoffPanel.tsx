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
import { computeTakeoff, takeoffToCsv } from '../../services/takeoff'
import { builtScene, countBuiltMembers, groupBuiltMembers } from '../../services/builtScene'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'
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
  const isPro = useAppStore((s) => s.isPro)
  const openUpgrade = useFloorplanLocalStore((s) => s.openUpgrade)

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

  // FREE SEES THE FIRST SECTION, IN FULL AND IN FOCUS.
  // A takeoff you cannot read is not a preview, it is an advert. The first
  // section is real, exact, and usable — enough to prove the numbers are worth
  // paying for — and the rest sits behind the unlock. Blurring the whole list
  // would only prove the app has a list.
  const shownSections = isPro ? sections : sections.slice(0, 1)
  const lockedSections = isPro ? [] : sections.slice(1)
  const lockedCount = lockedSections.reduce((n, s) => n + s.items.length, 0)
    + (isPro ? 0 : built.length)

  const exportCsv = () => {
    const csv = takeoffToCsv(sections, groupBuiltMembers(built))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `theprints3d-takeoff-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#e5e7eb' }}>
      {empty ? (
        <p style={{ color: '#9ca3af', margin: 0 }}>Nothing drawn yet — trace walls, floors, or trades and the counts appear here.</p>
      ) : (
        shownSections.map((sec) => (
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
      {/* THE LOCKED REMAINDER — blurred, unreadable, and unmistakably there.
          One tap opens the upgrade sheet; the blur is not a control, so it
          takes no pointers of its own and nothing behind it can be fished out
          by selecting the text. */}
      {!isPro && lockedCount > 0 && (
        <div style={{ position: 'relative', marginTop: 10 }}>
          <div
            aria-hidden
            style={{
              filter: 'blur(4.5px)',
              opacity: 0.55,
              pointerEvents: 'none',
              userSelect: 'none',
              maxHeight: 108,
              overflow: 'hidden',
            }}
          >
            {lockedSections.map((sec) => (
              <div key={sec.title} style={{ marginBottom: 10 }}>
                <div style={{ color: '#f97316', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>{sec.title}</div>
                {sec.items.map((it) => (
                  <div key={it.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: '#cbd5e1' }}>{it.label}</span>
                    <span style={{ color: '#fff' }}>{it.quantity} {it.unit}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button
            onClick={() => openUpgrade('The full material takeoff')}
            style={{
              position: 'absolute', inset: 0, width: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              background: 'linear-gradient(rgba(10,16,30,0.1), rgba(10,16,30,0.82))',
              border: 'none', borderRadius: 8, cursor: 'pointer', padding: 0,
            }}
          >
            <span style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 700 }}>
              {lockedCount} more {lockedCount === 1 ? 'line' : 'lines'}
            </span>
            <span style={{ color: '#38bdf8', fontSize: 11, fontWeight: 700 }}>Unlock the full takeoff + CSV</span>
          </button>
        </div>
      )}

      {isPro && built.length > 0 && (
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
      {/* Export is the point of a takeoff — it leaves the phone and goes to a
          supplier. Pro only, and only once there is something to send. */}
      {isPro && !empty && (
        <button
          onClick={exportCsv}
          style={{
            marginTop: 10, width: '100%', padding: '8px 10px',
            background: 'none', border: '1px solid rgba(56,189,248,0.45)', borderRadius: 8,
            color: '#38bdf8', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
          }}
        >Export takeoff (CSV)</button>
      )}
      <p style={{ color: '#6b7280', fontSize: 10.5, margin: '6px 0 0' }}>Estimates from the drawn model — verify against local code &amp; waste factors.</p>
    </div>
  )
}
