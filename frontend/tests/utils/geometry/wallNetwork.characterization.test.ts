import { describe, it } from 'vitest'

import type { Point } from '@/types/plan'
import { pointInRings, wallFacePolylines, wallOutline } from '@/utils/geometry'
import type { WallGeometryInput } from '@/utils/geometry'

import { expectPointClose } from './helpers'

/**
 * Characterization of the two defects driving `docs/WALL_NETWORK.md`, stated as
 * the invariants the wall network must establish.
 *
 * Both cases are two SEPARATE walls — the only kind that misbehaves, because a
 * single chain mitres its own vertices through `offsetPolyline`. Neither case
 * produces a `Wall.junctions` record today (the wall tool writes one only for a
 * projection snap into a wall's middle), so nothing butts them together.
 *
 * These probe the PER-WALL pipeline deliberately, not the wall network: the
 * network already resolves both cases (see `network/networkGeometry.test.ts`),
 * but it can only do so because the stored geometry is wrong in a way it has to
 * correct. When phase 3 stores endpoints honestly these two bodies start
 * passing on their own, which makes `it.fails` itself fail — the tripwire that
 * says "storage is honest now; convert these to `it`".
 */

/** 12" exterior shell, vertical, spine on x = 0: surfaces at x = -6 and x = +6. */
const SHELL: WallGeometryInput = {
  vertices: [
    { x: 0, y: 0 },
    { x: 0, y: 200 },
  ],
  thicknessIn: 12,
  reference: 'center',
}

describe('wall network invariants (characterization)', () => {
  it.fails('butts a perpendicular partition against the shell surface, not into its body', () => {
    // A 4" partition snapped to the shell and running into the room. Its spine
    // lands on the shell's spine, so its body reaches 6" inside the shell —
    // the small outlined rectangles visible where a thin wall meets a thick one.
    const partition: WallGeometryInput = {
      vertices: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      thicknessIn: 4,
      reference: 'center',
    }

    const shellRings = wallOutline(SHELL)
    for (const ring of wallOutline(partition)) {
      for (const vertex of ring) {
        // No wall's outline may have a vertex inside another wall's body.
        if (pointInRings(vertex, shellRings)) {
          throw new Error(`partition outline vertex (${vertex.x}, ${vertex.y}) is inside the shell`)
        }
      }
    }
  })

  it.fails('makes the surfaces of a collinear partition flush with the shell', () => {
    // The reported case: a 4" partition continuing the shell's line should read
    // as one unified wall — the two surfaces on the shared side are ONE surface,
    // with the whole thickness difference stepping off the other side.
    const partition: WallGeometryInput = {
      vertices: [
        { x: 0, y: 200 },
        { x: 0, y: 320 },
      ],
      thicknessIn: 4,
      reference: 'center',
    }

    const shellFaces = wallFacePolylines(SHELL)
    const partitionFaces = wallFacePolylines(partition)
    const shellEnd: Point = shellFaces.right[shellFaces.right.length - 1]
    const partitionStart: Point = partitionFaces.right[0]

    expectPointClose(partitionStart, shellEnd)
  })
})
