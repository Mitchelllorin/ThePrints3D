/**
 * WallEditorController
 *
 * Lives inside the R3F <Canvas>. When editMode is active, it:
 *  - Intercepts pointer events on the WebGL canvas
 *  - Raycasts to find wall meshes tagged with userData.wallKey
 *  - Sets selectedWallKey in the store on click
 *  - Allows dragging the selected wall in the XZ plane (live preview + commit on release)
 *  - Renders a wireframe selection box around the selected wall
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { useAppStore } from '../../store/useAppStore'

const DEFAULT_SCALE_MM_PER_PX = 23.5

/** Collect all wall meshes from the scene */
function collectWallMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && typeof obj.userData.wallKey === 'string') {
      meshes.push(obj)
    }
  })
  return meshes
}

/** Compute NDC (-1..1) from a PointerEvent relative to the canvas element */
function toNDC(event: PointerEvent, el: HTMLElement): THREE.Vector2 {
  const rect = el.getBoundingClientRect()
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
}

/** Project NDC to the XZ plane at a given Y elevation */
function projectToXZPlane(
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  planeY: number,
): THREE.Vector3 | null {
  raycaster.setFromCamera(ndc, camera)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
  const target = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(plane, target)
  return hit ? target.clone() : null
}

export default function WallEditorController() {
  const { camera, scene, raycaster, gl } = useThree()

  const editMode = useAppStore((s) => s.editMode)
  const selectedWallKey = useAppStore((s) => s.selectedWallKey)
  const drawings = useAppStore((s) => s.drawings)
  const setSelectedWallKey = useAppStore((s) => s.setSelectedWallKey)
  const updateParsedWall = useAppStore((s) => s.updateParsedWall)

  // Keep refs for stale-closure safety inside event handlers
  const editModeRef = useRef(editMode)
  const selectedWallKeyRef = useRef(selectedWallKey)
  const drawingsRef = useRef(drawings)
  useEffect(() => { editModeRef.current = editMode }, [editMode])
  useEffect(() => { selectedWallKeyRef.current = selectedWallKey }, [selectedWallKey])
  useEffect(() => { drawingsRef.current = drawings }, [drawings])

  // Selection wireframe helper
  const boxHelperRef = useRef<THREE.BoxHelper | null>(null)

  // Drag state
  const isDragging = useRef(false)
  const dragPlaneY = useRef(0)
  const dragStartWorld = useRef<THREE.Vector3 | null>(null)
  const dragMeshStartPos = useRef<THREE.Vector3 | null>(null)
  const dragMeshRef = useRef<THREE.Mesh | null>(null)
  const dragDrawingId = useRef<string>('')
  const dragWallIndex = useRef<number>(-1)
  const dragInitialWall = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  useEffect(() => {
    const dom = gl.domElement

    function onPointerDown(e: PointerEvent) {
      if (!editModeRef.current) return

      const ndc = toNDC(e, dom)
      raycaster.setFromCamera(ndc, camera)
      const wallMeshes = collectWallMeshes(scene)
      const hits = raycaster.intersectObjects(wallMeshes, false)

      if (hits.length === 0) {
        // Clicked empty space — deselect
        setSelectedWallKey(null)
        return
      }

      const hitMesh = hits[0].object as THREE.Mesh
      const wallKey = hitMesh.userData.wallKey as string

      setSelectedWallKey(wallKey)

      // Start drag
      dragPlaneY.current = hitMesh.position.y
      const worldHit = projectToXZPlane(ndc, camera, raycaster, dragPlaneY.current)
      if (!worldHit) return

      isDragging.current = true
      dragStartWorld.current = worldHit.clone()
      dragMeshStartPos.current = hitMesh.position.clone()
      dragMeshRef.current = hitMesh
      dragDrawingId.current = hitMesh.userData.wallDrawingId as string
      dragWallIndex.current = hitMesh.userData.wallIndex as number

      const drawing = drawingsRef.current.find((d) => d.id === dragDrawingId.current)
      const wall = drawing?.parsedWalls[dragWallIndex.current]
      if (wall) {
        dragInitialWall.current = { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 }
      }

      dom.setPointerCapture(e.pointerId)
      // Prevent OrbitControls from receiving this event
      e.stopPropagation()
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDragging.current || !dragStartWorld.current || !dragMeshRef.current) return

      const ndc = toNDC(e, dom)
      const current = projectToXZPlane(ndc, camera, raycaster, dragPlaneY.current)
      if (!current || !dragMeshStartPos.current) return

      const delta = current.clone().sub(dragStartWorld.current)
      // Live preview: translate the mesh directly
      dragMeshRef.current.position.x = dragMeshStartPos.current.x + delta.x
      dragMeshRef.current.position.z = dragMeshStartPos.current.z + delta.z

      // Keep BoxHelper in sync
      boxHelperRef.current?.update()

      e.stopPropagation()
    }

    function onPointerUp(e: PointerEvent) {
      if (!isDragging.current) return

      const ndc = toNDC(e, dom)
      const current = projectToXZPlane(ndc, camera, raycaster, dragPlaneY.current)

      if (current && dragStartWorld.current && dragInitialWall.current) {
        const delta = current.clone().sub(dragStartWorld.current)
        const drawing = drawingsRef.current.find((d) => d.id === dragDrawingId.current)
        const mmPerPx = drawing?.scaleMmPerPx ?? DEFAULT_SCALE_MM_PER_PX
        // Convert metres → pixels
        const dxPx = delta.x * 1000 / mmPerPx
        const dzPx = delta.z * 1000 / mmPerPx  // world Z → drawing Y

        updateParsedWall(dragDrawingId.current, dragWallIndex.current, {
          x1: dragInitialWall.current.x1 + dxPx,
          y1: dragInitialWall.current.y1 + dzPx,
          x2: dragInitialWall.current.x2 + dxPx,
          y2: dragInitialWall.current.y2 + dzPx,
        })
      }

      isDragging.current = false
      dragStartWorld.current = null
      dragMeshStartPos.current = null
      dragMeshRef.current = null
      dragInitialWall.current = null

      dom.releasePointerCapture(e.pointerId)
      e.stopPropagation()
    }

    dom.addEventListener('pointerdown', onPointerDown, true)
    dom.addEventListener('pointermove', onPointerMove, true)
    dom.addEventListener('pointerup', onPointerUp, true)

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, true)
      dom.removeEventListener('pointermove', onPointerMove, true)
      dom.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [camera, scene, raycaster, gl, setSelectedWallKey, updateParsedWall])

  // Manage the BoxHelper selection outline
  useEffect(() => {
    // Remove old helper
    if (boxHelperRef.current) {
      scene.remove(boxHelperRef.current)
      boxHelperRef.current.dispose()
      boxHelperRef.current = null
    }

    if (!selectedWallKey || !editMode) return

    // Find the selected mesh
    const wallMeshes = collectWallMeshes(scene)
    const mesh = wallMeshes.find((m) => m.userData.wallKey === selectedWallKey)
    if (!mesh) return

    const helper = new THREE.BoxHelper(mesh, new THREE.Color('#f59e0b'))
    scene.add(helper)
    boxHelperRef.current = helper

    return () => {
      scene.remove(helper)
      helper.dispose()
      boxHelperRef.current = null
    }
  }, [selectedWallKey, editMode, scene])

  // Keep BoxHelper updated when mesh moves
  useFrame(() => {
    boxHelperRef.current?.update()
  })

  return null
}
