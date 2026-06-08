/**
 * LogoBadge3D — the same extruded wordmark as FloatingLogo3D,
 * rendered in a small inline R3F canvas for the top bar.
 */
import { Suspense, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import { useUISettingsStore } from '../../store/useUISettingsStore'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

const FONT = '/fonts/helvetiker_bold.typeface.json'

function Wordmark() {
  const opacity = useUISettingsStore((s) => s.logoOpacity)
  const groupRef = useRef<THREE.Group>(null)

  // Gentle idle rotation so it reads as 3D
  useFrame((_, delta) => {
    if (!groupRef.current) return
    groupRef.current.rotation.y = Math.sin(Date.now() / 3000) * 0.18
    groupRef.current.rotation.x = Math.sin(Date.now() / 4500) * 0.06
  })

  const size   = 0.38
  const height = 0.12
  const bevel  = { bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.03, bevelSegments: 3 }

  return (
    <group ref={groupRef}>
      <Center>
        <group>
          {/* Blue */}
          <group position={[-1.92, 0, 0]}>
            <Text3D font={FONT} size={size} height={height} {...bevel}>
              Blue
              <meshStandardMaterial color="#60a5fa" roughness={0.25} metalness={0.25} transparent opacity={opacity} />
            </Text3D>
          </group>
          {/* Print */}
          <group position={[-0.6, 0, 0]}>
            <Text3D font={FONT} size={size} height={height} {...bevel}>
              Print
              <meshStandardMaterial color="#f97316" roughness={0.25} metalness={0.25} transparent opacity={opacity} />
            </Text3D>
          </group>
          {/* 3D */}
          <group position={[1.19, 0.16, 0]}>
            <Text3D font={FONT} size={size * 0.68} height={height * 0.75} {...bevel}>
              3D
              <meshStandardMaterial color="#4ade80" roughness={0.25} metalness={0.3} transparent opacity={opacity} />
            </Text3D>
          </group>
        </group>
      </Center>
    </group>
  )
}

export default function LogoBadge3D() {
  return (
    <div style={{ width: 200, height: 36, flexShrink: 0 }}>
      <Canvas
        camera={{ position: [0, 0, 3.2], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 4]} intensity={1.2} />
        <directionalLight position={[-3, -2, 2]} intensity={0.3} />
        <Suspense fallback={null}>
          <Wordmark />
        </Suspense>
      </Canvas>
    </div>
  )
}
