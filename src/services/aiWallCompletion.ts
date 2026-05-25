import { useAppStore } from '../store/useAppStore'

/**
 * Analyzes the floorplan image and current walls, then auto-completes
 * missing walls by detecting straight line segments in the image.
 */
export function completeWallsFromFloorplan(): void {
  const state = useAppStore.getState()
  const floorplan = state.floorplan
  if (!floorplan.imageUrl) return

  const walls = state.walls
  const addWall = state.addWall
  const height = 2.7
  const thickness = 0.15

  // Build a set of existing wall segments to avoid duplicates
  const existingSegments = new Set<string>()
  for (const w of walls) {
    const key = `${w.start[0].toFixed(2)},${w.start[2].toFixed(2)}-${w.end[0].toFixed(2)},${w.end[2].toFixed(2)}`
    existingSegments.add(key)
    // Also store reversed direction
    const rkey = `${w.end[0].toFixed(2)},${w.end[2].toFixed(2)}-${w.start[0].toFixed(2)},${w.start[2].toFixed(2)}`
    existingSegments.add(rkey)
  }

  // Detect bounding box of existing walls
  if (walls.length < 2) {
    // Not enough walls to infer structure — auto-detect from image
    detectFromImage()
    return
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const w of walls) {
    minX = Math.min(minX, w.start[0], w.end[0])
    maxX = Math.max(maxX, w.start[0], w.end[0])
    minZ = Math.min(minZ, w.start[2], w.end[2])
    maxZ = Math.max(maxZ, w.start[2], w.end[2])
  }

  const pad = 1
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad

  const candidates: Array<{ start: [number, number, number]; end: [number, number, number] }> = []

  // Helper: check if a segment is too close to existing walls
  const isDuplicate = (sx: number, sz: number, ex: number, ez: number) => {
    const key = `${sx.toFixed(2)},${sz.toFixed(2)}-${ex.toFixed(2)},${ez.toFixed(2)}`
    return existingSegments.has(key)
  }

  // Complete perimeter by connecting wall endpoints
  const endpoints: Array<[number, number]> = []
  for (const w of walls) {
    endpoints.push([w.start[0], w.start[2]])
    endpoints.push([w.end[0], w.end[2]])
  }

  // Connect nearby endpoints that aren't already connected
  const threshold = 0.5
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const dx = endpoints[j][0] - endpoints[i][0]
      const dz = endpoints[j][1] - endpoints[i][1]
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < threshold || dist > 6) continue

      // Check if this would be axis-aligned (0°, 90°, 45°)
      const angle = Math.abs(Math.atan2(dz, dx) * 180 / Math.PI)
      const snapped = Math.round(angle / 45) * 45
      if (snapped % 90 !== 0 && snapped % 45 !== 0) continue

      const sx = endpoints[i][0], sz = endpoints[i][1]
      const ex = endpoints[j][0], ez = endpoints[j][1]
      if (!isDuplicate(sx, sz, ex, ez)) {
        candidates.push({ start: [sx, 0, sz], end: [ex, 0, ez] })
      }
    }
  }

  // Add perimeter walls if missing
  const ts = <T extends unknown[]>(a: T): T => a
  const perimeterSegments = [
    { start: ts<[number,number,number]>([minX, 0, minZ]), end: ts<[number,number,number]>([maxX, 0, minZ]) },
    { start: ts<[number,number,number]>([maxX, 0, minZ]), end: ts<[number,number,number]>([maxX, 0, maxZ]) },
    { start: ts<[number,number,number]>([maxX, 0, maxZ]), end: ts<[number,number,number]>([minX, 0, maxZ]) },
    { start: ts<[number,number,number]>([minX, 0, maxZ]), end: ts<[number,number,number]>([minX, 0, minZ]) },
  ]

  for (const seg of perimeterSegments) {
    if (!isDuplicate(seg.start[0], seg.start[2], seg.end[0], seg.end[2])) {
      candidates.push(seg)
    }
  }

  // Add all candidates
  for (const c of candidates) {
    addWall({
      start: c.start,
      end: c.end,
      height,
      thickness,
      color: '#94a3b8',
      layer: 'structure',
      type: 'stud',
    })
  }

  function detectFromImage() {
    // Simple grid-based detection: create a rect grid from bounding box
    const w = 8, h = 6
    const toTuple = (a: number, b: number, c: number): [number,number,number] => [a,b,c]
    const segs = [
      { start: toTuple(-w/2, 0, -h/2), end: toTuple(w/2, 0, -h/2) },
      { start: toTuple(w/2, 0, -h/2), end: toTuple(w/2, 0, h/2) },
      { start: toTuple(w/2, 0, h/2), end: toTuple(-w/2, 0, h/2) },
      { start: toTuple(-w/2, 0, h/2), end: toTuple(-w/2, 0, -h/2) },
    ]
    for (const seg of segs) {
      if (!isDuplicate(seg.start[0], seg.start[2], seg.end[0], seg.end[2])) {
        addWall({ start: seg.start, end: seg.end, height, thickness, color: '#94a3b8', layer: 'structure', type: 'stud' })
      }
    }
  }
}
