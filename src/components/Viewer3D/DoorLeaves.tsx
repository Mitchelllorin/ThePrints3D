/**
 * The doors that do not swing: a patio slider, a closet bypass pair and a
 * bifold. Drawn in the opening the same way PlacedObjectsLayer draws a hinged
 * leaf — centred on the opening, `w` wide and `h` tall — so they select, drag
 * and X-ray exactly like every other door.
 *
 * Each reads as its mechanism from any angle, because that is what tells you
 * which door was ordered:
 *   PATIO   two glass panels in a frame, one track in front of the other, the
 *           sliding one carrying the handle;
 *   BYPASS  two solid panels overlapping on an overhead track;
 *   BIFOLD  narrow leaves with a reveal at every hinge, in pairs off the jambs.
 */
import { Edges } from '@react-three/drei'
import { bifoldLeaves, type DoorStyle } from '../../services/doorStyle'

interface Props {
  style: Extract<DoorStyle, 'patio' | 'bypass' | 'bifold'>
  w: number
  h: number
  /** Thickness of the opening marker the hinged doors use. */
  d: number
  color: string
  xray: boolean
  /** Which side the moving panel is on, seen from the room the door faces. */
  hand: 'left' | 'right'
}

const GLASS = '#9fd3f0'
const OVERLAP = 0.05     // sliding panels lap each other at the middle stile

export default function DoorLeaves({ style, w, h, d, color, xray, hand }: Props) {
  const opacity = xray ? 0.18 : 0.8
  const solid = (key: string | number, x: number, z: number, pw: number) => (
    <mesh key={key} position={[x, 0, z]}>
      <boxGeometry args={[pw, h, d / 2]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.05}
        transparent opacity={opacity} depthWrite={!xray} />
      {!xray && <Edges color={color} lineWidth={2.5} />}
    </mesh>
  )

  if (style === 'patio' || style === 'bypass') {
    const pw = w / 2 + OVERLAP / 2
    const off = w / 4 - OVERLAP / 4
    // The moving panel rides the inside track (+z, the room the door faces).
    const moving = hand === 'left' ? -1 : 1
    const panels = [-1, 1].map((side) => ({ side, x: side * off, z: side === moving ? d / 4 : -d / 4 }))
    if (style === 'bypass') return <>{panels.map((p) => solid(p.side, p.x, p.z, pw))}</>
    return (
      <>
        {panels.map((p) => (
          <group key={p.side} position={[p.x, 0, p.z]}>
            <mesh>
              <boxGeometry args={[pw, h, d / 3]} />
              <meshStandardMaterial color={GLASS} roughness={0.1} metalness={0.1}
                transparent opacity={xray ? 0.12 : 0.35} depthWrite={false} />
              {!xray && <Edges color={color} lineWidth={3} />}
            </mesh>
            {/* The handle, on the sliding panel's leading stile. */}
            {p.side === moving && !xray && (
              <mesh position={[-moving * (pw / 2 - 0.06), 0, d / 4]}>
                <boxGeometry args={[0.025, 0.3, 0.03]} />
                <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.6} />
              </mesh>
            )}
          </group>
        ))}
      </>
    )
  }

  // Bifold: n leaves with a reveal at each fold.
  const n = bifoldLeaves(w)
  const lw = w / n
  return (
    <>
      {Array.from({ length: n }, (_, i) =>
        solid(i, -w / 2 + lw * (i + 0.5), i % 2 === 0 ? -d / 8 : d / 8, lw - 0.01))}
    </>
  )
}
