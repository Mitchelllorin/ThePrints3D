import { useCallback, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import type { Annotation } from '../../types'

// ─── Single annotation pin rendered in 3-D ────────────────────────────────────

interface PinProps {
  ann: Annotation
  selected: boolean
  onSelect: () => void
  onDeselect: () => void
}

function AnnotationPin({ ann, selected, onSelect, onDeselect }: PinProps) {
  return (
    <group position={ann.position}>
      {/* Spike pointing down to the surface */}
      <mesh position={[0, 0.18, 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.04, 0.22, 6]} />
        <meshBasicMaterial color={ann.color} />
      </mesh>
      {/* Sphere head of the pin */}
      <mesh position={[0, 0.44, 0]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial color={ann.color} />
      </mesh>

      {/* Floating HTML label */}
      <Html position={[0, 0.72, 0]} center distanceFactor={8} zIndexRange={[100, 200]}>
        <div
          style={{
            background: selected ? ann.color : 'rgba(15,23,42,0.92)',
            border: `2px solid ${ann.color}`,
            borderRadius: 8,
            padding: '4px 10px',
            color: selected ? '#fff' : '#f1f5f9',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'pre-wrap',
            maxWidth: 220,
            wordBreak: 'break-word',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            cursor: 'pointer',
            userSelect: 'none',
            boxShadow: selected ? `0 0 0 3px ${ann.color}55` : '0 2px 8px rgba(0,0,0,0.5)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (selected) { onDeselect() } else { onSelect() }
          }}
          title={ann.text}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>{ann.icon}</span>
          <span style={{ flex: 1 }}>{ann.text}</span>
        </div>
      </Html>
    </group>
  )
}

// ─── Main tool component ───────────────────────────────────────────────────────

interface Props {
  /** Called when the user clicks the model in annotate mode */
  onPlaceRequest: (
    position: [number, number, number],
    screenX: number,
    screenY: number,
  ) => void
}

export default function AnnotationTool({ onPlaceRequest }: Props) {
  const { raycaster, camera, scene, gl } = useThree()
  const annotateMode = useAppStore((s) => s.annotateMode)
  const annotations = useAppStore((s) => s.annotations)
  const selectedAnnotationId = useAppStore((s) => s.selectedAnnotationId)
  const setSelectedAnnotationId = useAppStore((s) => s.setSelectedAnnotationId)

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      if (!annotateMode) return

      const canvas = gl.domElement
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)

      const meshes: THREE.Mesh[] = []
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.visible) meshes.push(obj)
      })

      const hits = raycaster.intersectObjects(meshes, false)
      if (hits.length === 0) return

      const pt = hits[0].point
      onPlaceRequest([pt.x, pt.y, pt.z], e.clientX, e.clientY)
    },
    [annotateMode, raycaster, camera, scene, gl, onPlaceRequest],
  )

  useEffect(() => {
    if (!annotateMode) return
    gl.domElement.addEventListener('click', handleCanvasClick)
    return () => gl.domElement.removeEventListener('click', handleCanvasClick)
  }, [annotateMode, handleCanvasClick, gl])

  return (
    <>
      {annotations.map((ann) => (
        <AnnotationPin
          key={ann.id}
          ann={ann}
          selected={ann.id === selectedAnnotationId}
          onSelect={() => setSelectedAnnotationId(ann.id)}
          onDeselect={() => setSelectedAnnotationId(null)}
        />
      ))}
    </>
  )
}
