import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { WorkspaceWizardInputs, WizardGroupId } from '../../types'
import {
  WIZARD_GROUPS,
  getPreviousWizardGroup,
  type ProjectContextData,
} from './wizardGroups'
import {
  completeWizardGroup,
  loadWizardState,
  patchWizardData,
  saveWizardState,
  type ProjectContextWizardState,
} from './wizardState'

interface Props {
  phase: 'pre3d' | 'post3d'
}

function buildFinalInputs(data: ProjectContextData, completedGroup: WizardGroupId): WorkspaceWizardInputs {
  return {
    wallTypes: data.wallTypes.trim(),
    materials: data.materials.trim(),
    constructionMetrics: data.constructionMetrics.trim(),
    symbolTargets: data.symbolTargets.trim(),
    correctionNotes: data.correctionNotes.trim(),
    completedGroup,
    completedAt: Date.now(),
  }
}

export default function ProjectContextPanel({ phase }: Props) {
  const update3DModel = useAppStore((s) => s.update3DModel)
  const [wizard, setWizard] = useState<ProjectContextWizardState>(() => loadWizardState())

  const activeGroup = useMemo(
    () => WIZARD_GROUPS.find((group) => group.id === wizard.currentGroup) ?? WIZARD_GROUPS[0],
    [wizard.currentGroup],
  )

  const filledCount = useMemo(
    () =>
      Object.values(wizard.data)
        .filter((value) => value.trim().length > 0).length,
    [wizard.data],
  )

  const subtitlePrefix = phase === 'pre3d'
    ? 'Pre-3D context'
    : 'Post-3D correction context'

  const setAndPersist = (next: ProjectContextWizardState) => {
    saveWizardState(next)
    setWizard(next)
  }

  const patchData = (partial: Partial<ProjectContextData>) => {
    setAndPersist(patchWizardData(wizard, partial))
  }

  const jumpToGroup = (groupId: WizardGroupId) => {
    setAndPersist({ ...wizard, currentGroup: groupId, savedAt: Date.now() })
  }

  const goBack = () => {
    const previous = getPreviousWizardGroup(activeGroup.id)
    if (!previous) return
    jumpToGroup(previous)
  }

  const completeCurrentGroup = () => {
    const next = completeWizardGroup(wizard, activeGroup.id)
    setAndPersist(next)
    update3DModel(buildFinalInputs(next.data, activeGroup.id))
  }

  const isGroupComplete = (groupId: WizardGroupId) => wizard.completedGroups.includes(groupId)
  const isFinalGroup = activeGroup.id === 'group3'

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
        Unified Context Wizard · 2D → 3D
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
        {subtitlePrefix} · Complete Group 1 → Group 2 → Group 3. Each completion refreshes the 3D workspace model context.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {WIZARD_GROUPS.map((group, index) => {
          const active = group.id === activeGroup.id
          const complete = isGroupComplete(group.id)
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => jumpToGroup(group.id)}
              style={{
                borderRadius: 999,
                border: active ? '1px solid #38bdf8' : '1px solid #334155',
                background: active ? 'rgba(56,189,248,0.15)' : complete ? 'rgba(16,185,129,0.15)' : '#0f172a',
                color: active ? '#bae6fd' : complete ? '#a7f3d0' : '#cbd5e1',
                padding: '4px 10px',
                fontSize: 11,
                cursor: 'pointer',
              }}
              title={group.title}
            >
              {index + 1}. {complete ? '✓ ' : ''}{group.id.toUpperCase()}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}>{activeGroup.title}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.35 }}>{activeGroup.subtitle}</div>

      {activeGroup.fields.map((field) => (
        <label key={field.key} style={{ fontSize: 12, color: '#cbd5e1' }}>
          {field.label}
          <textarea
            value={wizard.data[field.key]}
            onChange={(e) => patchData({ [field.key]: e.target.value })}
            placeholder={field.placeholder}
            rows={field.rows}
            style={{
              width: '100%',
              marginTop: 4,
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#e2e8f0',
              padding: 8,
            }}
          />
        </label>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={goBack}
          disabled={activeGroup.id === 'group1'}
          style={{
            background: activeGroup.id === 'group1' ? '#0f172a' : '#1e293b',
            color: activeGroup.id === 'group1' ? '#64748b' : '#e2e8f0',
            border: '1px solid #334155',
            padding: '6px 10px',
            borderRadius: 8,
            cursor: activeGroup.id === 'group1' ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          ← Previous Group
        </button>
        <button
          type="button"
          onClick={completeCurrentGroup}
          style={{
            background: '#0ea5e9',
            color: '#082f49',
            border: 'none',
            padding: '6px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {isFinalGroup ? 'Complete Group 3 + Update 3D' : 'Complete Group + Update 3D →'}
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8' }}>
        {filledCount}/5 fields filled · {wizard.completedGroups.length}/3 groups completed
        {wizard.savedAt ? ` · saved ${new Date(wizard.savedAt).toLocaleTimeString()}` : ''}
      </div>
    </div>
  )
}
