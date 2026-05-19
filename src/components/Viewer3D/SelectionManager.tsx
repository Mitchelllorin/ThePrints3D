import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import {
  getSelectedObject,
  clearSelection,
  setHoveredObject,
  castRay,
  selectAtPointer,
  onSelectionChange,
} from '../../services/editing/selectionSystem'
import {
  getTransformMode,
  setTransformMode,
  onTransformModeChange,
  type TransformMode,
} from '../../services/editing/transformControls'
import {
  getActiveTool,
  handleToolHotkey,
  onToolChange,
  type ToolId,
} from '../../services/editing/toolSystem'
import { pushState, undo, redo, indexEditableObjects } from '../../services/editing/undoRedo'
import { useAppStore } from '../../store/useAppStore'

// ─── Auto-track all editable objects for undo ──────────────────────────────

export { indexEditableObjects } from '../../services/editing/undoRedo'

// ─── React hooks for service state ─────────────────────────────────────────

function useTool(): ToolId {
  const [tool, setTool] = useState<ToolId>(() => getActiveTool())
  useEffect(() => onToolChange(setTool), [])
  return tool
}

function useSelectedObj(): THREE.Object3D | null {
  const [obj, setObj] = useState<THREE.Object3D | null>(() => getSelectedObject())
  useEffect(() => onSelectionChange(setObj), [])
  return obj
}

function useTransformModeState(): TransformMode {
  const [mode, setMode] = useState<TransformMode>(() => getTransformMode())
  useEffect(() => onTransformModeChange(setMode), [])
  return mode
}

// ─── Tool → transform mode mapping ─────────────────────────────────────────

const TOOL_TO_MODE: Record<ToolId, TransformMode> = {
  select: 'translate',
  move: 'translate',
  rotate: 'rotate',
  scale: 'scale',
  delete: 'translate',
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function SelectionManager() {
  const { camera, gl, scene, pointer } = useThree()
  const controlsRef = useRef<TransformControlsImpl>(null)
  const draggingRef = useRef(false)
  const layers = useAppStore((s) => s.layers)

  const activeTool = useTool()
  const selectedObj = useSelectedObj()
  const transformMode = useTransformModeState()

  // Sync tool → transform mode
  useEffect(() => {
    setTransformMode(TOOL_TO_MODE[activeTool])
  }, [activeTool])

  // Build hidden layer set
  const hiddenLayerIds = useRef(new Set<string>())
  useEffect(() => {
    hiddenLayerIds.current = new Set(layers.filter((l) => !l.visible).map((l) => l.id))
  }, [layers])

  // ─── Click selection ──────────────────────────────────────────────────
  useEffect(() => {
    const el = gl.domElement
    const handleDown = (e: PointerEvent) => {
      if (e.button !== 0 || draggingRef.current) return
      const rect = el.getBoundingClientRect()
      const pt = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      if (activeTool === 'delete') {
        const hit = castRay(pt, camera, scene, hiddenLayerIds.current)
        if (hit?.object?.userData?.editable) {
          pushState(hit.object)
          hit.object.visible = false
          clearSelection()
        }
        return
      }
      selectAtPointer(pt, camera, scene, hiddenLayerIds.current)
    }
    el.addEventListener('pointerdown', handleDown)
    return () => el.removeEventListener('pointerdown', handleDown)
  }, [camera, scene, gl, activeTool])

  // ─── Hover on each frame ──────────────────────────────────────────────
  useFrame(() => {
    if (activeTool === 'delete') {
      const hit = castRay(pointer, camera, scene, hiddenLayerIds.current)
      setHoveredObject(hit?.object ?? null)
      return
    }
    const hit = castRay(pointer, camera, scene, hiddenLayerIds.current)
    setHoveredObject(hit?.object ?? null)
  })

  // ─── Transform drag → push undo ───────────────────────────────────────
  const handleDragStart = useCallback(() => { draggingRef.current = true }, [])
  const handleDragEnd = useCallback(() => {
    draggingRef.current = false
    const obj = getSelectedObject()
    if (obj) pushState(obj)
  }, [])

  // ─── Keyboard hotkeys ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Undo (Ctrl+Z / Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      // Redo (Ctrl+Y / Cmd+Y)
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        redo()
        return
      }
      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const obj = getSelectedObject()
        if (obj && obj.userData.editable) {
          pushState(obj)
          obj.visible = false
          clearSelection()
        }
        return
      }
      // Tool hotkeys
      handleToolHotkey(e.key)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // ─── Re-index when scene changes ──────────────────────────────────────
  useEffect(() => {
    indexEditableObjects(scene)
  }, [scene, layers])

  return (
    <>
      {selectedObj && (
        <TransformControls
          ref={controlsRef}
          object={selectedObj}
          mode={transformMode}
          onMouseDown={handleDragStart}
          onMouseUp={handleDragEnd}
        />
      )}
    </>
  )
}
