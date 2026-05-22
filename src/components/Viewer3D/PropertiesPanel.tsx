import { useState, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import {
  getSelectedObject,
  onSelectionChange,
  clearSelection,
} from '../../services/editing/selectionSystem'
import { pushState } from '../../services/editing/undoRedo'
import styles from './ModelViewer.module.css'

interface PropRowProps {
  label: string
  value: string
}

function PropRow({ label, value }: PropRowProps) {
  return (
    <div className={styles.propRow}>
      <span className={styles.propLabel}>{label}</span>
      <span className={styles.propValue}>{value}</span>
    </div>
  )
}

interface EditablePropRowProps {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}

function EditablePropRow({ label, value, onChange, step = 0.01 }: EditablePropRowProps) {
  const [local, setLocal] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setLocal(String(value))
  }, [value, focused])

  const handleBlur = () => {
    setFocused(false)
    const n = parseFloat(local)
    if (!isNaN(n) && n !== value) onChange(n)
    else setLocal(String(value))
  }

  return (
    <div className={styles.propRow}>
      <span className={styles.propLabel}>{label}</span>
      <input
        className={styles.propInput}
        type="number"
        step={step}
        value={local}
        onFocus={() => setFocused(true)}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') handleBlur() }}
      />
    </div>
  )
}

export default function PropertiesPanel() {
  const [selected, setSelected] = useState<THREE.Object3D | null>(() => getSelectedObject())

  useEffect(() => onSelectionChange((obj) => { setSelected(obj) }), [])

  const updatePos = useCallback((idx: number, val: number) => {
    const obj = getSelectedObject()
    if (!obj) return
    pushState(obj)
    const arr = obj.position.toArray()
    arr[idx] = val
    obj.position.set(arr[0], arr[1], arr[2])
  }, [])

  const updateRot = useCallback((idx: number, val: number) => {
    const obj = getSelectedObject()
    if (!obj) return
    pushState(obj)
    const arr = [obj.rotation.x, obj.rotation.y, obj.rotation.z]
    arr[idx] = val
    obj.rotation.set(arr[0], arr[1], arr[2])
  }, [])

  const updateScale = useCallback((idx: number, val: number) => {
    const obj = getSelectedObject()
    if (!obj) return
    pushState(obj)
    const arr = obj.scale.toArray()
    arr[idx] = val
    obj.scale.set(arr[0], arr[1], arr[2])
  }, [])

  if (!selected) {
    return (
      <aside className={styles.propertiesPanel}>
        <div className={styles.propertiesHeader}>
          <h3 className={styles.propertiesTitle}>Properties</h3>
        </div>
        <div className={styles.propertiesBody}>
          <div className={styles.propNone}>Select an object</div>
        </div>
      </aside>
    )
  }

  const ud = selected.userData
  const meta = ud.metadata ?? {}
  const pos = selected.position
  const rot = selected.rotation
  const scl = selected.scale
  const dims = meta.dimensions as { x?: number; y?: number; z?: number } | undefined

  return (
    <aside className={styles.propertiesPanel}>
      <div className={styles.propertiesHeader}>
        <h3 className={styles.propertiesTitle}>Properties</h3>
        <button className={styles.propertiesClose} onClick={clearSelection} title="Close">✕</button>
      </div>
      <div className={styles.propertiesBody}>
        {/* Type */}
        <div className={styles.propSection}>
          <div className={styles.propSectionTitle}>Type</div>
          <PropRow label="Type" value={ud.type ?? '—'} />
          <PropRow label="Layer" value={ud.layer ?? '—'} />
          {(meta.material as string) && <PropRow label="Material" value={meta.material as string} />}
          {(meta.trade as string) && <PropRow label="Trade" value={meta.trade as string} />}
        </div>

        {/* Dimensions */}
        {dims && (
          <div className={styles.propSection}>
            <div className={styles.propSectionTitle}>Dimensions</div>
            <PropRow label="Width (X)" value={dims.x?.toFixed(3) ?? '—'} />
            <PropRow label="Height (Y)" value={dims.y?.toFixed(3) ?? '—'} />
            <PropRow label="Depth (Z)" value={dims.z?.toFixed(3) ?? '—'} />
          </div>
        )}

        {/* Transform */}
        <div className={styles.propSection}>
          <div className={styles.propSectionTitle}>Position</div>
          <EditablePropRow label="X" value={pos.x} onChange={(v) => updatePos(0, v)} />
          <EditablePropRow label="Y" value={pos.y} onChange={(v) => updatePos(1, v)} />
          <EditablePropRow label="Z" value={pos.z} onChange={(v) => updatePos(2, v)} />
        </div>

        <div className={styles.propSection}>
          <div className={styles.propSectionTitle}>Rotation (rad)</div>
          <EditablePropRow label="X" value={rot.x} onChange={(v) => updateRot(0, v)} step={0.01} />
          <EditablePropRow label="Y" value={rot.y} onChange={(v) => updateRot(1, v)} step={0.01} />
          <EditablePropRow label="Z" value={rot.z} onChange={(v) => updateRot(2, v)} step={0.01} />
        </div>

        <div className={styles.propSection}>
          <div className={styles.propSectionTitle}>Scale</div>
          <EditablePropRow label="X" value={scl.x} onChange={(v) => updateScale(0, v)} step={0.1} />
          <EditablePropRow label="Y" value={scl.y} onChange={(v) => updateScale(1, v)} step={0.1} />
          <EditablePropRow label="Z" value={scl.z} onChange={(v) => updateScale(2, v)} step={0.1} />
        </div>
      </div>
    </aside>
  )
}
