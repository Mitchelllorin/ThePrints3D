import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useUISettingsStore } from '../../store/useUISettingsStore'

export default function FloatingLogo3D() {
  const groupRef  = useRef<THREE.Group>(null)
  const innerRef  = useRef<THREE.Group>(null)
  const t         = useRef(0)

  const visible    = useUISettingsStore((s) => s.logo3DVisible)
  const opacity    = useUISettingsStore((s) => s.logo3DOpacity)
  const floatSpeed = useUISettingsStore((s) => s.logo3DFloatSpeed)
  const floatAmp   = useUISettingsStore((s) => s.logo3DFloatHeight)

  useFrame((_, delta) => {
    if (!groupRef.current || !visible) return
    t.current += delta * floatSpeed
    groupRef.current.position.y = 4 + Math.sin(t.current) * floatAmp
    if (innerRef.current) {
      innerRef.current.rotation.y += delta * 0.4
    }
  })

  if (!visible) return null

  const col = new THREE.Color('#38bdf8')

  return (
    <group ref={groupRef} position={[0, 4, 0]}>
      {/* Rotating wireframe octahedron — the "3D" icon */}
      <group ref={innerRef}>
        <mesh>
          <octahedronGeometry args={[0.7, 0]} />
          <meshBasicMaterial color={col} wireframe transparent opacity={opacity} />
        </mesh>
        {/* Inner solid for depth */}
        <mesh>
          <octahedronGeometry args={[0.5, 0]} />
          <meshBasicMaterial color={col} transparent opacity={opacity * 0.08} />
        </mesh>
      </group>

      {/* Ring below the icon */}
      <mesh position={[0, -1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.55, 0.025, 8, 32]} />
        <meshBasicMaterial color={col} transparent opacity={opacity * 0.4} />
      </mesh>

      {/* Vertical drop line */}
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 1.0, 6]} />
        <meshBasicMaterial color={col} transparent opacity={opacity * 0.25} />
      </mesh>
    </group>
  )
}
