import { describe, expect, it } from 'vitest'

import type { FreeGuide, Guide, PointGuide, SurfaceGuide, Wall } from '@/types/plan'
import type { GuideLine, ResolvedNetwork } from '@/utils/geometry'
import {
  guideCrossings,
  resolveGuideLine,
  resolveGuideLines,
  resolveWallNetwork,
} from '@/utils/geometry'

import { expectPointClose } from '../helpers'
import { wall } from './fixtures'

/** 12" centre-referenced wall running south on x = 0: surfaces at x = +6 (left) and x = -6 (right). */
const SHELL = wall(
  'shell',
  [
    { x: 0, y: 0 },
    { x: 0, y: 200 },
  ],
  12,
)

function free(angleDeg: number, origin = { x: 10, y: 20 }): FreeGuide {
  return { id: 'g', kind: 'free', origin, angle_deg: angleDeg }
}

function surface(side: 'left' | 'right', offsetIn: number, segmentIndex = 0): SurfaceGuide {
  return {
    id: 'g',
    kind: 'surface',
    wall_id: 'shell',
    segment_index: segmentIndex,
    side,
    offset_in: offsetIn,
  }
}

function point(end: 'start' | 'end', angleDeg: number, wallId = 'shell'): PointGuide {
  return { id: 'g', kind: 'point', anchor: { wall_id: wallId, end }, angle_deg: angleDeg }
}

/** The resolved line, failing loudly rather than asserting non-null at each use. */
function lineOf(
  guide: Guide,
  walls: readonly Wall[] = [SHELL],
  network?: ResolvedNetwork,
): GuideLine {
  const line = resolveGuideLine(guide, walls, network)
  if (!line) throw new Error(`guide ${guide.id} did not resolve`)
  return line
}

describe('resolveGuideLine', () => {
  it('runs a free guide through its origin at the stored angle', () => {
    expectPointClose(lineOf(free(0)).point, { x: 10, y: 20 })
    expectPointClose(lineOf(free(0)).dir, { x: 1, y: 0 })
    expectPointClose(lineOf(free(45)).dir, { x: Math.SQRT1_2, y: Math.SQRT1_2 })
    expectPointClose(lineOf(free(90)).dir, { x: 0, y: 1 })
  })

  it('runs a point guide through the anchored wall end', () => {
    expectPointClose(lineOf(point('start', 0)).point, { x: 0, y: 0 })
    expectPointClose(lineOf(point('end', 0)).point, { x: 0, y: 200 })
    expectPointClose(lineOf(point('end', 90)).dir, { x: 0, y: 1 })
  })

  it('follows the wall end when the wall moves', () => {
    const moved = wall(
      'shell',
      [
        { x: 40, y: 0 },
        { x: 40, y: 200 },
      ],
      12,
    )

    expectPointClose(lineOf(point('end', 0), [moved]).point, { x: 40, y: 200 })
  })

  it('prefers the resolved corner over the stored vertex when given a network', () => {
    // Two ends declared a corner 10" apart: the network draws it at their midpoint.
    const west = wall(
      'west',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      6,
    )
    const east = wall(
      'east',
      [
        { x: 100, y: 10 },
        { x: 200, y: 10 },
      ],
      6,
    )
    const walls = [west, east]
    const network = resolveWallNetwork(walls, [
      {
        id: 'j',
        kind: 'corner',
        ends: [
          { wall_id: 'west', end: 'end' },
          { wall_id: 'east', end: 'start' },
        ],
        rule: 'miter',
      },
    ])
    const guide = point('end', 0, 'west')

    expectPointClose(lineOf(guide, walls).point, { x: 100, y: 0 })
    expectPointClose(lineOf(guide, walls, network).point, { x: 100, y: 5 })
  })

  it('puts a zero-offset surface guide ON the named surface', () => {
    // Walking south, the walker's left is +x in y-down space.
    expectPointClose(lineOf(surface('left', 0)).point, { x: 6, y: 0 })
    expectPointClose(lineOf(surface('right', 0)).point, { x: -6, y: 0 })
    expectPointClose(lineOf(surface('left', 0)).dir, { x: 0, y: 1 })
  })

  it('measures the offset outward from the surface, away from the wall body', () => {
    expectPointClose(lineOf(surface('left', 36)).point, { x: 42, y: 0 })
    expectPointClose(lineOf(surface('right', 36)).point, { x: -42, y: 0 })
  })

  it('honours the wall reference side when locating the surface', () => {
    // A wall drawn on its left face has that face ON the spine, the other 12" away.
    const referenced = wall('shell', SHELL.vertices, 12, 'left')

    expectPointClose(lineOf(surface('left', 36), [referenced]).point, { x: 36, y: 0 })
    expectPointClose(lineOf(surface('right', 36), [referenced]).point, { x: -48, y: 0 })
  })

  it('keeps the offset when the host wall thickens', () => {
    // The point of anchoring: a relation, not a coordinate. A 4" wall's left
    // surface is 2" out, so the same 36" guide lands at x = 38 with no edit.
    const thinner = wall('shell', SHELL.vertices, 4)

    expectPointClose(lineOf(surface('left', 36), [thinner]).point, { x: 38, y: 0 })
  })

  it('resolves nothing when the anchor is gone', () => {
    expect(resolveGuideLine(point('end', 0, 'ghost'), [SHELL])).toBeNull()
    expect(resolveGuideLine({ ...surface('left', 12), wall_id: 'ghost' }, [SHELL])).toBeNull()
    expect(resolveGuideLine(surface('left', 12, 3), [SHELL])).toBeNull()
  })
})

describe('resolveGuideLines', () => {
  it('keeps the guides that resolve and drops the orphans', () => {
    const lines = resolveGuideLines(
      [
        { ...free(0), id: 'a' },
        { ...point('end', 90, 'ghost'), id: 'b' },
        { ...surface('left', 0), id: 'c' },
      ],
      [SHELL],
    )

    expect(lines.map((line) => line.guideId)).toEqual(['a', 'c'])
  })
})

describe('guideCrossings', () => {
  it('crosses a vertical guide with a horizontal one', () => {
    const lines = resolveGuideLines(
      [
        { id: 'v', kind: 'free', origin: { x: 10, y: 0 }, angle_deg: 90 },
        { id: 'h', kind: 'free', origin: { x: 0, y: 25 }, angle_deg: 0 },
      ],
      [SHELL],
    )
    const crossings = guideCrossings(lines)

    expect(crossings).toHaveLength(1)
    expect(crossings[0].a).toBe('v')
    expect(crossings[0].b).toBe('h')
    expectPointClose(crossings[0].point, { x: 10, y: 25 })
  })

  it('reports no crossing for parallel guides', () => {
    const lines = resolveGuideLines(
      [
        { id: 'a', kind: 'free', origin: { x: 0, y: 0 }, angle_deg: 45 },
        { id: 'b', kind: 'free', origin: { x: 0, y: 30 }, angle_deg: 45 },
        {
          id: 'c',
          kind: 'surface',
          wall_id: 'shell',
          segment_index: 0,
          side: 'left',
          offset_in: 0,
        },
      ],
      [SHELL],
    )
    const crossings = guideCrossings(lines)

    // The two 45° lines never meet; each still crosses the vertical surface guide.
    expect(crossings.map((crossing) => [crossing.a, crossing.b])).toEqual([
      ['a', 'c'],
      ['b', 'c'],
    ])
  })
})
