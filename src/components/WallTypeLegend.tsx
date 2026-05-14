import { useState } from 'react'
import type { WallType } from '../types'

interface Props {
  types: WallType[]
  onUpdateTypes: (types: WallType[]) => void
  detectedIds?: string[]
}

export default function WallTypeLegend({ types, onUpdateTypes, detectedIds = [] }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [newThickness, setNewThickness] = useState('100')
  const [editingId, setEditingId] = useState<string | null>(null)

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  const addType = () => {
    if (!newId.trim()) return
    const id = newId.trim().toUpperCase()
    if (types.some((t) => t.id === id)) return
    const wt: WallType = {
      id,
      name: newName.trim() || id,
      thicknessMm: parseFloat(newThickness) || 100,
      layers: [],
      loadBearing: false,
      usage: 'interior',
      markupTag: id,
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
    }
    onUpdateTypes([...types, wt])
    setNewId('')
    setNewName('')
  }

  const removeType = (id: string) => onUpdateTypes(types.filter((t) => t.id !== id))

  const updateType = (id: string, patch: Partial<WallType>) =>
    onUpdateTypes(types.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return (
    <div style={{
      background: '#1a1a2e',
      color: '#e0e0e0',
      fontFamily: "'Courier New', monospace",
      fontSize: 13,
      padding: 12,
      borderRadius: 8,
      maxHeight: 400,
      overflowY: 'auto',
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#ffd700' }}>
        WALL TYPE LEGEND
      </div>

      {types.map((t) => (
        <div key={t.id} style={{
          border: `1px solid ${detectedIds.includes(t.id) ? '#ffd700' : '#333'}`,
          borderRadius: 4,
          marginBottom: 4,
          background: detectedIds.includes(t.id) ? 'rgba(255,215,0,0.08)' : 'transparent',
        }}>
          <div
            onClick={() => toggle(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 'bold' }}>{t.id}</span>
            <span style={{ color: '#999', flex: 1 }}>{t.name}</span>
            {t.loadBearing && <span style={{ fontSize: 10, color: '#ff6b6b' }}>LB</span>}
            <span style={{ fontSize: 10, color: '#aaa' }}>{t.usage}</span>
            <span style={{ fontSize: 10, color: '#888' }}>{t.thicknessMm}mm</span>
            {detectedIds.includes(t.id) && <span style={{ color: '#ffd700', fontSize: 11 }}>DETECTED</span>}
          </div>

          {!collapsed[t.id] && (
            <div style={{ padding: '2px 6px 6px' }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>
                Finished &rarr; Framing: {finishedToFraming(t)}
              </div>
              {t.layers.length > 0 && (
                <div style={{ marginLeft: 8, fontSize: 11 }}>
                  {t.layers.map((l, i) => (
                    <div key={i} style={{ color: '#bbb' }}>
                      &middot; {l.name} ({l.thicknessMm}mm, {l.material})
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                <button onClick={() => setEditingId(editingId === t.id ? null : t.id)} style={btnStyle}>
                  {editingId === t.id ? 'Done' : 'Edit'}
                </button>
                <button onClick={() => removeType(t.id)} style={{ ...btnStyle, color: '#ff6b6b' }}>
                  Remove
                </button>
              </div>

              {editingId === t.id && (
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: '#aaa' }}>
                    Layers (comma-sep: name,thickness,material)
                  </label>
                  <input
                    style={inputStyle}
                    defaultValue={t.layers.map((l) => `${l.name},${l.thicknessMm},${l.material}`).join('; ')}
                    onBlur={(e) => {
                      const layers = e.target.value.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
                        const parts = s.split(',').map((p) => p.trim())
                        return { name: parts[0] || 'Unknown', thicknessMm: parseFloat(parts[1]) || 10, material: parts[2] || 'unknown' }
                      })
                      updateType(t.id, { layers })
                    }}
                  />
                  <label style={{ fontSize: 11, color: '#aaa' }}>Thickness (mm)</label>
                  <input
                    style={inputStyle}
                    defaultValue={t.thicknessMm}
                    onBlur={(e) => updateType(t.id, { thicknessMm: parseFloat(e.target.value) || 100 })}
                  />
                  <label style={{ fontSize: 11, color: '#aaa' }}>
                    <input
                      type="checkbox"
                      defaultChecked={t.loadBearing}
                      onChange={(e) => updateType(t.id, { loadBearing: e.target.checked })}
                    /> Load-bearing
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 12, borderTop: '1px solid #333', paddingTop: 8 }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>ADD WALL TYPE</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <input placeholder="ID (e.g. SW)" style={{ ...inputStyle, width: 70 }} value={newId}
            onChange={(e) => setNewId(e.target.value)} />
          <input placeholder="Name" style={{ ...inputStyle, width: 100 }} value={newName}
            onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="mm" style={{ ...inputStyle, width: 50 }} value={newThickness}
            onChange={(e) => setNewThickness(e.target.value)} />
          <button onClick={addType} style={{ ...btnStyle, background: '#2ecc71', color: '#000' }}>Add</button>
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: '#333', color: '#ccc', border: '1px solid #555',
  borderRadius: 3, fontSize: 11, padding: '2px 8px', cursor: 'pointer',
}

const inputStyle: React.CSSProperties = {
  background: '#16213e', color: '#e0e0e0', border: '1px solid #444',
  borderRadius: 3, padding: '2px 6px', fontSize: 11,
  fontFamily: "'Courier New', monospace",
}

function finishedToFraming(t: WallType): string {
  const totalFinish = t.layers
    .filter((l) => l.material === 'gypsum' || l.material === 'plaster')
    .reduce((sum, l) => sum + l.thicknessMm, 0)
  const framingMm = t.thicknessMm - totalFinish
  return `Fin ${totalFinish}mm + Framing ${Math.max(0, framingMm)}mm`
}
