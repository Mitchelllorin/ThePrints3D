/**
 * FloatingLogo3D — the extruded 3D wordmark, pinned to the TOP-LEFT of the view
 * (it's literally the brand: The·PRINTS·3D). It tracks the camera so it stays in
 * the corner as you orbit, and rocks gently back and forth to show its depth.
 *
 * The(blue) PRINTS(orange, sheared italic toward the 3D) 3D(green).
 */
import { useRef, useMemo, useLayoutEffect, Suspense, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text3D, useFont } from '@react-three/drei'
import * as THREE from 'three'
import { useUISettingsStore } from '../../store/useUISettingsStore'

const FONT_URL = '/fonts/helvetiker_bold.typeface.json'
const BASE_SIZE = 0.52
const PRINTS_SHEAR = 0.26   // italic lean toward the 3D (to the right)

// One line, all the same size; only PRINTS is sheared (italic toward the 3D).
const WORDS = [
  { text: 'The',    color: '#2f80ff', metalness: 0.2, shear: 0 },
  { text: 'PRINTS', color: '#ffa033', metalness: 0.2, shear: PRINTS_SHEAR },
  { text: '3D',     color: '#2fe070', metalness: 0.3, shear: 0 },
] as const

interface TypefaceData {
  resolution: number
  glyphs: Record<string, { ha: number } | undefined>
}

function measureWord(data: TypefaceData, text: string, size: number): number {
  const scale = size / data.resolution
  let w = 0
  for (const ch of text) w += (data.glyphs[ch]?.ha ?? data.glyphs['?']?.ha ?? 0) * scale
  return w
}

/** Wraps a word in a sheared group so it slants like italic (toward the 3D). */
function ShearedWord({ shear, children }: { shear: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = ref.current
    if (!g || !shear) return
    g.matrixAutoUpdate = false
    g.matrix.makeShear(shear, 0, 0, 0, 0, 0)   // x += shear·y → top leans right
  }, [shear])
  return <group ref={ref}>{children}</group>
}

function WordmarkMesh({ opacity }: { opacity: number }) {
  const height = 0.14
  const bevel  = { bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.04, bevelSegments: 4 }
  const font = useFont(FONT_URL)

  const offsets = useMemo(() => {
    const data = font.data as unknown as TypefaceData
    const widths = WORDS.map((w) => measureWord(data, w.text, BASE_SIZE))
    const total = widths.reduce((a, b) => a + b, 0)
    const starts: number[] = []
    for (let i = 0, x = -total / 2; i < widths.length; x += widths[i], i++) starts.push(x)
    return starts
  }, [font])

  return (
    <group position={[0, -BASE_SIZE / 2, 0]}>
      {WORDS.map((word, i) => (
        <group key={word.text} position={[offsets[i], 0, 0]}>
          <ShearedWord shear={word.shear}>
            <Text3D font={FONT_URL} size={BASE_SIZE} height={height} {...bevel}>
              {word.text}
              <meshStandardMaterial color={word.color} roughness={0.3} metalness={word.metalness} transparent opacity={opacity} />
            </Text3D>
          </ShearedWord>
        </group>
      ))}
    </group>
  )
}

export default function FloatingLogo3D() {
  const groupRef = useRef<THREE.Group>(null)
  const visible    = useUISettingsStore((s) => s.logo3DVisible)
  const opacity    = useUISettingsStore((s) => s.logo3DOpacity)
  const floatSpeed = useUISettingsStore((s) => s.logo3DFloatSpeed)

  // Track the camera so the logo stays pinned to the top-left corner of the view.
  useFrame((state) => {
    const g = groupRef.current
    if (!g || !visible) return
    const cam = state.camera as THREE.PerspectiveCamera
    const dist = 6
    const halfH = Math.tan((cam.fov * Math.PI / 180) / 2) * dist
    const halfW = halfH * (state.size.width / Math.max(1, state.size.height))
    const inset = 0.5
    const local = new THREE.Vector3(-halfW + inset + 0.7, halfH - inset - 0.12, -dist)
    cam.localToWorld(local)
    g.position.copy(local)
    g.quaternion.copy(cam.quaternion)
    g.rotateY(Math.sin(state.clock.elapsedTime * (0.5 + floatSpeed * 0.5)) * 0.4)
  })

  if (!visible) return null

  return (
    <group ref={groupRef} scale={0.42}>
      <Suspense fallback={null}>
        <WordmarkMesh opacity={opacity} />
      </Suspense>
    </group>
  )
}
