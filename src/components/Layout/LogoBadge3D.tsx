/**
 * LogoBadge3D — static extruded 3D wordmark for the top bar.
 * Orthographic camera so we control exactly what fills the frame.
 * Slight Y rotation exposes the extrusion depth without animation.
 */
import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import { useUISettingsStore } from '../../store/useUISettingsStore'

const FONT = '/fonts/helvetiker_bold.typeface.json'

function Wordmark() {
  const opacity = useUISettingsStore((s) => s.logoOpacity)

  const size   = 0.40
  const height = 0.13
  const bevel  = { bevelEnabled: true, bevelSize: 0.016, bevelThickness: 0.03, bevelSegments: 4 }

  // Same proportional positions as FloatingLogo3D (scaled by 0.40/0.52)
  return (
    <group rotation={[0.04, 0.22, 0]}>
      <Center>
        <group>
          <group position={[-1.97, 0, 0]}>
            <Text3D font={FONT} size={size} height={height} {...bevel}>
              Blue
              <meshStandardMaterial color="#60a5fa" roughness={0.2} metalness={0.3} transparent opacity={opacity} />
            </Text3D>
          </group>
          <group position={[-0.63, 0, 0]}>
            <Text3D font={FONT} size={size} height={height} {...bevel}>
              Print
              <meshStandardMaterial color="#f97316" roughness={0.2} metalness={0.3} transparent opacity={opacity} />
            </Text3D>
          </group>
          <group position={[1.17, 0.16, 0]}>
            <Text3D font={FONT} size={size * 0.68} height={height * 0.75} {...bevel}>
              3D
              <meshStandardMaterial color="#4ade80" roughness={0.2} metalness={0.35} transparent opacity={opacity} />
            </Text3D>
          </group>
        </group>
      </Center>
    </group>
  )
}

export default function LogoBadge3D() {
  return (
    <div style={{ width: 260, height: 44, flexShrink: 0 }}>
      <Canvas
        orthographic
        camera={{ zoom: 78, position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent', width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 8, 5]} intensity={1.3} />
        <directionalLight position={[-3, -1, 3]} intensity={0.4} />
        <pointLight position={[0, 4, 2]} intensity={0.5} color="#ffffff" />
        <Suspense fallback={null}>
          <Wordmark />
        </Suspense>
      </Canvas>
    </div>
  )
}
