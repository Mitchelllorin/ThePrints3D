import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { WizardGroupId } from '../../types'
import {
  WIZARD_GROUPS,
  getPreviousWizardGroup,
} from './wizardGroups'

interface Props {
  phase: 'pre3d' | 'post3d'
}

export default function ProjectContextPanel({ phase }: Props) {
  const wizard = useAppStore((s) => s.wizardState)
  const updateWizardData = useAppStore((s) => s.updateWizardData)
  const jumpToWizardGroup = useAppStore((s) => s.jumpToWizardGroup)
  const completeWizardGroup = useAppStore((s) => s.completeWizardGroup)
  const resetWizard = useAppStore((s) => s.resetWizard)

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
    ? '3D-first setup'
    : 'Live 3D construction context'

  const jumpToGroup = (groupId: WizardGroupId) => {
    const targetIndex = WIZARD_GROUPS.findIndex((group) => group.id === groupId)
    const highestCompletedIndex = Math.max(
      -1,
      ...wizard.completedGroups.map((completedId) => WIZARD_GROUPS.findIndex((group) => group.id === completedId)),
    )
    if (targetIndex > highestCompletedIndex + 1) return
    jumpToWizardGroup(groupId)
  }

  const goBack = () => {
    const previous = getPreviousWizardGroup(activeGroup.id)
    if (!previous) return
    jumpToGroup(previous)
  }

  const handleCompleteCurrentGroup = () => {
    const missing = activeGroup.fields.some((field) => wizard.data[field.key].trim().length === 0)
    if (missing) return
    completeWizardGroup(activeGroup.id)
  }

  const isGroupComplete = (groupId: WizardGroupId) => wizard.completedGroups.includes(groupId)
  const isFinalGroup = activeGroup.id === 'group3'

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
        Unified Construction Wizard
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
        {subtitlePrefix} · Complete Set 1 → Set 2 → Set 3 to drive the live 3D workspace.
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
              disabled={index > Math.max(0, wizard.completedGroups.length)}
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
          <ul style={{ marginTop: 6, marginBottom: 6, paddingLeft: 18, color: '#94a3b8', lineHeight: 1.3 }}>
            {field.subQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          <textarea
            value={wizard.data[field.key]}
            onChange={(e) => updateWizardData({ [field.key]: e.target.value })}
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
          ← Previous Set
        </button>
        <button
          type="button"
          onClick={handleCompleteCurrentGroup}
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
          {isFinalGroup ? 'Complete Set 3 + Update 3D' : 'Complete Set + Update 3D →'}
        </button>
        <button
          type="button"
          onClick={resetWizard}
          style={{
            background: '#1e293b',
            color: '#fca5a5',
            border: '1px solid #334155',
            padding: '6px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Cancel wizard
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8' }}>
        {filledCount}/6 fields filled · {wizard.completedGroups.length}/3 sets completed
        {wizard.savedAt ? ` · saved ${new Date(wizard.savedAt).toLocaleTimeString()}` : ''}
      </div>
    </div>
  )
}
