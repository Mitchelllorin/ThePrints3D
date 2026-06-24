/**
 * ObjectModels — procedural 3D stand-ins for placed catalog items.
 *
 * Each model is built from cheap primitives (boxes/cylinders) in LOCAL space,
 * centred on the origin and sized to the item's W×H×D so it drops straight into
 * PlacedObjectsLayer where the parent group already handles position, mount
 * height, rotation, selection and explode. No external assets — everything is
 * generated on-device, which keeps the no-paid-dependency rule intact.
 *
 * Convention: the model spans [-w/2..w/2] × [-h/2..h/2] × [-d/2..d/2], so the
 * floor sits at y = -h/2 (matching the box stand-in it replaces). Anything with
 * no dedicated model falls back to a plain box, so new catalog entries still
 * render — just blockier — until they get a shape here.
 */
import * as THREE from 'three'

interface ModelProps {
  type: string
  w: number
  h: number
  d: number
  color: string
  /** Sub-type — e.g. stair shape: 'Straight' | 'L-shaped' | 'U-shaped' | 'Switchback'. */
  subtype?: string
}

/** Lighten (amt>0) or darken (amt<0) a colour via HSL lightness. */
function shade(hex: string, amt: number): THREE.Color {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amt, 0, 1))
  return c
}

interface PartProps {
  args: [number, number, number]
  pos?: [number, number, number]
  color: THREE.Color | string
  rough?: number
  metal?: number
}

function Box({ args, pos = [0, 0, 0], color, rough = 0.7, metal = 0.05 }: PartProps) {
  return (
    <mesh position={pos} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} />
    </mesh>
  )
}

function Cyl({
  r, height, pos = [0, 0, 0], color, rough = 0.5, metal = 0.05, segments = 20,
}: {
  r: number; height: number; pos?: [number, number, number]
  color: THREE.Color | string; rough?: number; metal?: number; segments?: number
}) {
  return (
    <mesh position={pos} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, height, segments]} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} />
    </mesh>
  )
}

/**
 * Pick a procedural model for the item type. Returns null for types without a
 * dedicated shape so the caller can fall back to a plain box.
 */
export default function ObjectModel({ type, w, h, d, color, subtype }: ModelProps) {
  const floor = -h / 2
  const body = color
  const light = shade(color, 0.12)
  const dark = shade(color, -0.12)

  switch (type) {
    case 'sofa': {
      const seatH = h * 0.45
      const armW = w * 0.1
      const backD = d * 0.22
      return (
        <>
          <Box args={[w, seatH, d]} pos={[0, floor + seatH / 2, 0]} color={body} />
          <Box args={[w, h - seatH, backD]} pos={[0, floor + seatH + (h - seatH) / 2, -d / 2 + backD / 2]} color={dark} />
          <Box args={[w - 2 * armW, h * 0.14, d - backD]} pos={[0, floor + seatH + h * 0.05, backD / 2]} color={light} />
          <Box args={[armW, h * 0.6, d]} pos={[-w / 2 + armW / 2, floor + h * 0.3, 0]} color={body} />
          <Box args={[armW, h * 0.6, d]} pos={[w / 2 - armW / 2, floor + h * 0.3, 0]} color={body} />
        </>
      )
    }
    case 'chair': {
      const seatH = h * 0.5
      const legR = Math.min(w, d) * 0.04
      const lx = w / 2 - legR * 2
      const lz = d / 2 - legR * 2
      return (
        <>
          <Box args={[w, h * 0.08, d]} pos={[0, floor + seatH, 0]} color={body} />
          <Box args={[w, h * 0.45, d * 0.1]} pos={[0, floor + seatH + h * 0.22, -d / 2 + d * 0.05]} color={body} />
          {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([x, z], i) => (
            <Cyl key={i} r={legR} height={seatH} pos={[x, floor + seatH / 2, z]} color={dark} />
          ))}
        </>
      )
    }
    case 'bed-double':
    case 'bed-single': {
      const headH = h * 1.6
      return (
        <>
          <Box args={[w, h * 0.55, d]} pos={[0, floor + h * 0.275, 0]} color={dark} />
          <Box args={[w * 0.96, h * 0.4, d * 0.96]} pos={[0, floor + h * 0.6, d * 0.02]} color={light} />
          <Box args={[w, headH * 0.5, d * 0.06]} pos={[0, floor + headH * 0.25, -d / 2 + d * 0.03]} color={body} />
          {/* pillow(s) */}
          <Box args={[w * 0.4, h * 0.18, d * 0.18]} pos={[w * (type === 'bed-double' ? -0.22 : 0), floor + h * 0.72, -d * 0.34]} color={shade(color, 0.25)} />
          {type === 'bed-double' && (
            <Box args={[w * 0.4, h * 0.18, d * 0.18]} pos={[w * 0.22, floor + h * 0.72, -d * 0.34]} color={shade(color, 0.25)} />
          )}
        </>
      )
    }
    case 'desk':
    case 'dining-table': {
      const topH = h * 0.06
      const legW = Math.min(w, d) * 0.06
      const lx = w / 2 - legW
      const lz = d / 2 - legW
      return (
        <>
          <Box args={[w, topH, d]} pos={[0, floor + h - topH / 2, 0]} color={light} />
          {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([x, z], i) => (
            <Box key={i} args={[legW, h - topH, legW]} pos={[x, floor + (h - topH) / 2, z]} color={dark} />
          ))}
          {type === 'desk' && (
            <Box args={[w * 0.9, h * 0.3, d * 0.1]} pos={[0, floor + h * 0.55, -d / 2 + d * 0.06]} color={body} />
          )}
        </>
      )
    }
    case 'kitchen-counter': {
      const topH = h * 0.08
      return (
        <>
          <Box args={[w, h - topH, d]} pos={[0, floor + (h - topH) / 2, 0]} color={body} />
          <Box args={[w + 0.02, topH, d + 0.02]} pos={[0, floor + h - topH / 2, 0]} color={shade(color, -0.2)} rough={0.35} />
        </>
      )
    }
    case 'toilet': {
      return (
        <>
          {/* tank */}
          <Box args={[w, h * 0.45, d * 0.28]} pos={[0, floor + h * 0.55, -d / 2 + d * 0.14]} color={body} />
          {/* bowl */}
          <Cyl r={w * 0.46} height={h * 0.4} pos={[0, floor + h * 0.32, d * 0.12]} color={light} segments={24} />
          {/* base */}
          <Box args={[w * 0.55, h * 0.22, d * 0.3]} pos={[0, floor + h * 0.11, d * 0.05]} color={body} />
        </>
      )
    }
    case 'bathtub': {
      return (
        <>
          <Box args={[w, h, d]} pos={[0, floor + h / 2, 0]} color={body} rough={0.3} />
          {/* recessed basin (a darker inset sitting just below the rim) */}
          <Box args={[w - 0.18, h * 0.7, d - 0.18]} pos={[0, floor + h * 0.62, 0]} color={shade(color, -0.18)} rough={0.25} />
        </>
      )
    }
    case 'ceiling-light':
    case 'recessed-light': {
      return <Cyl r={w * 0.5} height={h} color={shade(color, 0.3)} rough={0.3} metal={0.1} segments={24} />
    }
    case 'exhaust-fan': {
      return (
        <>
          <Box args={[w, h * 0.5, d]} pos={[0, floor + h * 0.25, 0]} color={body} />
          <Cyl r={w * 0.3} height={h * 0.5} pos={[0, floor + h * 0.7, 0]} color={dark} segments={16} />
        </>
      )
    }
    case 'stairs': {
      // Configurable stair: Straight, L-shaped (quarter-turn + landing),
      // U-shaped / Switchback (half-turn + landing). Treads climb at a ~0.18 m
      // code-typical riser; landings are a flat slab at the turn. Proprietary —
      // generated on-device from primitives, no external geometry.
      const total = THREE.MathUtils.clamp(Math.round(h / 0.18), 10, 22)
      const riser = h / total
      const TT = Math.max(0.04, h * 0.02)   // tread thickness
      const shape = (subtype ?? 'Straight').toLowerCase()
      type Step = { x: number; y: number; z: number; tw: number; td: number; c: THREE.Color | string }
      const steps: Step[] = []
      const landings: Step[] = []
      if (shape.startsWith('l')) {
        // Lower flight up +Z, landing at the corner, upper flight turning along +X.
        const n1 = Math.ceil(total / 2), n2 = total - n1
        const lowerRun = d * 0.6, t1 = lowerRun / n1
        for (let i = 0; i < n1; i++) steps.push({ x: 0, y: floor + (i + 1) * riser, z: -d / 2 + (i + 0.5) * t1, tw: w, td: t1 * 0.95, c: i % 2 ? light : body })
        const landY = floor + n1 * riser, landZ = -d / 2 + lowerRun + w / 2
        landings.push({ x: 0, y: landY, z: landZ, tw: w, td: w, c: dark })
        const upperRun = d * 0.45, t2 = upperRun / n2
        for (let i = 0; i < n2; i++) steps.push({ x: (i + 0.5) * t2, y: landY + (i + 1) * riser, z: landZ, tw: t2 * 0.95, td: w, c: i % 2 ? light : body })
      } else if (shape.startsWith('u') || shape.startsWith('s')) {
        // Two flights in parallel lanes, opposite directions, landing at the far end.
        const half = Math.ceil(total / 2), n2 = total - half
        const run = d * 0.9, t = run / half, fw = w * 0.46, lane = w * 0.27
        for (let i = 0; i < half; i++) steps.push({ x: -lane, y: floor + (i + 1) * riser, z: -d / 2 + (i + 0.5) * t, tw: fw, td: t * 0.95, c: i % 2 ? light : body })
        const landY = floor + half * riser
        landings.push({ x: 0, y: landY, z: -d / 2 + run + w * 0.2, tw: w, td: w * 0.4, c: dark })
        for (let i = 0; i < n2; i++) steps.push({ x: lane, y: landY + (i + 1) * riser, z: -d / 2 + run - (i + 0.5) * t, tw: fw, td: t * 0.95, c: i % 2 ? light : body })
      } else {
        const t = d / total
        for (let i = 0; i < total; i++) steps.push({ x: 0, y: floor + (i + 1) * riser, z: -d / 2 + (i + 0.5) * t, tw: w, td: t * 0.95, c: i % 2 ? light : body })
      }
      return (
        <>
          {steps.map((s, i) => <Box key={i} args={[s.tw, TT, s.td]} pos={[s.x, s.y, s.z]} color={s.c} />)}
          {landings.map((s, i) => <Box key={`l${i}`} args={[s.tw, TT, s.td]} pos={[s.x, s.y, s.z]} color={s.c} />)}
        </>
      )
    }
    case 'elevator': {
      // Shaft shell (back + sides) with a contrasting cab and a door seam — a
      // recognisable lift stand-in that spans the storey.
      const t = Math.min(w, d) * 0.06
      return (
        <>
          {/* back + side walls */}
          <Box args={[w, h, t]} pos={[0, floor + h / 2, -d / 2 + t / 2]} color={dark} />
          <Box args={[t, h, d]} pos={[-w / 2 + t / 2, floor + h / 2, 0]} color={dark} />
          <Box args={[t, h, d]} pos={[w / 2 - t / 2, floor + h / 2, 0]} color={dark} />
          {/* cab */}
          <Box args={[w - 3 * t, h - 2 * t, d - 3 * t]} pos={[0, floor + h / 2, t]} color={light} rough={0.4} metal={0.3} />
          {/* door seam up the front */}
          <Box args={[t * 0.6, h * 0.9, t * 0.6]} pos={[0, floor + h / 2, d / 2 - t * 0.3]} color={shade(color, -0.3)} />
        </>
      )
    }
    default:
      return null
  }
}
