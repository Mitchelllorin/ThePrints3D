/**
 * FloatingLogo3D — extruded 3D wordmark bouncing around the workspace.
 * Blue(blue) Print(orange) 3D(green) — all same size, actual geometry depth.
 */
import { useRef, Suspense } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import * as THREE from 'three'
import { useUISettingsStore } from '../../store/useUISettingsStore'

const FONT_URL = '/fonts/helvetiker_bold.typeface.json'

const BOUNDS = { x: 7, yMin: 1.5, yMax: 5.5, z: 3.5 }

function randomSign() { return Math.random() > 0.5 ? 1 : -1 }
const initVel = () => new THREE.Vector3(
  randomSign() * (1.2 + Math.random() * 0.4),
  randomSign() * (0.6 + Math.random() * 0.3),
  randomSign() * (0.4 + Math.random() * 0.2),
)

function WordmarkMesh({ opacity }: { opacity: number }) {
  const size   = 0.52
  const height = 0.14
  const bevel  = { bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.04, bevelSegments: 4 }

  return (
    // Wrap in a group so all three words move as one unit when the group bounces
    <group>
      {/* "Blue" */}
      <group position={[-2.6, 0, 0]}>
        <Text3D font={FONT_URL} size={size} height={height} {...bevel}>
          Blue
          <meshStandardMaterial color="#60a5fa" roughness={0.3} metalness={0.2} transparent opacity={opacity} />
        </Text3D>
      </group>

      {/* "Print" — italic skew via rotation */}
      <group position={[-0.82, 0, 0]} rotation={[0, 0, 0]}>
        <Text3D font={FONT_URL} size={size} height={height} {...bevel}>
          Print
          <meshStandardMaterial color="#f97316" roughness={0.3} metalness={0.2} transparent opacity={opacity} />
        </Text3D>
      </group>

      {/* "3D" — same size, slightly elevated */}
      <group position={[1.62, 0.22, 0]}>
        <Text3D font={FONT_URL} size={size * 0.72} height={height * 0.8} {...bevel}>
          3D
          <meshStandardMaterial color="#4ade80" roughness={0.3} metalness={0.3} transparent opacity={opacity} />
        </Text3D>
      </group>
    </group>
  )
}

export default function FloatingLogo3D() {
  const groupRef = useRef<THREE.Group>(null)
  const velocity = useRef(initVel())

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

    if (p.x >  BOUNDS.x)    v.x = -Math.abs(v.x)
    if (p.x < -BOUNDS.x)    v.x =  Math.abs(v.x)
    if (p.y >  BOUNDS.yMax) v.y = -Math.abs(v.y)
    if (p.y <  BOUNDS.yMin) v.y =  Math.abs(v.y)
    if (p.z >  BOUNDS.z)    v.z = -Math.abs(v.z)
    if (p.z < -BOUNDS.z)    v.z =  Math.abs(v.z)

    // Face generally towards camera
    groupRef.current.lookAt(0, p.y, 20)
  })

  if (!visible) return null

  return (
    <group ref={groupRef} position={[0, 3, 0]}>
      <Suspense fallback={null}>
        <Center>
          <WordmarkMesh opacity={opacity} />
        </Center>
      </Suspense>
    </group>
  )
}
