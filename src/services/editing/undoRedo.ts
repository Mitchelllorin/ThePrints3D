import * as THREE from 'three'

export interface UndoEntry {
  objectId: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  visible: boolean
}

const MAX_STACK = 50
let _undoStack: UndoEntry[] = []
let _redoStack: UndoEntry[] = []
let _onChange: (() => void) | null = null
let _objectMap = new Map<string, THREE.Object3D>()

export function pushState(object: THREE.Object3D): void {
  const entry: UndoEntry = {
    objectId: object.userData.id ?? object.uuid,
    position: object.position.toArray(),
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: object.scale.toArray(),
    visible: object.visible,
  }
  _undoStack.push(entry)
  if (_undoStack.length > MAX_STACK) _undoStack.shift()
  _redoStack = []
  _onChange?.()
}

export function undo(): boolean {
  const entry = _undoStack.pop()
  if (!entry) return false
  const obj = _objectMap.get(entry.objectId) ?? findObjectInScene(entry.objectId)
  if (obj) {
    _redoStack.push({
      objectId: entry.objectId,
      position: obj.position.toArray(),
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: obj.scale.toArray(),
      visible: obj.visible,
    })
    applyEntry(obj, entry)
  }
  _onChange?.()
  return true
}

export function redo(): boolean {
  const entry = _redoStack.pop()
  if (!entry) return false
  const obj = _objectMap.get(entry.objectId) ?? findObjectInScene(entry.objectId)
  if (obj) {
    _undoStack.push({
      objectId: entry.objectId,
      position: obj.position.toArray(),
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: obj.scale.toArray(),
      visible: obj.visible,
    })
    applyEntry(obj, entry)
  }
  _onChange?.()
  return true
}

function applyEntry(obj: THREE.Object3D, entry: UndoEntry): void {
  obj.position.set(...entry.position)
  obj.rotation.set(...entry.rotation)
  obj.scale.set(...entry.scale)
  obj.visible = entry.visible
}

function findObjectInScene(id: string): THREE.Object3D | null {
  for (const [, obj] of _objectMap) {
    if (obj.userData.id === id) return obj
  }
  return null
}

export function indexEditableObjects(scene: THREE.Scene): void {
  _objectMap.clear()
  scene.traverse((child) => {
    if (child.userData.editable && child.userData.id) {
      _objectMap.set(child.userData.id, child)
    }
  })
}

export function canUndo(): boolean {
  return _undoStack.length > 0
}

export function canRedo(): boolean {
  return _redoStack.length > 0
}

export function clearUndoRedo(): void {
  _undoStack = []
  _redoStack = []
  _onChange?.()
}

export function onUndoRedoChange(cb: () => void): () => void {
  _onChange = cb
  return () => { _onChange = null }
}

export function getUndoCount(): number {
  return _undoStack.length
}

export function getRedoCount(): number {
  return _redoStack.length
}
