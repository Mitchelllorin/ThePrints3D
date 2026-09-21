import { describe, expect, it } from 'vitest'
import { createDrawnProject, DRAWN_MM_PER_PX } from './drawnProject'
import { teesForWalls } from './wallTees'
import type { ParsedWall } from '../types'

/**
 * An interior wall run into an exterior one has to frame a TEE in the exterior
 * wall — the pack goes in the wall being met. These put a real drawn 2x6 shell
 * down and land a partition on its front wall three ways a person drawing it
 * actually would.
 */
describe('an interior wall landing on a drawn exterior wall frames a tee', () => {
  const project = createDrawnProject({ widthMm: 12000, depthMm: 9000, wallTypeKey: 'wood-2x6', floor: 'slab' })
  const shell = project.drawing.parsedWalls
  // The top wall of the main box, whichever order the shell lists them in.
  const top = shell.reduce((a, b) => (Math.min(b.y1, b.y2) < Math.min(a.y1, a.y2) ? b : a))
  const yCentre = top.y1
  const halfT = (top.thickness ?? 0) / 2
  const x = (top.x1 + top.x2) / 2
  const partition = (yEnd: number): ParsedWall => ({
    ...top, x1: x, y1: yEnd, x2: x, y2: yEnd + 3000 / DRAWN_MM_PER_PX, wallRole: 'interior', thickness: 9,
  })
  const teeOnTop = (yEnd: number) => {
    const walls = [...shell, partition(yEnd)]
    return teesForWalls(walls)[walls.indexOf(top)]
  }

  it('when it ends on the exterior wall centreline', () => {
    expect(teeOnTop(yCentre)).toHaveLength(1)
  })

  it('when it ends halfway into the exterior wall', () => {
    expect(teeOnTop(yCentre + halfT / 2)).toHaveLength(1)
  })

  it('when it ends on the INSIDE FACE of the exterior wall — where you would tap', () => {
    expect(teeOnTop(yCentre + halfT)).toHaveLength(1)
  })
})
