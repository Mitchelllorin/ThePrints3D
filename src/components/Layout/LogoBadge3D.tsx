/**
 * LogoBadge3D — static extruded 3D wordmark for the top bar.
 * Orthographic camera, positions run left→right from 0 and Center does the centering.
 * Print group is X-sheared for a true italic lean — baseline stays level.
 */
import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import { Matrix4 } from 'three'
import { useUISettingsStore } from '../../store/useUISettingsStore'

const FONT = '/fonts/helvetiker_bold.typeface.json'

// Italic shear for "Print": x' = x + 0.22·y slants letter tops toward the 3D
// while y stays untouched, so the baseline lines up with Blue and 3D.
// Translation (x=0.90) is baked into the matrix since matrixAutoUpdate is off.
const PRINT_ITALIC = new Matrix4().set(
  1, 0.22, 0, 0.90,
  0, 1,    0, 0,
  0, 0,    1, 0,
  0, 0,    0, 1,
)

function Wordmark() {
  const opacity = useUISettingsStore((s) => s.logoOpacity)

  const size   = 0.40
  const height = 0.13
  const bevel  = { bevelEnabled: true, bevelSize: 0.016, bevelThickness: 0.03, bevelSegments: 4 }

  // Helvetiker Bold approximate widths at size=0.4:
  //   "Blue"  ≈ 0.92u   "Print" ≈ 1.00u   "3D" ≈ 0.34u (at size 0.272)
  // Place left-to-right from x=0, let <Center> handle centering.

  return (
    <group rotation={[0.04, 0.24, 0]}>
      <Center>
        <group>
          {/* Blue */}
          <group position={[0, 0, 0]}>
            <Text3D font={FONT} size={size} height={height} {...bevel}>
              Blue
              <meshStandardMaterial color="#60a5fa" roughness={0.2} metalness={0.3} transparent opacity={opacity} />
            </Text3D>
          </group>

          {/* Print — sheared italic, letters lean toward the 3D */}
          <group matrix={PRINT_ITALIC} matrixAutoUpdate={false}>
            <Text3D font={FONT} size={size} height={height} {...bevel}>
              Print
              <meshStandardMaterial color="#f97316" roughness={0.2} metalness={0.3} transparent opacity={opacity} />
            </Text3D>
          </group>

          {/* 3D — superscript, right after Print (offset allows for the italic lean) */}
          <group position={[1.96, 0.14, 0]}>
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
        camera={{ zoom: 75, position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent', width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 8, 5]} intensity={1.3} />
        <directionalLight position={[-3, -1, 3]} intensity={0.4} />
        <pointLight position={[0, 4, 2]} intensity={0.5} />
        <Suspense fallback={null}>
          <Wordmark />
        </Suspense>
      </Canvas>
    </div>
  )
}
