/**
 * FloatingLogo3D — screensaver-style wordmark bouncing around the 3D workspace.
 * "Blue" blue · "Print" orange italic · "3D" green
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { useUISettingsStore } from '../../store/useUISettingsStore'

const BOUNDS = {
  x: 7,
  yMin: 1.2,
  yMax: 5.5,
  z: 3.5,
}

// Initial velocity — randomise direction slightly so it doesn't repeat immediately
const initVel = () => new THREE.Vector3(
  1.4 + Math.random() * 0.4,
  0.7 + Math.random() * 0.3,
  0.5 + Math.random() * 0.3,
)

export default function FloatingLogo3D() {
  const groupRef   = useRef<THREE.Group>(null)
  const velocity   = useRef(initVel())

  const visible    = useUISettingsStore((s) => s.logo3DVisible)
  const opacity    = useUISettingsStore((s) => s.logo3DOpacity)
  const floatSpeed = useUISettingsStore((s) => s.logo3DFloatSpeed)

  useFrame((_, delta) => {
    if (!groupRef.current || !visible) return
    const p = groupRef.current.position
    const v = velocity.current
    const dt = delta * floatSpeed

    p.x += v.x * dt
    p.y += v.y * dt
    p.z += v.z * dt

    if (p.x >  BOUNDS.x)    { v.x = -Math.abs(v.x) }
    if (p.x < -BOUNDS.x)    { v.x =  Math.abs(v.x) }
    if (p.y >  BOUNDS.yMax) { v.y = -Math.abs(v.y) }
    if (p.y <  BOUNDS.yMin) { v.y =  Math.abs(v.y) }
    if (p.z >  BOUNDS.z)    { v.z = -Math.abs(v.z) }
    if (p.z < -BOUNDS.z)    { v.z =  Math.abs(v.z) }

    // Gentle billboard-like tilt towards camera origin
    groupRef.current.lookAt(0, p.y, 20)
  })

  if (!visible) return null

  const fs = 0.55 // font size

  return (
    <group ref={groupRef} position={[0, 3, 0]}>
      {/* "Blue" — sky blue */}
      <Text
        fontSize={fs}
        color="#60a5fa"
        anchorX="right"
        anchorY="middle"
        position={[-0.02, 0, 0]}
        fillOpacity={opacity}
        letterSpacing={-0.02}
      >
        Blue
      </Text>

      {/* "Print" — orange, italic */}
      <Text
        fontSize={fs}
        color="#f97316"
        fontStyle="italic"
        anchorX="left"
        anchorY="middle"
        position={[0.02, 0, 0]}
        fillOpacity={opacity}
        letterSpacing={-0.01}
      >
        Print
      </Text>

      {/* "3D" — green, offset right of Print */}
      <Text
        fontSize={fs * 0.75}
        color="#4ade80"
        anchorX="left"
        anchorY="top"
        position={[1.62, 0.22, 0]}
        fillOpacity={opacity}
        letterSpacing={0.01}
      >
        3D
      </Text>
    </group>
  )
}
