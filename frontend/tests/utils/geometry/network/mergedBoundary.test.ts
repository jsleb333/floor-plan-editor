import { describe, expect, it } from 'vitest'

import type { Joint, Point } from '@/types/plan'
import { resolveWallNetwork } from '@/utils/geometry'

import { resolvedWall, wall } from './fixtures'

const TOLERANCE = 1e-6

/** True when any stroke polyline walks straight from `a` to `b` (either way round). */
function hasEdge(strokes: readonly Point[][], a: Point, b: Point): boolean {
  const same = (p: Point, q: Point): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= TOLERANCE
  return strokes.some((run) =>
    run.some(
      (point, index) =>
        index + 1 < run.length &&
        ((same(point, a) && same(run[index + 1], b)) ||
          (same(point, b) && same(run[index + 1], a))),
    ),
  )
}

describe('merged wall boundaries', () => {
  it('drops the seam a mitred corner shares and keeps both free ends', () => {
    const east = wall(
      'east',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const south = wall(
      'south',
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      6,
    )
    const corner: Joint = {
      id: 'j',
      kind: 'corner',
      ends: [
        { wall_id: 'east', end: 'end' },
        { wall_id: 'south', end: 'start' },
      ],
      rule: 'miter',
    }

    const network = resolveWallNetwork([east, south], [corner])
    const outerCorner = { x: 103, y: -3 }
    const innerCorner = { x: 97, y: 3 }

    // The two bodies meet exactly along this edge, so neither may stroke it.
    expect(hasEdge(resolvedWall(network, 'east').strokes, outerCorner, innerCorner)).toBe(false)
    expect(hasEdge(resolvedWall(network, 'south').strokes, outerCorner, innerCorner)).toBe(false)

    // The free ends are still capped.
    expect(hasEdge(resolvedWall(network, 'east').strokes, { x: 0, y: -3 }, { x: 0, y: 3 })).toBe(
      true,
    )
    expect(
      hasEdge(resolvedWall(network, 'south').strokes, { x: 103, y: 100 }, { x: 97, y: 100 }),
    ).toBe(true)
  })

  it('breaks the host surface across a T so the two walls read as one body', () => {
    const host = wall(
      'host',
      [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
      12,
    )
    const partition = wall(
      'partition',
      [
        { x: 6, y: 100 },
        { x: 100, y: 100 },
      ],
      4,
    )
    const tee: Joint = {
      id: 'j',
      kind: 'tee',
      end: { wall_id: 'partition', end: 'start' },
      host: { wall_id: 'host', segment_index: 0 },
    }

    const network = resolveWallNetwork([host, partition], [tee])
    const hostStrokes = resolvedWall(network, 'host').strokes

    // The host's surface runs up to the partition and resumes past it, instead of
    // drawing a line across the partition's base.
    expect(hasEdge(hostStrokes, { x: 6, y: 0 }, { x: 6, y: 98 })).toBe(true)
    expect(hasEdge(hostStrokes, { x: 6, y: 102 }, { x: 6, y: 200 })).toBe(true)
    expect(hasEdge(hostStrokes, { x: 6, y: 0 }, { x: 6, y: 200 })).toBe(false)

    // And the partition's own end cap, which lies on that surface, is gone.
    const partitionStrokes = resolvedWall(network, 'partition').strokes
    expect(hasEdge(partitionStrokes, { x: 6, y: 98 }, { x: 6, y: 102 })).toBe(false)
  })

  it('leaves an unjoined wall its whole outline', () => {
    const only = wall(
      'only',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const strokes = resolvedWall(resolveWallNetwork([only], []), 'only').strokes

    expect(strokes).toHaveLength(1)
    expect(hasEdge(strokes, { x: 0, y: -3 }, { x: 100, y: -3 })).toBe(true)
    expect(hasEdge(strokes, { x: 100, y: -3 }, { x: 100, y: 3 })).toBe(true)
    expect(hasEdge(strokes, { x: 100, y: 3 }, { x: 0, y: 3 })).toBe(true)
    expect(hasEdge(strokes, { x: 0, y: 3 }, { x: 0, y: -3 })).toBe(true)
  })

  it('keeps both outlines when touching walls are not joined', () => {
    const a = wall(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const b = wall(
      'b',
      [
        { x: 0, y: 6 },
        { x: 100, y: 6 },
      ],
      6,
    )
    const network = resolveWallNetwork([a, b], [])

    expect(hasEdge(resolvedWall(network, 'a').strokes, { x: 0, y: 3 }, { x: 100, y: 3 })).toBe(true)
    expect(hasEdge(resolvedWall(network, 'b').strokes, { x: 0, y: 3 }, { x: 100, y: 3 })).toBe(true)
  })
})
