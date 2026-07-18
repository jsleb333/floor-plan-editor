import { describe, expect, it } from 'vitest'

import type { Point } from '@/types/plan'
import {
  boundsIntersect,
  boundsOfPoints,
  boundsOfRings,
  pointInPolygon,
  pointInRings,
} from '@/utils/geometry'

const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

/** Concave "L" polygon covering [0,10]² minus the [5,10]×[0,5] notch. */
const L_SHAPE: Point[] = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 5 },
  { x: 10, y: 5 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('pointInPolygon', () => {
  it('classifies interior and exterior points of a convex ring', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: -1, y: 5 }, SQUARE)).toBe(false)
    expect(pointInPolygon({ x: 5, y: 11 }, SQUARE)).toBe(false)
  })

  it('respects concavities', () => {
    expect(pointInPolygon({ x: 2, y: 2 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 7, y: 7 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 7, y: 2 }, L_SHAPE)).toBe(false)
  })
})

describe('pointInRings', () => {
  const OUTER = SQUARE
  const INNER: Point[] = [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 7 },
  ]

  it('treats the hole of a two-ring band as outside, like the evenodd fill rule', () => {
    expect(pointInRings({ x: 1, y: 5 }, [OUTER, INNER])).toBe(true)
    expect(pointInRings({ x: 5, y: 5 }, [OUTER, INNER])).toBe(false)
    expect(pointInRings({ x: 12, y: 5 }, [OUTER, INNER])).toBe(false)
  })

  it('ignores degenerate rings', () => {
    expect(pointInRings({ x: 5, y: 5 }, [OUTER, [{ x: 0, y: 0 }]])).toBe(true)
  })
})

describe('bounds helpers', () => {
  it('computes bounds of points and rings', () => {
    expect(boundsOfPoints([])).toBeNull()
    expect(boundsOfPoints(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
    expect(
      boundsOfRings([
        SQUARE,
        [
          { x: -5, y: 20 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      ]),
    ).toEqual({
      minX: -5,
      minY: 0,
      maxX: 10,
      maxY: 20,
    })
  })

  it('detects overlapping, touching and disjoint boxes', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    expect(boundsIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true)
    expect(boundsIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true)
    expect(boundsIntersect(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false)
    expect(boundsIntersect(a, { minX: 0, minY: 11, maxX: 10, maxY: 20 })).toBe(false)
  })
})
