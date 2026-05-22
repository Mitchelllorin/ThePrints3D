import { useMemo, useState } from 'react'

const STORAGE_KEY = 'blueprint3d-project-context-v1'

interface ProjectContextData {
  wallTypes: string
  materials: string
  constructionMetrics: string
  symbolTargets: string
  correctionNotes: string
}

const DEFAULT_DATA: ProjectContextData = {
  wallTypes: '',
  materials: '',
  constructionMetrics: '',
  symbolTargets: '',
  correctionNotes: '',
}

function loadInitial(): ProjectContextData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_DATA
    const parsed = JSON.parse(raw) as Partial<ProjectContextData>
    return {
      wallTypes: parsed.wallTypes ?? '',
      materials: parsed.materials ?? '',
      constructionMetrics: parsed.constructionMetrics ?? '',
      symbolTargets: parsed.symbolTargets ?? '',
      correctionNotes: parsed.correctionNotes ?? '',
    }
  } catch {
    return DEFAULT_DATA
  }
}

function saveData(next: ProjectContextData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore storage errors in private/restricted mode
  }
}

interface Props {
  phase: 'pre3d' | 'post3d'
}

export default function ProjectContextPanel({ phase }: Props) {
  const [data, setData] = useState<ProjectContextData>(() => loadInitial())
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const header = phase === 'pre3d'
    ? 'AI Build Context (Before 3D)'
    : 'Model Corrections & Context (After 3D)'

  const subtitle = phase === 'pre3d'
    ? 'Add known wall types, materials, and targets to improve extraction accuracy.'
    : 'Refine correction notes and target symbols while reviewing the generated model.'

  const filledCount = useMemo(
    () =>
      [data.wallTypes, data.materials, data.constructionMetrics, data.symbolTargets, data.correctionNotes]
        .filter((v) => v.trim().length > 0).length,
    [data],
  )

  const patch = (partial: Partial<ProjectContextData>) => {
    setData((prev) => {
      const next = { ...prev, ...partial }
      saveData(next)
      setSavedAt(Date.now())
      return next
    })
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{header}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{subtitle}</div>

      <label style={{ fontSize: 12, color: '#cbd5e1' }}>
        Wall types / assemblies
        <textarea
          value={data.wallTypes}
          onChange={(e) => patch({ wallTypes: e.target.value })}
          placeholder="e.g. 6 inch exterior CMU, 3-5/8 inch metal stud interior"
          rows={2}
          style={{ width: '100%', marginTop: 4, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: 8 }}
        />
      </label>

      <label style={{ fontSize: 12, color: '#cbd5e1' }}>
        Materials
        <textarea
          value={data.materials}
          onChange={(e) => patch({ materials: e.target.value })}
          placeholder="e.g. drywall layers, glazing type, framing material"
          rows={2}
          style={{ width: '100%', marginTop: 4, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: 8 }}
        />
      </label>

      <label style={{ fontSize: 12, color: '#cbd5e1' }}>
        Construction metrics
        <textarea
          value={data.constructionMetrics}
          onChange={(e) => patch({ constructionMetrics: e.target.value })}
          placeholder="e.g. floor-to-floor height, module spacing, tolerance assumptions"
          rows={2}
          style={{ width: '100%', marginTop: 4, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: 8 }}
        />
      </label>

      <label style={{ fontSize: 12, color: '#cbd5e1' }}>
        Symbol targets (doors/windows/sweeps/fixtures)
        <textarea
          value={data.symbolTargets}
          onChange={(e) => patch({ symbolTargets: e.target.value })}
          placeholder="e.g. prioritize door swings, storefront windows, floor sweeps"
          rows={2}
          style={{ width: '100%', marginTop: 4, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: 8 }}
        />
      </label>

      <label style={{ fontSize: 12, color: '#cbd5e1' }}>
        Post-3D edits / correction notes
        <textarea
          value={data.correctionNotes}
          onChange={(e) => patch({ correctionNotes: e.target.value })}
          placeholder="e.g. fix missed openings on level 2 west wall"
          rows={2}
          style={{ width: '100%', marginTop: 4, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: 8 }}
        />
      </label>

      <div style={{ fontSize: 11, color: '#94a3b8' }}>
        {filledCount}/5 fields filled
        {savedAt ? ` · saved ${new Date(savedAt).toLocaleTimeString()}` : ''}
      </div>
    </div>
  )
}
