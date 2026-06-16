/**
 * TopbarLogo3D — the real, extruded "BluePrint3D" wordmark for the top-left
 * corner. Same geometry approach as the floating workspace logo (Text3D with
 * a bevel), rendered in its own tiny transparent canvas. A gentle yaw
 * oscillation keeps the extrusion unmistakably 3D without ever reading mirrored.
 */
import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text3D, useFont, Bounds } from '@react-three/drei'
import * as THREE from 'three'

const FONT_URL = '/fonts/helvetiker_bold.typeface.json'
const SIZE = 1
const DEPTH = 0.32

const WORDS = [
  { text: 'Blue',  color: '#60a5fa', metalness: 0.25 },
  { text: 'Print', color: '#f97316', metalness: 0.25 },
  { text: '3D',    color: '#4ade80', metalness: 0.35 },
] as const

interface TypefaceData {
  resolution: number
  glyphs: Record<string, { ha: number } | undefined>
}

/** Advance width of `text` at `size`, from the typeface's own glyph metrics. */
function measureWord(data: TypefaceData, text: string, size: number): number {
  const scale = size / data.resolution
  let w = 0
  for (const ch of text) w += (data.glyphs[ch]?.ha ?? data.glyphs['?']?.ha ?? 0) * scale
  return w
}

function Wordmark() {
  const ref = useRef<THREE.Group>(null)
  const font = useFont(FONT_URL)
  const bevel = { bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.03, bevelSegments: 4 }

  const offsets = useMemo(() => {
    const data = font.data as unknown as TypefaceData
    const widths = WORDS.map((w) => measureWord(data, w.text, SIZE))
    const total = widths.reduce((a, b) => a + b, 0)
    const starts: number[] = []
    for (let i = 0, x = -total / 2; i < widths.length; x += widths[i], i++) starts.push(x)
    return starts
  }, [font])

  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.6) * 0.38
    ref.current.rotation.x = 0.12
  })

  // Drop by half the cap height so the wordmark sits vertically centred on the pivot.
  return (
    <group ref={ref} position={[0, -SIZE * 0.36, 0]}>
      {WORDS.map((word, i) => (
        <group key={word.text} position={[offsets[i], 0, 0]}>
          <Text3D font={FONT_URL} size={SIZE} height={DEPTH} {...bevel}>
            {word.text}
            <meshStandardMaterial color={word.color} roughness={0.32} metalness={word.metalness} />
          </Text3D>
        </group>
      ))}
    </group>
  )
}

export default function TopbarLogo3D() {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 10], zoom: 40 }}
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 2]}
      style={{ width: 220, height: 44, pointerEvents: 'none' }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 6]} intensity={1.2} />
      <directionalLight position={[-4, -2, 3]} intensity={0.45} />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.1}>
          <Wordmark />
        </Bounds>
      </Suspense>
    </Canvas>
  )
}
