import * as THREE from 'three'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EditableUserData {
  id: string
  type: string
  layer: string
  editable: true
  metadata: {
    dimensions?: { x: number; y: number; z: number }
    material?: string
    trade?: string
    connections?: string[]
    [key: string]: unknown
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

let _selectedObject: THREE.Object3D | null = null
let _hoveredObject: THREE.Object3D | null = null
let _onSelectionChange: ((obj: THREE.Object3D | null) => void) | null = null
const _selectionListeners: Set<() => void> = new Set()

// ─── Public API ──────────────────────────────────────────────────────────────

export function getSelectedObject(): THREE.Object3D | null {
  return _selectedObject
}

export function setSelectedObject(obj: THREE.Object3D | null): void {
  if (_selectedObject === obj) return
  if (_selectedObject) restoreMaterial(_selectedObject)
  _selectedObject = obj
  if (obj) {
    saveMaterialState(obj)
    applyEmissive(obj, 0x38bdf8, 0.5)
  }
  _onSelectionChange?.(obj)
  _selectionListeners.forEach((fn) => fn())
}

export function clearSelection(): void {
  setSelectedObject(null)
}

export function onSelectionChange(cb: (obj: THREE.Object3D | null) => void): () => void {
  _onSelectionChange = cb
  return () => { _onSelectionChange = null }
}

export function subscribeSelection(fn: () => void): () => void {
  _selectionListeners.add(fn)
  return () => _selectionListeners.delete(fn)
}

// ─── Hover ───────────────────────────────────────────────────────────────────

export function setHoveredObject(obj: THREE.Object3D | null): void {
  if (_hoveredObject === obj) return
  if (_hoveredObject && _hoveredObject !== _selectedObject) restoreMaterial(_hoveredObject)
  _hoveredObject = obj
  if (obj && obj !== _selectedObject) {
    saveMaterialState(obj)
    applyEmissive(obj, 0x3b82f6, 0.3)
  }
}

export function getHoveredObject(): THREE.Object3D | null {
  return _hoveredObject
}

// ─── Raycasting ──────────────────────────────────────────────────────────────

const _raycaster = new THREE.Raycaster()

export function castRay(
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  scene: THREE.Scene,
  hiddenLayerIds: Set<string>,
): THREE.Intersection | null {
  _raycaster.setFromCamera(pointer, camera)
  const candidates: THREE.Object3D[] = []
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.userData.editable) {
      const layer = mesh.userData.layer as string | undefined
      if (layer && hiddenLayerIds.has(layer)) return
      candidates.push(mesh)
    }
  })
  const hits = _raycaster.intersectObjects(candidates, false)
  return hits.length > 0 ? hits[0] : null
}

export function selectAtPointer(
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  scene: THREE.Scene,
  hiddenLayerIds: Set<string>,
): THREE.Object3D | null {
  const hit = castRay(pointer, camera, scene, hiddenLayerIds)
  if (hit?.object?.userData?.editable) {
    setSelectedObject(hit.object)
    return hit.object
  }
  clearSelection()
  return null
}

// ─── Material helpers ────────────────────────────────────────────────────

function saveMaterialState(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh
  if (!mesh.material) return
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const m of mats) {
    const mat = m as THREE.MeshStandardMaterial
    if (mat.userData._savedEditor) continue
    mat.userData._savedEditor = true
    mat.userData._origColor = mat.color?.getHex?.()
    mat.userData._origEmissive = mat.emissive?.getHex?.()
    mat.userData._origEmissiveIntensity = mat.emissiveIntensity
  }
}

function restoreMaterial(obj: THREE.Object3D): void {
  const mesh = obj as THREE.Mesh
  if (!mesh.material) return
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const m of mats) {
    const mat = m as THREE.MeshStandardMaterial
    if (mat.userData._origColor !== undefined) mat.color?.setHex(mat.userData._origColor)
    if (mat.userData._origEmissive !== undefined) mat.emissive?.setHex(mat.userData._origEmissive)
    if (mat.userData._origEmissiveIntensity !== undefined) mat.emissiveIntensity = mat.userData._origEmissiveIntensity
    delete mat.userData._savedEditor
  }
}

function applyEmissive(obj: THREE.Object3D, color: number, intensity: number): void {
  const mesh = obj as THREE.Mesh
  if (!mesh.material) return
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const m of mats) {
    const mat = m as THREE.MeshStandardMaterial
    if (mat.emissive) {
      mat.emissive.setHex(color)
      mat.emissiveIntensity = intensity
    }
  }
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

export function disposeSelectionSystem(): void {
  clearSelection()
  _hoveredObject = null
  _onSelectionChange = null
  _selectionListeners.clear()
}
