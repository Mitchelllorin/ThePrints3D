/**
 * Logo3DBadge — the REAL 3D brand wordmark (The·PRINTS·3D), extruded and gently
 * rocking to show its depth, pinned top-left over the workspace.
 *
 * It renders in its OWN isolated <Canvas> overlay (its own camera + lights), not
 * inside the main scene — so it can never be hidden by the model, the scene
 * lighting, or camera-tracking math. That's why the old in-scene version never
 * showed up; this one always does.
 *
 * The(blue) · PRINTS(orange, italic toward the 3D) · 3D(green).
 */
import { Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text3D, useFont } from '@react-three/drei'
import * as THREE from 'three'
import { useUISettingsStore } from '../../store/useUISettingsStore'

const FONT_URL = '/fonts/helvetiker_bold.typeface.json'
const BASE_SIZE = 0.62
const EXTRUDE = 0.18
const PRINTS_SHEAR = 0.26 // italic lean toward the 3D (to the right)

const WORDS = [
  { text: 'The',    color: '#2f80ff', metalness: 0.25, shear: 0 },
  { text: 'PRINTS', color: '#ffa033', metalness: 0.25, shear: PRINTS_SHEAR },
  { text: '3D',     color: '#2fe070', metalness: 0.35, shear: 0 },
] as const

useFont.preload(FONT_URL)

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

/** Wraps a word so it slants like italic (top leans right, toward the 3D). */
function ShearedWord({ shear, children }: { shear: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = ref.current
    if (!g || !shear) return
    g.matrixAutoUpdate = false
    // x-by-y shear → letters lean right (true italic) while the BASELINE stays
    // flat. (The xy arg would slope y by x and tilt the whole word off-baseline.)
    g.matrix.makeShear(0, 0, shear, 0, 0, 0)
  }, [shear])
  return <group ref={ref}>{children}</group>
}

function Wordmark({ opacity }: { opacity: number }) {
  const font = useFont(FONT_URL)
  const rockRef = useRef<THREE.Group>(null)
  const floatSpeed = useUISettingsStore((s) => s.logo3DFloatSpeed)
  const floatHeight = useUISettingsStore((s) => s.logo3DFloatHeight)
  const bevel = { bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.035, bevelSegments: 3 }

  const offsets = useMemo(() => {
    const data = font.data as unknown as TypefaceData
    const widths = WORDS.map((w) => measureWord(data, w.text, BASE_SIZE))
    const total = widths.reduce((a, b) => a + b, 0)
    const gap = BASE_SIZE * 0.12
    const starts: number[] = []
    let x = -(total + gap * (WORDS.length - 1)) / 2
    for (let i = 0; i < widths.length; i++) { starts.push(x); x += widths[i] + gap }
    return starts
  }, [font])

  // Rock back and forth to show the extrusion; gentle vertical float.
  useFrame((state) => {
    const g = rockRef.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.rotation.y = Math.sin(t * (0.5 + floatSpeed * 0.5)) * 0.55
    g.position.y = -BASE_SIZE / 2 + Math.sin(t * (0.7 + floatSpeed * 0.4)) * floatHeight * 0.4
  })

  return (
    <group ref={rockRef} position={[0, -BASE_SIZE / 2, 0]}>
      {WORDS.map((word, i) => (
        <group key={word.text} position={[offsets[i], 0, 0]}>
          <ShearedWord shear={word.shear}>
            <Text3D font={FONT_URL} size={BASE_SIZE} height={EXTRUDE} {...bevel}>
              {word.text}
              <meshStandardMaterial color={word.color} roughness={0.28} metalness={word.metalness} transparent opacity={opacity} />
            </Text3D>
          </ShearedWord>
        </group>
      ))}
    </group>
  )
}

export default function Logo3DBadge() {
  const visible = useUISettingsStore((s) => s.logo3DVisible)
  const opacityRaw = useUISettingsStore((s) => s.logo3DOpacity)
  // Honour the setting down to almost-invisible (was floored at 0.7, which made
  // the "faint watermark" default impossible). Keep a hair above 0 so it never
  // fully disappears when visible.
  const opacity = Math.max(0.02, opacityRaw)
  if (!visible) return null
  return (
    <div
      style={{
        position: 'fixed', top: 8, left: 12, width: 252, height: 64,
        zIndex: 40, pointerEvents: 'none',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 6], fov: 32 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 5]} intensity={1.5} castShadow={false} />
        <directionalLight position={[-4, 2, 3]} intensity={0.5} />
        <Suspense fallback={null}>
          <Wordmark opacity={opacity} />
        </Suspense>
      </Canvas>
    </div>
  )
}
