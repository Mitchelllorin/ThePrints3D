import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { ParsedWall } from '../../types'

const WALL_HEIGHT = 2.7
const DEFAULT_THICKNESS = 0.2

function WallMesh({ wall }: { wall: ParsedWall }) {
  const geometry = useMemo(() => {
    const scale = 0.001 // px → m via store scaleMmPerPx will refine, default 1mm/px
    const x1 = wall.x1 * scale
    const z1 = wall.y1 * scale
    const x2 = wall.x2 * scale
    const z2 = wall.y2 * scale
    const length = Math.hypot(x2 - x1, z2 - z1)
    const thickness = wall.thickness ? wall.thickness * scale : DEFAULT_THICKNESS
    return { x1, z1, x2, z2, length, thickness }
  }, [wall])

  const { x1, z1, x2, z2, length, thickness } = geometry
  const cx = (x1 + x2) / 2
  const cz = (z1 + z2) / 2
  const angle = Math.atan2(z2 - z1, x2 - x1)

  return (
    <mesh
      position={[cx, WALL_HEIGHT / 2, cz]}
      rotation={[0, -angle, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[length, WALL_HEIGHT, Math.max(0.05, thickness)]} />
      <meshStandardMaterial
        color="#e2e8f0"
        roughness={0.85}
        metalness={0.05}
      />
    </mesh>
  )
}

export default function LiveWallsLayer() {
  const drawings = useAppStore((s) => s.drawings)

  const userWalls = useMemo(() => {
    const walls: ParsedWall[] = []
    for (const drawing of drawings) {
      for (const wall of drawing.parsedWalls) {
        if (wall.source === 'user') walls.push(wall)
      }
    }
    return walls
  }, [drawings])

  if (userWalls.length === 0) return null

  return (
    <group name="live-walls">
      {userWalls.map((wall, i) => (
        <WallMesh key={i} wall={wall} />
      ))}
    </group>
  )
}
