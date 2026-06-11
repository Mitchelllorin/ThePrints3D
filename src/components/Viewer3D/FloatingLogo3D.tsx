/**
 * FloatingLogo3D — extruded 3D wordmark bouncing around the workspace.
 * Blue(blue) Print(orange) 3D(green) — laid out with the font's own glyph
 * advance widths, exactly as the font would space "BluePrint3D" typed as a
 * single word. No hand-tuned offsets.
 */
import { useRef, useMemo, Suspense } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text3D, useFont } from '@react-three/drei'
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

const BASE_SIZE = 0.52

const WORDS = [
  { text: 'Blue',  color: '#60a5fa', scale: 1,    yOffset: 0,                metalness: 0.2 },
  { text: 'Print', color: '#f97316', scale: 1,    yOffset: 0,                metalness: 0.2 },
  { text: '3D',    color: '#4ade80', scale: 0.68, yOffset: BASE_SIZE * 0.42, metalness: 0.3 },
] as const

interface TypefaceData {
  resolution: number
  glyphs: Record<string, { ha: number } | undefined>
}

/** Advance width of `text` at `size`, from the typeface's glyph metrics. */
function measureWord(data: TypefaceData, text: string, size: number): number {
  const scale = size / data.resolution
  let w = 0
  for (const ch of text) w += (data.glyphs[ch]?.ha ?? data.glyphs['?']?.ha ?? 0) * scale
  return w
}

function WordmarkMesh({ opacity }: { opacity: number }) {
  const height = 0.14
  const bevel  = { bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.04, bevelSegments: 4 }

  const font = useFont(FONT_URL)

  const offsets = useMemo(() => {
    const data = font.data as unknown as TypefaceData
    const widths = WORDS.map((w) => measureWord(data, w.text, BASE_SIZE * w.scale))
    const total = widths.reduce((a, b) => a + b, 0)
    const starts: number[] = []
    for (let i = 0, x = -total / 2; i < widths.length; x += widths[i], i++) {
      starts.push(x)
    }
    return starts
  }, [font])

  return (
    // Drop by half the cap height so the wordmark is vertically centred on the pivot
    <group position={[0, -BASE_SIZE / 2, 0]}>
      {WORDS.map((word, i) => (
        <group key={word.text} position={[offsets[i], word.yOffset, 0]} scale={word.scale}>
          <Text3D font={FONT_URL} size={BASE_SIZE} height={height} {...bevel}>
            {word.text}
            <meshStandardMaterial color={word.color} roughness={0.3} metalness={word.metalness} transparent opacity={opacity} />
          </Text3D>
        </group>
      ))}
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

    // Slow natural spin on all axes — no moon-lock
    groupRef.current.rotation.y += delta * 0.35
    groupRef.current.rotation.x += delta * 0.08
  })

  if (!visible) return null

  return (
    <group ref={groupRef} position={[0, 3, 0]}>
      <Suspense fallback={null}>
        <WordmarkMesh opacity={opacity} />
      </Suspense>
    </group>
  )
}
