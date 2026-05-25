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
import { pushState, undo, redo, indexEditableObjects } from '../../services/editing/undoRedo'
import { useAppStore } from '../../store/useAppStore'
import type { Tool3D } from '../../types'

const TOOL_TO_MODE: Partial<Record<Tool3D, TransformMode>> = {
  select: 'translate',
  move: 'translate',
  resize: 'scale',
}

const ENABLED_TOOLS = new Set<Tool3D>(['select', 'move', 'resize'])

function useStoreTool(): Tool3D {
  return useAppStore((s) => s.activeTool)
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

export default function SelectionManager() {
  const { camera, gl, scene, pointer } = useThree()
  const controlsRef = useRef<TransformControlsImpl>(null)
  const draggingRef = useRef(false)
  const layers = useAppStore((s) => s.layers)

  const activeTool = useStoreTool()
  const selectedObj = useSelectedObj()
  const transformMode = useTransformModeState()

  const controlsEnabled = ENABLED_TOOLS.has(activeTool)

  useEffect(() => {
    const mode = TOOL_TO_MODE[activeTool] ?? 'translate'
    setTransformMode(mode)
  }, [activeTool])

  const hiddenLayerIds = useRef(new Set<string>())
  useEffect(() => {
    hiddenLayerIds.current = new Set(layers.filter((l) => !l.visible).map((l) => l.id))
  }, [layers])

  useEffect(() => {
    if (!controlsEnabled) return
    const el = gl.domElement
    const handleDown = (e: PointerEvent) => {
      if (e.button !== 0 || draggingRef.current) return
      const rect = el.getBoundingClientRect()
      const pt = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      selectAtPointer(pt, camera, scene, hiddenLayerIds.current)
    }
    el.addEventListener('pointerdown', handleDown)
    return () => el.removeEventListener('pointerdown', handleDown)
  }, [camera, scene, gl, controlsEnabled])

  useFrame(() => {
    if (!controlsEnabled) return
    const hit = castRay(pointer, camera, scene, hiddenLayerIds.current)
    setHoveredObject(hit?.object ?? null)
  })

  const handleDragStart = useCallback(() => { draggingRef.current = true }, [])
  const handleDragEnd = useCallback(() => {
    draggingRef.current = false
    const obj = getSelectedObject()
    if (obj) pushState(obj)
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const obj = getSelectedObject()
        if (obj && obj.userData.editable) {
          pushState(obj)
          obj.visible = false
          clearSelection()
        }
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => {
    indexEditableObjects(scene)
  }, [scene, layers])

  return (
    <>
      {selectedObj && controlsEnabled && (
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
