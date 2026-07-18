import { describe, expect, it } from 'vitest'

import type { Point } from '@/types/plan'
import { offsetPolyline, wallOutline } from '@/utils/geometry'

import { expectPointsClose } from './helpers'

const SQRT2 = Math.SQRT2
const SQRT101 = Math.sqrt(101)

describe('offsetPolyline', () => {
  it('mitres a 90° L-bend at the exact offset-line intersection', () => {
    const vertices: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    expectPointsClose(offsetPolyline(vertices, 3), [
      { x: 0, y: -3 },
      { x: 103, y: -3 },
      { x: 103, y: 100 },
    ])
    expectPointsClose(offsetPolyline(vertices, -3), [
      { x: 0, y: 3 },
      { x: 97, y: 3 },
      { x: 97, y: 100 },
    ])
  })

  it('mitres a 45° bend at the exact offset-line intersection', () => {
    const vertices: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
    ]
    expectPointsClose(offsetPolyline(vertices, 2), [
      { x: 0, y: -2 },
      { x: 98 + 2 * SQRT2, y: -2 },
      { x: 200 + SQRT2, y: 100 - SQRT2 },
    ])
  })

  it('keeps the plain offset point across collinear vertices', () => {
    const vertices: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]
    expectPointsClose(offsetPolyline(vertices, 3), [
      { x: 0, y: -3 },
      { x: 50, y: -3 },
      { x: 100, y: -3 },
    ])
  })

  it('falls back to a bevel join at an extremely acute angle', () => {
    const vertices: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 1 },
    ]
    expectPointsClose(offsetPolyline(vertices, 1), [
      { x: 0, y: -1 },
      { x: 10, y: -1 },
      { x: 10 + 1 / SQRT101, y: 10 / SQRT101 },
      { x: 1 / SQRT101, y: 1 + 10 / SQRT101 },
    ])
  })

  it('offsets a closed ring with a join at every vertex', () => {
    const ring: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 0 },
    ]
    expectPointsClose(offsetPolyline(ring, -6, true), [
      { x: -6, y: -6 },
      { x: -6, y: 86 },
      { x: 106, y: 86 },
      { x: 106, y: -6 },
    ])
  })

  it('ignores zero-length segments from duplicate vertices', () => {
    const vertices: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]
    expectPointsClose(offsetPolyline(vertices, 2), [
      { x: 0, y: -2 },
      { x: 50, y: -2 },
      { x: 100, y: -2 },
    ])
  })
})

describe('wallOutline', () => {
  const horizontal: Point[] = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
  ]

  it('centers the body around the reference line in center mode', () => {
    const rings = wallOutline({ vertices: horizontal, thicknessIn: 6, reference: 'center' })
    expect(rings).toHaveLength(1)
    expectPointsClose(rings[0], [
      { x: 0, y: -3 },
      { x: 120, y: -3 },
      { x: 120, y: 3 },
      { x: 0, y: 3 },
    ])
  })

  it('grows the body to the right of travel in left mode (reference = left face)', () => {
    const rings = wallOutline({ vertices: horizontal, thicknessIn: 6, reference: 'left' })
    expect(rings).toHaveLength(1)
    expectPointsClose(rings[0], [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 6 },
      { x: 0, y: 6 },
    ])
  })

  it('grows the body to the left of travel in right mode (reference = right face)', () => {
    const rings = wallOutline({ vertices: horizontal, thicknessIn: 6, reference: 'right' })
    expect(rings).toHaveLength(1)
    expectPointsClose(rings[0], [
      { x: 0, y: -6 },
      { x: 120, y: -6 },
      { x: 120, y: 0 },
      { x: 0, y: 0 },
    ])
  })

  it('mitres both the outer and inner corner of an L-shaped 6" wall', () => {
    const rings = wallOutline({
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      thicknessIn: 6,
      reference: 'center',
    })
    expect(rings).toHaveLength(1)
    expectPointsClose(rings[0], [
      { x: 0, y: -3 },
      { x: 103, y: -3 },
      { x: 103, y: 100 },
      { x: 97, y: 100 },
      { x: 97, y: 3 },
      { x: 0, y: 3 },
    ])
  })

  it('returns the reference rectangle as the inner ring for a left-reference closed loop (S1a)', () => {
    const interior: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 0 },
    ]
    const rings = wallOutline({
      vertices: interior,
      thicknessIn: 6,
      reference: 'left',
      closed: true,
    })
    expect(rings).toHaveLength(2)
    expectPointsClose(rings[0], interior)
    expectPointsClose(rings[1], [
      { x: -6, y: -6 },
      { x: -6, y: 86 },
      { x: 106, y: 86 },
      { x: 106, y: -6 },
    ])
  })

  it('detects a closed loop from a repeated first vertex', () => {
    const interior: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 0 },
    ]
    const rings = wallOutline({
      vertices: [...interior, { x: 0, y: 0 }],
      thicknessIn: 6,
      reference: 'left',
    })
    expect(rings).toHaveLength(2)
    expectPointsClose(rings[0], interior)
  })

  it('handles collinear vertices without spurious corners', () => {
    const rings = wallOutline({
      vertices: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      thicknessIn: 6,
      reference: 'center',
    })
    expect(rings).toHaveLength(1)
    expectPointsClose(rings[0], [
      { x: 0, y: -3 },
      { x: 50, y: -3 },
      { x: 100, y: -3 },
      { x: 100, y: 3 },
      { x: 50, y: 3 },
      { x: 0, y: 3 },
    ])
  })

  it('bevels both faces at an extremely acute corner', () => {
    const rings = wallOutline({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 1 },
      ],
      thicknessIn: 2,
      reference: 'center',
    })
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(8)
    expectPointsClose(rings[0].slice(0, 4), [
      { x: 0, y: -1 },
      { x: 10, y: -1 },
      { x: 10 + 1 / SQRT101, y: 10 / SQRT101 },
      { x: 1 / SQRT101, y: 1 + 10 / SQRT101 },
    ])
  })

  it('throws for a non-positive thickness', () => {
    expect(() =>
      wallOutline({ vertices: horizontal, thicknessIn: 0, reference: 'center' }),
    ).toThrow(RangeError)
  })

  it('returns no rings for fewer than two distinct vertices', () => {
    expect(
      wallOutline({ vertices: [{ x: 5, y: 5 }], thicknessIn: 6, reference: 'center' }),
    ).toEqual([])
    expect(
      wallOutline({
        vertices: [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        thicknessIn: 6,
        reference: 'center',
      }),
    ).toEqual([])
  })
})
